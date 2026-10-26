import { computed, nextTick, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { xlsxBlob } from './xlsx'
import { actaSheetRows, decisionTie, isTied, percentOf } from './resultados'
import type { RoundRecord } from './types'
import { useAssembly } from './useAssembly'

const {
  loading, error, notice, state, code, moderatorToken, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies,
  liveAssembly, assemblyStatus, lobbyStatus, round, eligibleVotes, participantLeft, request, isUnauthorized, refresh, setBrowsingActas, selectAssembly,
  recoverActiveAssembly, rememberJoinCode,
} = useAssembly()

const moderationConfirmation = ref<{ title: string; consequence: string; label: string; path: string; method: string; body?: unknown; reasonLabel?: string; reasonPlaceholder?: string; typedConfirmation?: string; onSuccess?: (result: any) => void | Promise<void> } | null>(null)
const moderationReason = ref('')
const moderatorCredential = ref('')
const assemblyName = ref('Asamblea de Delegados')
const roundTitle = ref('')
const roundCategory = ref<'office' | 'committee'>('office')
const committeeMemberCount = ref<number | null>(null)
const repeatSelections = ref<Record<string, string[]>>({})
const repeatSeats = ref<Record<string, number | null>>({})
const showNextBallotForm = ref(false)
const resumeQr = ref<{ name: string; image: string; url: string; expiresAt: string } | null>(null)
const officialSelections = ref<Record<string, string[]>>({})
const officialNotes = ref<Record<string, string>>({})
const ballotCandidates = ref<string[]>([])
const newBallotCandidate = ref('')
const repeatDialogRoundId = ref('')
const declareDialogRoundId = ref('')
watch(() => state.value?.rounds, (rounds) => {
  for (const item of rounds || []) {
    if (!Array.isArray(officialSelections.value[item.id])) {
      officialSelections.value[item.id] = item.officialResult?.elected.map((person) => person.optionId) || []
      officialNotes.value[item.id] = item.officialResult?.note || ''
    }
    if (!Array.isArray(repeatSelections.value[item.id])) repeatSelections.value[item.id] = []
  }
}, { immediate: true })

const secrecyCleanupPendingRounds = computed(() => (state.value?.rounds || []).filter((item) => item.secrecyCleanupPending))
const assemblyStatusLabels: Record<string, string> = { preparing: 'En preparación', lobby_open: 'Ingreso abierto', lobby_closed: 'Ingreso cerrado', in_progress: 'En curso', completed: 'Finalizada' }
const roundStatusLabels: Record<string, string> = { draft: 'preparada', open: 'abierta', closed: 'cerrada', published: 'publicada', annulled: 'anulada' }
function roundChain(target: RoundRecord) {
  return (state.value?.rounds || []).filter((item) => item.id === target.id || item.committeeRootRoundId === target.id)
}
function isDecidable(target: RoundRecord) {
  const chain = roundChain(target)
  return !target.committeeRootRoundId && !chain.some((item) => item.status === 'open') && chain.some((item) => item.status === 'closed' || item.status === 'published')
}
const attendance = computed(() => {
  const record = state.value?.attendanceRound
  if (!record) return null
  const pending = (state.value?.participants || []).filter((person) => !person.voted).length
  return { ...record, pending }
})
const moderatorWorkflow = ['Ingreso', 'Papeleta', 'Votación', 'Conteo', 'Resultado']
const currentRoundRecord = computed(() => state.value?.rounds?.find((item) => item.id === round.value?.id))
const currentRoundDeclared = computed(() => {
  const record = currentRoundRecord.value
  const rootId = record?.committeeRootRoundId ?? record?.id
  return Boolean(state.value?.rounds?.find((item) => item.id === rootId)?.officialResult)
})
const moderatorWorkflowStep = computed(() => {
  if (round.value?.status === 'open') return 2
  if (round.value?.status === 'closed') return 3
  if (round.value?.status === 'published') return currentRoundDeclared.value ? 5 : 4
  if (round.value?.status === 'draft') return 1
  return lobbyStatus.value === 'lobby_open' ? 0 : 1
})
watch(assemblyId, () => { participantLeft.value = '' })

function eligibleOf(target: RoundRecord) {
  const own = (target as RoundRecord & { eligibleCount?: number }).eligibleCount
  if (own !== undefined) return own
  if (target.id === round.value?.id && eligibleVotes.value) return eligibleVotes.value
  return state.value?.participants?.length ?? 0
}

function rankedRows(unsorted: Array<{ optionId?: string; label: string; count: number }>, base: number) {
  const results = [...unsorted].sort((a, b) => b.count - a.count)
  return results.map((result, index) => ({
    key: result.optionId || result.label,
    label: result.label,
    count: result.count,
    rank: index + 1,
    tied: isTied(results, index),
    percent: percentOf(result.count, base),
  }))
}

function annulRound(target: { id: string; title: string }) {
  moderationReason.value = ''
  moderationConfirmation.value = {
    title: '¿Anular esta papeleta?',
    consequence: `Los votos de «${target.title}» se eliminarán y nunca se contarán ni publicarán. Teléfonos y proyector mostrarán «Votación anulada». Después puedes repetir la votación.`,
    label: 'Anular papeleta',
    path: `/moderator/rounds/${encodeURIComponent(target.id)}/annul`,
    method: 'POST',
    reasonLabel: 'Motivo (obligatorio, queda en el registro)',
    reasonPlaceholder: 'Ej.: Se detectó un error en las opciones de la papeleta',
  }
}

function repeatRound(target: RoundRecord, optionIds = repeatSelections.value[target.id] || []) {
  if (!optionIds.length) { error.value = 'Selecciona las opciones que pasan a la nueva votación.'; return }
  const seats = repeatSeats.value[target.id]
  void moderatorAction(`/moderator/rounds/${encodeURIComponent(target.id)}/repeat`, 'POST', {
    optionIds, ...(target.category === 'committee' && seats ? { seats } : {}),
  })
}

function repeatAllOptions(target: RoundRecord | undefined) {
  if (target) repeatRound(target, target.options.map((option) => option.id))
}

async function runModeratorAction(path: string, method: string, body: unknown, onSuccess?: (result: any) => void | Promise<void>) {
  moderationConfirmation.value = { title: '', consequence: '', label: '', path, method, body, ...(onSuccess ? { onSuccess } : {}) }
  await confirmModeratorAction()
}

function latestCounted(target: RoundRecord) {
  const counted = roundChain(target).filter((item) => item.status === 'closed' || item.status === 'published')
  return counted[counted.length - 1] || target
}
function voteNumber(target: { id: string; committeeRootRoundId?: string | null }) {
  const rootId = target.committeeRootRoundId || target.id
  const chain = (state.value?.rounds || []).filter((item) => item.id === rootId || item.committeeRootRoundId === rootId)
  return Math.max(1, chain.findIndex((item) => item.id === target.id) + 1)
}
function rootRoundOf(target: { id: string; committeeRootRoundId?: string | null }) {
  return state.value?.rounds?.find((item) => item.id === (target.committeeRootRoundId || target.id))
}

function nextVoteNumber(target: RoundRecord) {
  return roundChain(rootRoundOf(target) || target).length + 1
}
const repeatContext = computed(() => {
  const record = currentRoundRecord.value
  const root = record && rootRoundOf(record)
  if (!record || !root || root.id === record.id) return ''
  const chain = roundChain(root)
  const previous = chain[chain.findIndex((item) => item.id === record.id) - 1]
  if (!previous) return ''
  const number = voteNumber(previous)
  if (previous.status === 'annulled') return `Se repite porque la ${number}.ª votación fue anulada.`
  const tie = decisionTie(previous)
  return tie
    ? `Se repite por empate en la ${number}.ª votación (${tie.tied.map((result) => result.count).join(' – ')}).`
    : `Se repite entre las opciones que eligió la Asamblea tras la ${number}.ª votación.`
})
const repeatDialogRound = computed(() => state.value?.rounds?.find((item) => item.id === repeatDialogRoundId.value))
const declareDialogRound = computed(() => state.value?.rounds?.find((item) => item.id === declareDialogRoundId.value))

function openRepeatDialog(target: RoundRecord) {
  const tie = decisionTie(target)
  repeatSelections.value[target.id] = tie ? tie.tied.map((result) => result.optionId) : []
  repeatSeats.value[target.id] = tie && target.category === 'committee' ? tie.openSeats : null
  repeatDialogRoundId.value = target.id
}

async function confirmRepeatDialog() {
  const target = repeatDialogRound.value
  const optionIds = target ? repeatSelections.value[target.id] || [] : []
  if (!target || !optionIds.length) return
  const seats = repeatSeats.value[target.id]
  repeatDialogRoundId.value = ''
  await runModeratorAction(`/moderator/rounds/${encodeURIComponent(target.id)}/repeat`, 'POST', {
    optionIds, ...(target.category === 'committee' && seats ? { seats } : {}),
  })
}

function openDeclareDialog(target: RoundRecord) {
  if (target.officialResult) {
    officialSelections.value[target.id] = target.officialResult.elected.map((person) => person.optionId)
    officialNotes.value[target.id] = target.officialResult.note || ''
  } else if (!Array.isArray(officialSelections.value[target.id])) officialSelections.value[target.id] = []
  declareDialogRoundId.value = target.id
}

async function confirmDeclareDialog() {
  const target = declareDialogRound.value
  if (!target || !(officialSelections.value[target.id] || []).length) return
  declareDialogRoundId.value = ''
  const publish = roundChain(target).some((item) => item.status === 'published')
  await runModeratorAction(`/moderator/rounds/${encodeURIComponent(target.id)}/official-result`, 'PUT', {
    optionIds: officialSelections.value[target.id], note: officialNotes.value[target.id] || '',
  }, publish ? () => request(`/moderator/rounds/${encodeURIComponent(target.id)}/official-result/publish`, { method: 'POST' }, moderatorToken.value) : undefined)
}

function addBallotCandidate() {
  const name = newBallotCandidate.value.trim()
  if (!name) return
  if (!ballotCandidates.value.some((existing) => existing.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) ballotCandidates.value.push(name)
  newBallotCandidate.value = ''
}

function removeBallotCandidate(index: number) {
  ballotCandidates.value.splice(index, 1)
}

function chooseRoundCategory(category: 'office' | 'committee') {
  roundCategory.value = category
}

async function moderatorAction(path: string, method = 'POST', body?: unknown, onSuccess?: (result: any) => void | Promise<void>) {
  const removed = body && typeof body === 'object' && 'status' in body && body.status === 'removed'
  const reopening = body && typeof body === 'object' && 'status' in body && body.status === 'lobby_open'
  const config = path.endsWith('/lobby') && reopening
    ? { title: '¿Reabrir el ingreso?', consequence: 'Nuevas personas podrán unirse con el QR. Quedará registrado. Cierra el ingreso de nuevo antes de abrir la siguiente papeleta.', label: 'Reabrir ingreso' }
    : path.endsWith('/lobby')
    ? { title: '¿Cerrar el ingreso?', consequence: 'Las personas que todavía no se hayan unido ya no podrán entrar.', label: 'Cerrar ingreso' }
    : path.endsWith('/rounds')
      ? { title: '¿Preparar esta papeleta?', consequence: 'Revisa el cargo y las opciones. No se podrán editar después de abrir la votación.', label: 'Preparar papeleta' }
      : path.endsWith('/open')
        ? { title: '¿Abrir la votación?', consequence: 'La papeleta aparecerá en los teléfonos y sus opciones quedarán fijas.', label: 'Abrir votación' }
        : path.endsWith('/close')
          ? { title: '¿Cerrar la votación?', consequence: 'Dejará de aceptar votos.', label: 'Cerrar votación' }
          : path.endsWith('/repeat')
            ? { title: '¿Preparar una nueva votación?', consequence: 'Se crea una papeleta con las opciones seleccionadas. Ábrela cuando la Asamblea lo decida.', label: 'Preparar nueva votación' }
          : method === 'DELETE' && path.endsWith('/official-result')
            ? { title: '¿Retirar la declaración oficial?', consequence: 'Dejará de mostrarse en teléfonos y proyector. Quedará registrada en el historial. Después puedes repetir o anular la votación.', label: 'Retirar declaración' }
          : path.endsWith('/official-result/publish')
            ? { title: '¿Publicar la declaración oficial?', consequence: 'Teléfonos y proyector mostrarán a quien la mesa declaró electo, con la observación registrada.', label: 'Publicar declaración' }
          : path.endsWith('/publish')
            ? { title: '¿Publicar el conteo?', consequence: 'Los conteos por opción se harán visibles para participantes y proyector. Publicar no elige a nadie: la mesa declara el resultado después.', label: 'Publicar conteo' }
            : removed
              ? { title: '¿Retirar a esta persona?', consequence: 'Ya no podrá participar desde esta sesión.', label: 'Retirar participante' }
              : { title: '¿Guardar los cambios?', consequence: 'Se actualizarán los datos de esta persona en la lista.', label: 'Guardar cambios' }
  moderationConfirmation.value = { ...config, path, method, ...(body === undefined ? {} : { body }), ...(onSuccess ? { onSuccess } : {}) }
}

async function confirmModeratorAction() {
  const action = moderationConfirmation.value
  if (!action || loading.value) return
  const reason = moderationReason.value.trim()
  if (action.reasonLabel && !reason) return
  if (action.typedConfirmation && reason !== action.typedConfirmation) return
  if (action.reasonLabel && !action.typedConfirmation) action.body = { ...(action.body as object | undefined), reason }
  moderationConfirmation.value = null
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    const result = await request(action.path, { method: action.method, ...(action.body === undefined ? {} : { body: JSON.stringify(action.body) }) }, moderatorToken.value)
    notice.value = 'Acción registrada.'
    succeeded = true
    await action.onSuccess?.(result)
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded && action.path.endsWith('/complete')) notice.value = 'La Asamblea quedó finalizada. Imprime o guarda el acta antes de borrar los datos.'
  if (succeeded) await refresh(true)
}

function rotateJoinCode() {
  if (!assemblyId.value) return
  moderationConfirmation.value = {
    title: '¿Generar un nuevo código de ingreso?',
    consequence: 'El QR y el enlace del proyector anteriores dejarán de funcionar. Vuelve a abrir el proyector después de generarlo.',
    label: 'Generar código',
    path: `/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/join-code`,
    method: 'POST',
    onSuccess: async (result: { joinCode: string; joinUrl: string }) => {
      rememberJoinCode(result.joinCode)
      qrImage.value = await QRCode.toDataURL(result.joinUrl, { width: 300, margin: 2 })
      notice.value = 'Nuevo código generado. Abre de nuevo el proyector para mostrar el QR actualizado.'
    },
  }
}

function issueResumeCode(person: { id?: string; firstName: string; lastName: string }) {
  if (!person.id) return
  moderationConfirmation.value = {
    title: `¿Reconectar a ${person.firstName} ${person.lastName}?`,
    consequence: 'Se mostrará un QR de un solo uso (válido 10 minutos) para su nuevo dispositivo. El dispositivo anterior dejará de funcionar. Si ya votó en esta papeleta, no podrá votar de nuevo.',
    label: 'Generar QR de reconexión',
    path: `/moderator/participants/${encodeURIComponent(person.id)}/resume-code`,
    method: 'POST',
    onSuccess: async (result: { name: string; resumeUrl: string; expiresAt: string }) => {
      resumeQr.value = { name: result.name, url: result.resumeUrl, expiresAt: result.expiresAt, image: await QRCode.toDataURL(result.resumeUrl, { width: 300, margin: 2 }) }
      notice.value = ''
    },
  }
}

function openCompletedAssembly(id: string) {
  setBrowsingActas(false)
  selectAssembly(id)
  void refresh()
}

function openLiveAssembly() {
  if (!liveAssembly.value) return
  setBrowsingActas(false)
  selectAssembly(liveAssembly.value.id)
  void refresh()
}

function showPendingActas() {
  setBrowsingActas(true)
  assemblyId.value = ''
  sessionStorage.removeItem('assemblyId')
  code.value = ''
  qrImage.value = ''
  state.value = null
  void refresh()
}

const otherPendingActas = computed(() => completedAssemblies.value.filter((item) => item.id !== assemblyId.value))

async function retrySecrecyCleanup() {
  if (!assemblyId.value || loading.value) return
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    await request(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/secrecy-cleanup`, { method: 'POST' }, moderatorToken.value)
    notice.value = 'Limpieza completada. Ya se pueden publicar resultados.'
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded) await refresh(true)
}

async function completeAssembly() {
  if (!assemblyId.value || assemblyStatus.value === 'completed' || round.value?.status === 'open') return
  moderationConfirmation.value = {
    title: '¿Finalizar la Asamblea?',
    consequence: 'Confirma solo después de que la mesa haya aprobado el cierre. La sesión quedará en modo de consulta.',
    label: 'Finalizar Asamblea',
    path: `/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/complete`,
    method: 'POST', body: { confirmation: true },
  }
}

async function printActa() {
  printingActa.value = true
  await nextTick()
  window.print()
}

function downloadActaSpreadsheet() {
  const rows = actaSheetRows(state.value?.rounds || [], roundStatusLabels)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(xlsxBlob('Acta', rows))
  link.download = `acta-${(state.value?.assembly?.name || 'asamblea').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}.xlsx`
  link.click()
  URL.revokeObjectURL(link.href)
}

function deleteAssemblyData() {
  if (!assemblyId.value || assemblyStatus.value !== 'completed') return
  const deletedId = assemblyId.value
  moderationConfirmation.value = {
    title: '¿Borrar todos los datos de la Asamblea?',
    consequence: 'Se borran nombres, votos, resultados y registros. No se puede deshacer. Hazlo solo después de imprimir o guardar el acta.',
    label: 'Borrar datos',
    reasonLabel: 'Escribe BORRAR para confirmar',
    typedConfirmation: 'BORRAR',
    path: `/moderator/assemblies/${encodeURIComponent(deletedId)}`,
    method: 'DELETE', body: { confirmation: true },
    onSuccess: (result: { vacuumed: boolean }) => {
      notice.value = result.vacuumed
        ? 'Se borraron los datos de la Asamblea. Al apagar, sigue el cierre de la guía del técnico.'
        : 'Se borraron los datos de la Asamblea, pero la compactación de la base no terminó. Al apagar, sigue el cierre de la guía del técnico para borrarla por completo.'
      assemblyId.value = ''
      sessionStorage.removeItem('assemblyId')
      if (localStorage.getItem('assemblyJoinCodeAssemblyId') === deletedId) {
        localStorage.removeItem('assemblyJoinCode')
        localStorage.removeItem('assemblyJoinCodeAssemblyId')
      }
      code.value = ''
      qrImage.value = ''
      state.value = null
    },
  }
}

async function createAssembly() {
  error.value = ''
  loading.value = true
  let created = false
  try {
    const result = await request<{ assemblyId: string; joinCode: string; joinUrl?: string }>('/moderator/assemblies', {
      method: 'POST', body: JSON.stringify({ name: assemblyName.value }),
    }, moderatorToken.value)
    setBrowsingActas(false)
    assemblyId.value = result.assemblyId
    sessionStorage.setItem('assemblyId', result.assemblyId)
    rememberJoinCode(result.joinCode)
    qrImage.value = await QRCode.toDataURL(result.joinUrl || `${window.location.origin}/?join=${encodeURIComponent(result.joinCode)}`, { width: 300, margin: 2 })
    notice.value = `Asamblea creada. Código de ingreso: ${result.joinCode}`
    created = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (created) await refresh(true)
}

function editParticipant(person: { id?: string; firstName: string; lastName: string }) {
  if (!person.id) return
  const updatedFirst = window.prompt('Corrige el nombre del participante:', person.firstName)
  if (updatedFirst === null) return
  const updatedLast = window.prompt('Corrige el apellido del participante:', person.lastName)
  if (updatedLast === null) return
  void moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', {
    firstName: updatedFirst.trim(), lastName: updatedLast.trim(),
  })
}

function resetBallotForm() {
  roundTitle.value = ''
  ballotCandidates.value = []
  newBallotCandidate.value = ''
  committeeMemberCount.value = null
}

async function createRound() {
  if (newBallotCandidate.value.trim()) addBallotCandidate()
  const office = roundCategory.value === 'office'
  const options = ballotCandidates.value.map((label) => ({ label }))
  const seats = committeeMemberCount.value
  if (!roundTitle.value.trim()) { error.value = office ? 'Escribe el cargo que se vota.' : 'Escribe el nombre de la comisión.'; return }
  if (office && options.length < 2) { error.value = 'Agrega al menos dos candidatos.'; return }
  if (!office && (!seats || seats < 1)) { error.value = 'Indica cuántos integrantes quedarán en la comisión.'; return }
  if (!office && options.length < seats!) { error.value = `Agrega al menos ${seats} candidatos: pueden ser más que los integrantes, pero no menos.`; return }
  showNextBallotForm.value = false
  await moderatorAction(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/rounds`, 'POST', {
    title: roundTitle.value.trim(), format: office ? 'single_choice' : 'multiple_choice', options,
    category: roundCategory.value,
    ...(!office ? { memberCount: seats } : {}),
    countingRule: { kind: 'count_only', label: 'Conteo agregado por opción; sin proclamación automática' },
  }, resetBallotForm)
}

function formatActor(actor: string) {
  return actor === 'shared_moderator_credential' ? 'moderación (credencial compartida)' : actor
}

async function signInModerator() {
  const credential = moderatorCredential.value.trim()
  if (!credential) return
  moderatorAuthState.value = 'validating'
  moderatorToken.value = credential
  state.value = null
  error.value = ''
  try {
    await request('/moderator/session', {}, credential)
    moderatorAuthState.value = 'authenticated'
    sessionStorage.setItem('moderatorToken', credential)
    error.value = ''
    await recoverActiveAssembly()
    if (assemblyId.value) void refresh()
  } catch (e) {
    const message = (e as Error).message
    state.value = null
    if (isUnauthorized(e)) {
      moderatorToken.value = ''
      moderatorAuthState.value = 'unauthenticated'
      sessionStorage.removeItem('moderatorToken')
      error.value = 'La credencial de moderación no es válida.'
    } else {
      moderatorAuthState.value = 'validation_error'
      error.value = message
    }
  }
}

export function useMesa() {
  return {
    moderationConfirmation, moderationReason, moderatorCredential, assemblyName, roundTitle, roundCategory, committeeMemberCount,
    repeatSelections, repeatSeats, showNextBallotForm, resumeQr, officialSelections, officialNotes, ballotCandidates, newBallotCandidate,
    repeatDialogRoundId, declareDialogRoundId,
    secrecyCleanupPendingRounds, assemblyStatusLabels, roundStatusLabels, attendance, moderatorWorkflow, currentRoundRecord, currentRoundDeclared,
    moderatorWorkflowStep, repeatContext, repeatDialogRound, declareDialogRound, otherPendingActas,
    roundChain, isDecidable, latestCounted, voteNumber, rootRoundOf, nextVoteNumber, eligibleOf, rankedRows,
    annulRound, repeatAllOptions, openRepeatDialog, confirmRepeatDialog, openDeclareDialog, confirmDeclareDialog, addBallotCandidate,
    removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, openCompletedAssembly,
    openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, deleteAssemblyData,
    createAssembly, editParticipant, createRound, formatActor, signInModerator,
  }
}
