import { es } from './locale/es'
import { computed, nextTick, ref } from 'vue'
import QRCode from 'qrcode'
import { xlsxBlob } from './xlsx'
import { showTransientNotice } from './transient-notice'
import { actaSheetRows, decisionTie } from './resultados'
import type { ApprovalRule, DecisionFormat, Position, RoundCategory, RoundRecord } from './types'
import { useAssembly } from './useAssembly'

const {
  loading, error, notice, state, code, moderatorToken, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies,
  liveAssembly, assemblyStatus, lobbyStatus, round, eligibleVotes, request, requestFile, isUnauthorized, refresh, setBrowsingActas, selectAssembly,
  recoverActiveAssembly, rememberJoinCode,
} = useAssembly()

const moderationConfirmation = ref<{ title: string; consequence: string; warning?: string; label: string; path: string; method: string; body?: unknown; reasonLabel?: string; reasonPlaceholder?: string; typedConfirmation?: string; onSuccess?: (result: any) => void | Promise<void> } | null>(null)
const moderationReason = ref('')
const moderatorCredential = ref('')
const assemblyName = ref(es.moderator.defaultAssemblyName)
const assemblyPeriod = ref('')
/** M25: a cargo fills a puesto of the org chart; its name is the ballot's title. */
const roundPositionId = ref('')
const positionMenuOpen = ref(false)
const newDepartment = ref('')
const positions = computed<Position[]>(() => state.value?.positions || [])
const positionGroups = computed(() => [
  { group: 'board' as const, label: es.common.boardTitle, items: positions.value.filter((item) => item.group === 'board') },
  { group: 'department' as const, label: es.common.departmentsTitle, items: positions.value.filter((item) => item.group === 'department') },
])
const selectedPosition = computed(() => positions.value.find((item) => item.id === roundPositionId.value))
const roundTitle = ref('')
const roundCategory = ref<RoundCategory>('office')
const committeeMemberCount = ref<number | null>(null)
const decisionFormat = ref<DecisionFormat>('boolean')
const approvalRule = ref<ApprovalRule>('simple')
const showNextBallotForm = ref(false)
const resumeQr = ref<{ heading?: string; name: string; image: string; url: string; expiresAt: string } | null>(null)
const regionalSecretaryFirstName = ref('')
const regionalSecretaryLastName = ref('')
const ballotCandidates = ref<string[]>([])
const newBallotCandidate = ref('')
/** The runoff draft from the 3rd vote on that the mesa is preparing (M22) before opening it. */
const preparingRunoffId = ref('')
const newRunoffCandidate = ref('')
const secrecyCleanupPendingRounds = computed(() => (state.value?.rounds || []).filter((item) => item.secrecyCleanupPending))
const assemblyStatusLabels: Record<string, string> = es.moderator.assemblyStatus
const roundStatusLabels: Record<string, string> = es.moderator.roundStatus
function roundChain(target: RoundRecord) {
  return (state.value?.rounds || []).filter((item) => item.id === target.id || item.committeeRootRoundId === target.id)
}
const attendance = computed(() => {
  const record = state.value?.attendanceRound
  if (!record) return null
  const participants = state.value?.participants || []
  const disabled = participants.filter((person) => person.votingDisabled).length
  const pending = record.status === 'open' ? Math.max(0, (record.eligibleCount ?? participants.length) - record.votedCount - disabled) : null
  return { ...record, pending, disabled }
})
const roomWarning = computed(() => {
  const room = state.value?.room
  return room && room.present < room.quorum ? es.moderator.noQuorum : ''
})
const roomLine = computed(() => {
  const room = state.value?.room
  return room ? es.moderator.roomLine(room.present, room.accredited, room.quorum) : ''
})
const moderatorWorkflow = es.moderator.workflow
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
function acceptsRegionalSecretary(target: RoundRecord) {
  if (target.status !== 'draft' || !target.runoff || voteNumber(target) < 4) return false
  if (target.regionalSecretaryVotes) return true
  const chain = roundChain(rootRoundOf(target) || target)
  const counted = chain.slice(0, chain.findIndex((item) => item.id === target.id)).filter((item) => item.status === 'closed' || item.status === 'published')
  const previous = counted.at(-1)
  return Boolean(previous && decisionTie(previous))
}
function needsPreparation(target: RoundRecord) {
  return acceptsNewCandidates(target) || acceptsRegionalSecretary(target)
}
const preparedRunoff = computed(() => {
  const chosen = state.value?.rounds?.find((item) => item.id === preparingRunoffId.value)
  if (chosen && needsPreparation(chosen)) return chosen
  return currentRoundRecord.value && needsPreparation(currentRoundRecord.value) ? currentRoundRecord.value : undefined
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

function eligibleOf(target: RoundRecord) {
  const own = (target as RoundRecord & { eligibleCount?: number }).eligibleCount
  if (own !== undefined) return own
  if (target.id === round.value?.id && eligibleVotes.value) return eligibleVotes.value
  return state.value?.participants?.length ?? 0
}

function annulRound(target: { id: string; title: string }) {
  moderationReason.value = ''
  moderationConfirmation.value = {
    title: es.moderator.confirm.annul.title,
    consequence: es.moderator.confirm.annul.consequence(target.title),
    label: es.moderator.confirm.annul.label,
    path: `/moderator/rounds/${encodeURIComponent(target.id)}/annul`,
    method: 'POST',
    reasonLabel: es.moderator.confirm.annul.reasonLabel,
    reasonPlaceholder: es.moderator.confirm.annul.reasonPlaceholder,
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
  if (needsPreparation(runoff)) { preparingRunoffId.value = runoff.id; newRunoffCandidate.value = ''; return }
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

function choosePosition(position: Position) {
  if (position.elected) return
  roundPositionId.value = position.id
  positionMenuOpen.value = false
}

async function addDepartment() {
  const label = newDepartment.value.trim()
  if (!label || !assemblyId.value || loading.value) return
  error.value = ''
  loading.value = true
  let added: Position | null = null
  try {
    added = await request<Position>('/moderator/positions', { method: 'POST', body: JSON.stringify({ assemblyId: assemblyId.value, label }) }, moderatorToken.value)
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (!added) return
  newDepartment.value = ''
  roundPositionId.value = added.id
  await refresh(true)
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

async function addRegionalSecretary() {
  const runoff = preparedRunoff.value
  const known = state.value?.regionalSecretary
  const firstName = (known?.firstName ?? regionalSecretaryFirstName.value).trim()
  const lastName = (known?.lastName ?? regionalSecretaryLastName.value).trim()
  if (!runoff || !firstName || !lastName || loading.value) return
  error.value = ''
  loading.value = true
  try {
    const result = await request<{ name: string; resumeUrl: string; expiresAt: string }>(`/moderator/rounds/${encodeURIComponent(runoff.id)}/regional-secretary`, { method: 'POST', body: JSON.stringify({ firstName, lastName }) }, moderatorToken.value)
    resumeQr.value = { heading: `Ingreso de ${result.name}`, name: result.name, url: result.resumeUrl, expiresAt: result.expiresAt, image: await QRCode.toDataURL(result.resumeUrl, { width: 300, margin: 2 }) }
    regionalSecretaryFirstName.value = ''
    regionalSecretaryLastName.value = ''
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  await refresh(true)
}

function removeRegionalSecretary() {
  const runoff = preparedRunoff.value
  if (runoff) void changeRunoffCandidates(`/moderator/rounds/${encodeURIComponent(runoff.id)}/regional-secretary`, 'DELETE')
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
    ? es.moderator.confirm.reopenEntry
    : path.endsWith('/lobby')
    ? es.moderator.confirm.closeEntry
    : path.endsWith('/rounds')
      ? es.moderator.confirm.prepareBallot
      : path.endsWith('/open')
        ? { title: es.moderator.confirm.openVote.title, consequence: es.moderator.confirm.openVote.consequence, label: es.moderator.confirm.openVote.label, ...(roomWarning.value ? { warning: es.moderator.confirm.openVote.warning(roomWarning.value) } : {}) }
        : path.endsWith('/close')
          ? es.moderator.confirm.closeVote
          : path.endsWith('/repeat')
            ? es.moderator.confirm.repeatVote
            : removed
              ? es.moderator.confirm.removeParticipant
              : es.moderator.confirm.saveChanges
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
    showTransientNotice(notice, es.moderator.notices.actionRecorded, (run, ms) => { setTimeout(run, ms) })
    succeeded = true
    await action.onSuccess?.(result)
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded && action.path.endsWith('/complete')) notice.value = es.moderator.notices.assemblyCompleted
  if (succeeded) await refresh(true)
}

function registerOfficial(record: RoundRecord) {
  const root = rootRoundOf(record) ?? record
  const result = root.officialResult
  const named = result?.approved === null || result?.approved === undefined
    ? result?.elected.map((person) => person.label).join(' · ') ?? ''
    : `${root.title}: ${result.approved ? es.results.approved : es.results.notApproved}`
  moderationConfirmation.value = {
    title: es.moderator.confirm.register.title,
    consequence: es.moderator.confirm.register.consequence(named),
    label: es.results.register,
    path: `/moderator/elections/${encodeURIComponent(root.id)}/register`,
    method: 'POST',
  }
}

function rotateJoinCode() {
  if (!assemblyId.value) return
  moderationConfirmation.value = {
    title: es.moderator.confirm.rotateCode.title,
    consequence: es.moderator.confirm.rotateCode.consequence,
    label: es.moderator.confirm.rotateCode.label,
    path: `/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/join-code`,
    method: 'POST',
    onSuccess: async (result: { joinCode: string; joinUrl: string }) => {
      rememberJoinCode(result.joinCode)
      qrImage.value = await QRCode.toDataURL(result.joinUrl, { width: 300, margin: 2 })
      notice.value = es.moderator.notices.newCodeGenerated
    },
  }
}

function issueResumeCode(person: { id?: string; firstName: string; lastName: string }) {
  if (!person.id) return
  moderationConfirmation.value = {
    title: es.moderator.confirm.reconnect.title(`${person.firstName} ${person.lastName}`),
    consequence: es.moderator.confirm.reconnect.consequence,
    label: es.moderator.confirm.reconnect.label,
    path: `/moderator/participants/${encodeURIComponent(person.id)}/resume-code`,
    method: 'POST',
    onSuccess: async (result: { name: string; resumeUrl: string; expiresAt: string }) => {
      resumeQr.value = { name: result.name, url: result.resumeUrl, expiresAt: result.expiresAt, image: await QRCode.toDataURL(result.resumeUrl, { width: 300, margin: 2 }) }
      notice.value = ''
    },
  }
}

function removeFromRoom(person: { id?: string; firstName: string; lastName: string }) {
  if (!person.id) return
  const isSecretary = person.id === state.value?.regionalSecretary?.id
  moderationConfirmation.value = {
    title: es.moderator.confirm.takeOut.title(`${person.firstName} ${person.lastName}`),
    consequence: es.moderator.confirm.takeOut.consequence(isSecretary),
    label: es.moderator.confirm.takeOut.label,
    path: `/moderator/participants/${encodeURIComponent(person.id)}/take-out`,
    method: 'POST',
  }
}

async function returnToRoom(participantId: string | undefined) {
  if (!participantId || loading.value) return
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    await request(`/moderator/participants/${encodeURIComponent(participantId)}/return`, { method: 'POST' }, moderatorToken.value)
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded) await refresh(true)
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
    notice.value = es.moderator.notices.cleanupDone
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded) await refresh(true)
}

async function completeAssembly() {
  if (!assemblyId.value || assemblyStatus.value === 'completed' || round.value?.status === 'open') return
  moderationConfirmation.value = {
    title: es.moderator.confirm.complete.title,
    consequence: es.moderator.confirm.complete.consequence,
    label: es.moderator.confirm.complete.label,
    path: `/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/complete`,
    method: 'POST', body: { confirmation: true },
  }
}

async function printActa() {
  printingActa.value = true
  await nextTick()
  window.print()
}

function assemblyFileSlug() {
  return (state.value?.assembly?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || es.moderator.files.fallbackSlug
}

function downloadActaSpreadsheet() {
  const rows = actaSheetRows(state.value?.rounds || [], roundStatusLabels)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(xlsxBlob(es.acta.sheetName, rows))
  link.download = `${es.moderator.files.actaPrefix}${assemblyFileSlug()}.xlsx`
  link.click()
  URL.revokeObjectURL(link.href)
}

async function downloadOperatorLog(purpose: 'review' | 'delete' = 'review') {
  if (!assemblyId.value || loading.value) return false
  error.value = ''
  loading.value = true
  try {
    const blob = await requestFile(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/log`, { purpose }, moderatorToken.value)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${es.moderator.files.logPrefix}${assemblyFileSlug()}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
    notice.value = purpose === 'delete' ? es.moderator.notices.logDownloadedForDelete : es.moderator.notices.logDownloaded
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  } finally { loading.value = false }
}

async function deleteAssemblyData() {
  if (!assemblyId.value || assemblyStatus.value !== 'completed') return
  const deletedId = assemblyId.value
  if (!await downloadOperatorLog('delete')) return
  moderationConfirmation.value = {
    title: es.moderator.confirm.deleteData.title,
    consequence: es.moderator.confirm.deleteData.consequence,
    label: es.moderator.confirm.deleteData.label,
    reasonLabel: es.moderator.confirm.deleteData.reasonLabel,
    typedConfirmation: es.moderator.confirm.deleteData.typed,
    path: `/moderator/assemblies/${encodeURIComponent(deletedId)}`,
    method: 'DELETE', body: { confirmation: true },
    onSuccess: (result: { vacuumed: boolean }) => {
      notice.value = result.vacuumed
        ? es.moderator.notices.dataDeleted
        : es.moderator.notices.dataDeletedNoVacuum
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
      method: 'POST', body: JSON.stringify({ name: assemblyName.value, ...(assemblyPeriod.value.trim() ? { period: assemblyPeriod.value.trim() } : {}) }),
    }, moderatorToken.value)
    setBrowsingActas(false)
    assemblyId.value = result.assemblyId
    sessionStorage.setItem('assemblyId', result.assemblyId)
    rememberJoinCode(result.joinCode)
    qrImage.value = await QRCode.toDataURL(result.joinUrl || `${window.location.origin}/?join=${encodeURIComponent(result.joinCode)}`, { width: 300, margin: 2 })
    notice.value = es.moderator.notices.assemblyCreated(result.joinCode)
    created = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (created) await refresh(true)
}

function editParticipant(person: { id?: string; firstName: string; lastName: string }) {
  if (!person.id) return
  const updatedFirst = window.prompt(es.moderator.prompts.firstName, person.firstName)
  if (updatedFirst === null) return
  const updatedLast = window.prompt(es.moderator.prompts.lastName, person.lastName)
  if (updatedLast === null) return
  void moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', {
    firstName: updatedFirst.trim(), lastName: updatedLast.trim(),
  })
}

function resetBallotForm() {
  roundTitle.value = ''
  roundPositionId.value = ''
  positionMenuOpen.value = false
  newDepartment.value = ''
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
  if (category === 'office' && !selectedPosition.value) { error.value = es.moderator.errors.pickPosition; return }
  if (category !== 'office' && !roundTitle.value.trim()) { error.value = { committee: es.moderator.errors.committeeName, decision: es.moderator.errors.decisionTitle }[category]; return }
  if (category === 'office' && options.length < 2) { error.value = es.moderator.errors.twoCandidates; return }
  if (category === 'committee' && (!seats || seats < 1)) { error.value = es.moderator.errors.committeeSeats; return }
  if (category === 'committee' && options.length < seats!) { error.value = es.moderator.errors.minCandidates(seats!); return }
  if (category === 'decision' && decisionFormat.value === 'options' && options.length < 2) { error.value = es.moderator.errors.twoOptions; return }
  showNextBallotForm.value = false
  // The server computes every result; a decision also carries its format and the rule that approves it.
  await moderatorAction(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}/rounds`, 'POST', {
    ...(category === 'office' ? { positionId: roundPositionId.value } : { title: roundTitle.value.trim() }),
    format: category === 'committee' ? 'multiple_choice' : 'single_choice', category,
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
      error.value = es.moderator.errors.invalidCredential
    } else {
      moderatorAuthState.value = 'validation_error'
      error.value = message
    }
  }
}

export function useMesa() {
  return {
    moderationConfirmation, moderationReason, moderatorCredential, assemblyName, assemblyPeriod, roundTitle,
    roundPositionId, positionMenuOpen, newDepartment, positionGroups, selectedPosition, choosePosition, addDepartment, roundCategory, committeeMemberCount, decisionFormat, approvalRule,
    showNextBallotForm, resumeQr, regionalSecretaryFirstName, regionalSecretaryLastName, acceptsNewCandidates, acceptsRegionalSecretary, addRegionalSecretary, removeRegionalSecretary, ballotCandidates, newBallotCandidate, preparedRunoff, newRunoffCandidate,
    secrecyCleanupPendingRounds, assemblyStatusLabels, roundStatusLabels, attendance, roomLine, roomWarning, moderatorWorkflow, currentRoundRecord,
    moderatorWorkflowStep, otherPendingActas,
    roundChain, voteNumber, rootRoundOf, eligibleOf, electionComplete, runoffOf,
    annulRound, registerOfficial, repeatAllOptions, openRunoff, addBallotCandidate, addRunoffCandidate, removeRunoffCandidate,
    removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, setVotingDisabled, removeFromRoom, returnToRoom, openCompletedAssembly,
    openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, downloadOperatorLog, deleteAssemblyData,
    createAssembly, editParticipant, createRound, signInModerator,
  }
}
