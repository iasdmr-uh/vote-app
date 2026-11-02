import { computed, nextTick, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { xlsxBlob } from './xlsx'
import { actaSheetRows, isTied, percentOf } from './resultados'
import type { ApprovalRule, DecisionFormat, RoundCategory, RoundRecord } from './types'
import { useAssembly } from './useAssembly'

const {
  loading, error, notice, state, code, moderatorToken, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies,
  liveAssembly, assemblyStatus, lobbyStatus, round, eligibleVotes, participantLeft, participantLeftId, request, isUnauthorized, refresh, setBrowsingActas, selectAssembly,
  recoverActiveAssembly, rememberJoinCode,
} = useAssembly()

const moderationConfirmation = ref<{ title: string; consequence: string; label: string; path: string; method: string; body?: unknown; reasonLabel?: string; reasonPlaceholder?: string; typedConfirmation?: string; onSuccess?: (result: any) => void | Promise<void> } | null>(null)
const moderationReason = ref('')
const moderatorCredential = ref('')
const assemblyName = ref('Asamblea de Delegados')
const roundTitle = ref('')
const roundCategory = ref<RoundCategory>('office')
const committeeMemberCount = ref<number | null>(null)
const decisionFormat = ref<DecisionFormat>('boolean')
const approvalRule = ref<ApprovalRule>('simple')
const showNextBallotForm = ref(false)
const resumeQr = ref<{ name: string; image: string; url: string; expiresAt: string } | null>(null)
const ballotCandidates = ref<string[]>([])
const newBallotCandidate = ref('')
/** The runoff draft from the 3rd vote on that the mesa is preparing (M22) before opening it. */
const preparingRunoffId = ref('')
const newRunoffCandidate = ref('')
const secrecyCleanupPendingRounds = computed(() => (state.value?.rounds || []).filter((item) => item.secrecyCleanupPending))
const assemblyStatusLabels: Record<string, string> = { preparing: 'En preparación', lobby_open: 'Ingreso abierto', lobby_closed: 'Ingreso cerrado', in_progress: 'En curso', completed: 'Finalizada' }
const roundStatusLabels: Record<string, string> = { draft: 'preparada', open: 'abierta', closed: 'cerrada', published: 'publicada', annulled: 'anulada' }
function roundChain(target: RoundRecord) {
  return (state.value?.rounds || []).filter((item) => item.id === target.id || item.committeeRootRoundId === target.id)
}
const attendance = computed(() => {
  const record = state.value?.attendanceRound
  if (!record) return null
  const participants = state.value?.participants || []
  // An inhabilitado still counts in the base, but no longer "falta"; one who already voted counts only in "votaron".
  const pending = participants.filter((person) => !person.voted && !person.votingDisabled).length
  const disabled = participants.filter((person) => person.votingDisabled && !person.voted).length
  return { ...record, pending, disabled }
})
const moderatorWorkflow = ['Ingreso', 'Papeleta', 'Votación', 'Conteo', 'Resultado']
const currentRoundRecord = computed(() => state.value?.rounds?.find((item) => item.id === round.value?.id))
/** Every seat of the election is filled, across its first vote and its runoffs. */
function electionComplete(target: RoundRecord) {
  const root = rootRoundOf(target) || target
  // A favor / En contra settles on its single vote, approved or not.
  if (root.category === 'decision' && root.decisionFormat === 'boolean') return Boolean(target.outcome)
  const seats = root.category === 'committee' ? Math.max(1, root.memberCount ?? 1) : 1
  return (root.officialResult?.elected.length ?? 0) >= seats
}
/** The runoff draft that closing this vote prepared, waiting for the mesa to open it. */
function runoffOf(target: RoundRecord) {
  return state.value?.rounds?.find((item) => item.runoffSourceRoundId === target.id && item.status === 'draft')
}
/** From the 3rd vote on, an election's runoff draft may take a new candidate; never the first runoff or a decision. */
function acceptsNewCandidates(target: RoundRecord) {
  return target.status === 'draft' && target.category !== 'decision' && Boolean(target.runoff) && voteNumber(target) >= 3
}
const preparedRunoff = computed(() => {
  const chosen = state.value?.rounds?.find((item) => item.id === preparingRunoffId.value)
  if (chosen && acceptsNewCandidates(chosen)) return chosen
  return currentRoundRecord.value && acceptsNewCandidates(currentRoundRecord.value) ? currentRoundRecord.value : undefined
})
const currentRoundComplete = computed(() => Boolean(currentRoundRecord.value && electionComplete(currentRoundRecord.value)))
const moderatorWorkflowStep = computed(() => {
  if (preparedRunoff.value) return 1
  if (round.value?.status === 'open') return 2
  if (round.value?.status === 'closed') return 3
  if (round.value?.status === 'published') return currentRoundComplete.value ? 5 : 4
  if (round.value?.status === 'draft') return 1
  return lobbyStatus.value === 'lobby_open' ? 0 : 1
})
watch(assemblyId, () => { participantLeft.value = ''; participantLeftId.value = '' })

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

function voteNumber(target: { id: string; committeeRootRoundId?: string | null; voteNumber?: number }) {
  if (target.voteNumber) return target.voteNumber
  const rootId = target.committeeRootRoundId || target.id
  const chain = (state.value?.rounds || []).filter((item) => item.id === rootId || item.committeeRootRoundId === rootId)
  // Annulled votes do not count: the vote that repeats one keeps its number.
  const before = chain.slice(0, Math.max(0, chain.findIndex((item) => item.id === target.id)))
  return before.filter((item) => item.status !== 'annulled').length + 1
}
function rootRoundOf(target: { id: string; committeeRootRoundId?: string | null }) {
  return state.value?.rounds?.find((item) => item.id === (target.committeeRootRoundId || target.id))
}

/** An annulled vote is the only one the mesa repeats by hand, with the same options. */
function repeatAllOptions(target: RoundRecord | undefined) {
  if (target) void moderatorAction(`/moderator/rounds/${encodeURIComponent(target.id)}/repeat`, 'POST', { optionIds: target.options.map((option) => option.id) })
}

function openRunoff(target: RoundRecord) {
  const runoff = runoffOf(target)
  if (!runoff) return
  // From the 3rd vote on the mesa first sees the ballot, where it may add a candidate.
  if (acceptsNewCandidates(runoff)) { preparingRunoffId.value = runoff.id; newRunoffCandidate.value = ''; return }
  void moderatorAction(`/moderator/rounds/${encodeURIComponent(runoff.id)}/open`)
}

async function changeRunoffCandidates(path: string, method: 'POST' | 'DELETE', body?: unknown) {
  if (loading.value) return false
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, moderatorToken.value)
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded) await refresh(true)
  return succeeded
}

async function addRunoffCandidate() {
  const runoff = preparedRunoff.value
  const label = newRunoffCandidate.value.trim()
  if (!runoff || !label) return
  if (await changeRunoffCandidates(`/moderator/rounds/${encodeURIComponent(runoff.id)}/candidates`, 'POST', { label })) newRunoffCandidate.value = ''
}

function removeRunoffCandidate(optionId: string) {
  const runoff = preparedRunoff.value
  if (runoff) void changeRunoffCandidates(`/moderator/rounds/${encodeURIComponent(runoff.id)}/candidates/${encodeURIComponent(optionId)}`, 'DELETE')
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

function chooseRoundCategory(category: RoundCategory) {
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
            ? { title: '¿Repetir la votación?', consequence: 'Se prepara una papeleta con las mismas opciones.', label: 'Repetir votación' }
          : path.endsWith('/publish')
            ? { title: '¿Publicar el conteo?', consequence: 'Teléfonos y proyector mostrarán el conteo y los electos.', label: 'Publicar conteo' }
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

/** Inhabilitar / Habilitar is reversible and audited, so it applies at once without a confirmation step. */
async function setVotingDisabled(participantId: string | undefined, disabled: boolean) {
  if (!participantId || loading.value) return
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    await request(`/moderator/participants/${encodeURIComponent(participantId)}/${disabled ? 'disable' : 'enable'}-voting`, { method: 'POST' }, moderatorToken.value)
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (!succeeded) return
  if (participantId === participantLeftId.value) { participantLeft.value = ''; participantLeftId.value = '' }
  await refresh(true)
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
  decisionFormat.value = 'boolean'
  approvalRule.value = 'simple'
}

async function createRound() {
  if (newBallotCandidate.value.trim()) addBallotCandidate()
  const category = roundCategory.value
  const options = ballotCandidates.value.map((label) => ({ label }))
  const seats = committeeMemberCount.value
  if (!roundTitle.value.trim()) { error.value = { office: 'Escribe el cargo que se vota.', committee: 'Escribe el nombre de la comisión.', decision: 'Escribe la decisión que se vota.' }[category]; return }
  if (category === 'office' && options.length < 2) { error.value = 'Agrega al menos dos candidatos.'; return }
  if (category === 'committee' && (!seats || seats < 1)) { error.value = 'Indica cuántos integrantes quedarán en la comisión.'; return }
  if (category === 'committee' && options.length < seats!) { error.value = `Agrega al menos ${seats} candidatos: pueden ser más que los integrantes, pero no menos.`; return }
  if (category === 'decision' && decisionFormat.value === 'options' && options.length < 2) { error.value = 'Agrega al menos dos opciones.'; return }
  showNextBallotForm.value = false
  // The server computes every result; a decision also carries its format and the rule that approves it.
  await moderatorAction(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/rounds`, 'POST', {
    title: roundTitle.value.trim(), format: category === 'committee' ? 'multiple_choice' : 'single_choice', category,
    ...(category === 'decision'
      ? { decisionFormat: decisionFormat.value, approvalRule: approvalRule.value, ...(decisionFormat.value === 'options' ? { options } : {}) }
      : { options }),
    ...(category === 'committee' ? { memberCount: seats } : {}),
  }, resetBallotForm)
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
    moderationConfirmation, moderationReason, moderatorCredential, assemblyName, roundTitle, roundCategory, committeeMemberCount, decisionFormat, approvalRule,
    showNextBallotForm, resumeQr, ballotCandidates, newBallotCandidate, preparedRunoff, newRunoffCandidate,
    secrecyCleanupPendingRounds, assemblyStatusLabels, roundStatusLabels, attendance, moderatorWorkflow, currentRoundRecord,
    moderatorWorkflowStep, otherPendingActas,
    roundChain, voteNumber, rootRoundOf, eligibleOf, rankedRows, electionComplete, runoffOf,
    annulRound, repeatAllOptions, openRunoff, addBallotCandidate, addRunoffCandidate, removeRunoffCandidate,
    removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, setVotingDisabled, openCompletedAssembly,
    openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, deleteAssemblyData,
    createAssembly, editParticipant, createRound, signInModerator,
  }
}
