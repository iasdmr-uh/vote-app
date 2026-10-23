import { computed, ref } from 'vue'
import QRCode from 'qrcode'
import { io, type Socket } from 'socket.io-client'
import type { PublicState } from './types'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
const origin = window.location.origin
const route = ref(window.location.pathname)
const loading = ref(false)
const syncing = ref(false)
const error = ref('')
const notice = ref('')
const state = ref<PublicState | null>(null)
const urlParams = new URLSearchParams(window.location.search)
const incomingJoinCode = urlParams.get('join') || urlParams.get('code') || ''
const incomingResumeCode = urlParams.get('resume') || ''
const code = ref(incomingJoinCode || localStorage.getItem('assemblyJoinCode') || '')
const firstName = ref('')
const lastName = ref('')
const sessionToken = ref(localStorage.getItem('participantSessionToken') || '')
const sessionAssemblyId = ref(localStorage.getItem('participantAssemblyId') || '')
const pendingJoinCode = ref('')
const moderatorToken = ref(sessionStorage.getItem('moderatorToken') || '')
const moderatorAuthState = ref<'unauthenticated' | 'validating' | 'authenticated' | 'validation_error'>(moderatorToken.value ? 'validating' : 'unauthenticated')
const assemblyId = ref(sessionStorage.getItem('assemblyId') || '')
const selectedOptions = ref<string[]>([])
const reviewingVote = ref(false)
const voteSubmitting = ref(false)
const qrImage = ref('')
const realtimeActive = ref(false)
const realtimeConnected = ref(false)
const projectorFullscreen = ref(false)
const printingActa = ref(false)
const completedAssemblies = ref<Array<{ id: string; name: string; completedAt: string | null }>>([])
const liveAssembly = ref<{ id: string; name: string } | null>(null)
const browsingActas = ref(sessionStorage.getItem('browsingActas') === 'true')
const participantLeft = ref('')
let refreshTimer: number | undefined
let realtimeSocket: Socket | null = null
let lastRefreshAt = 0
let incomingJoinChecked = false
let refreshQueued = false
let scheduledRefresh: number | undefined
const POLL_WHILE_DISCONNECTED_MS = 7_000
const POLL_WHILE_CONNECTED_MS = 30_000

const role = computed(() => route.value.startsWith('/moderator') ? 'moderator' : route.value.startsWith('/projector') ? 'projector' : 'participant')
const assemblyStatus = computed(() => state.value?.assembly?.status || state.value?.status || 'preparing')
const lobbyStatus = computed(() => state.value?.assembly?.lobbyStatus || (state.value?.lobbyStatus === 'open' || assemblyStatus.value === 'lobby_open' ? 'lobby_open' : 'lobby_closed'))
const round = computed(() => state.value?.currentRound)
const assemblyCompletedAt = computed(() => state.value?.assembly?.completedAt || state.value?.assemblyCompletedAt || null)
const totalParticipants = computed(() => state.value?.participantCount ?? state.value?.participants?.length ?? 0)
const eligibleVotes = computed(() => state.value?.eligibleCount ?? state.value?.participantCount ?? 0)
const completionTime = computed(() => assemblyCompletedAt.value
  ? new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(assemblyCompletedAt.value))
  : '')
const ballotMaxChoices = computed(() => round.value?.electionSeats ?? round.value?.memberCount ?? null)
const projectorJoinUrl = computed(() => {
  if (state.value?.joinUrl) return state.value.joinUrl
  const url = new URL(state.value?.publicAppUrl || origin)
  url.searchParams.set('join', code.value)
  return url.toString()
})

function go(path: string) {
  const enteringModerator = path.startsWith('/moderator')
  if (enteringModerator) {
    moderatorAuthState.value = moderatorToken.value ? 'validating' : 'unauthenticated'
    state.value = null
  } else if (role.value === 'moderator') {
    state.value = null
  }
  history.pushState({}, '', path)
  route.value = path
  error.value = ''
  notice.value = ''
  void refresh()
}

function openProjectorWindow() {
  if (!code.value) {
    error.value = 'Primero crea una Asamblea para abrir su proyección.'
    return
  }
  const projectorUrl = new URL('/projector', window.location.origin)
  projectorUrl.searchParams.set('code', code.value)
  const projectorWindow = window.open(projectorUrl, 'asdmr-projector', 'popup,width=1600,height=900')
  if (!projectorWindow) {
    error.value = 'El navegador bloqueó la ventana. Permite las ventanas emergentes para abrir la proyección.'
    return
  }
  projectorWindow.opener = null
  projectorWindow.focus()
  error.value = ''
  notice.value = 'Proyección abierta en otra ventana. Muévela a la pantalla del televisor y actívala en pantalla completa.'
}

function syncProjectorFullscreen() {
  projectorFullscreen.value = Boolean(document.fullscreenElement)
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(path: string, init: RequestInit = {}, token = ''): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API}${path}`, { ...init, headers })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiRequestError(body.message || 'No se pudo completar la solicitud. Intenta de nuevo.', response.status)
  return body as T
}

function isUnauthorized(e: unknown) {
  return e instanceof ApiRequestError && e.status === 401
}

function handleParticipantUnauthorized(e: unknown, token: string) {
  if (!isUnauthorized(e) || role.value !== 'participant' || !token || token !== sessionToken.value) return false
  clearParticipantSession()
  error.value = 'La sesión de delegado ya no está activa. Vuelve a ingresar mientras el ingreso a la asamblea esté abierto.'
  notice.value = ''
  return true
}

function clearParticipantSession() {
  sessionToken.value = ''
  sessionAssemblyId.value = ''
  pendingJoinCode.value = ''
  state.value = null
  selectedOptions.value = []
  reviewingVote.value = false
  voteSubmitting.value = false
  firstName.value = ''
  lastName.value = ''
  localStorage.removeItem('participantSessionToken')
  localStorage.removeItem('participantAssemblyId')
}

function normalizeState(value: Record<string, any>): PublicState {
  const rawRound = value.currentRound || value.openRound || value.round || value.rounds?.at(-1) || null
  const options = rawRound?.options?.map((option: any) => ({ id: option.id || option.optionId, label: option.label }))
  const currentRound = rawRound ? {
    id: rawRound.id || rawRound.roundId,
    title: rawRound.title,
    status: rawRound.status,
    format: rawRound.format,
    category: rawRound.category || 'office',
    memberCount: rawRound.memberCount,
    electionSeats: rawRound.electionSeats,
    annulReason: rawRound.annulReason,
    ...(options ? { options } : {}),
    ...(rawRound.participationCount !== undefined ? { participationCount: rawRound.participationCount } : {}),
  } : undefined
  const assembly = value.assembly || (value.assemblyStatus
    ? { status: value.assemblyStatus }
    : value.id ? { id: value.id, name: value.name, status: value.status, completedAt: value.completedAt ?? null } : undefined)
  return {
    ...value,
    assembly,
    lobbyStatus: value.lobbyStatus,
    currentRound,
    results: value.results || rawRound?.results,
    participants: value.participants,
    participantCount: value.participantCount,
    recordedCount: value.recordedCount ?? rawRound?.participationCount,
    participationStatus: value.participationStatus,
    eligibleCount: value.eligibleCount ?? value.participantCount ?? value.participants?.length,
  }
}

async function refresh(afterAction = false) {
  if (loading.value || (syncing.value && !afterAction)) { refreshQueued = true; return }
  await loadState()
  lastRefreshAt = Date.now()
  if (refreshQueued && !loading.value && !syncing.value) {
    refreshQueued = false
    await refresh()
  }
}

function scheduleRefresh() {
  if (scheduledRefresh !== undefined) return
  scheduledRefresh = window.setTimeout(() => {
    scheduledRefresh = undefined
    void refresh()
  }, 100 + Math.random() * 400)
}

let stateLoadSeq = 0
async function loadState() {
  const seq = ++stateLoadSeq
  if (role.value === 'participant' && sessionToken.value) {
    syncing.value = true
    const requestToken = sessionToken.value
    try {
      const participantState = await request<Record<string, any>>('/participant/me', {}, requestToken)
      if (sessionToken.value !== requestToken || seq !== stateLoadSeq) return
      const loadedState = normalizeState(participantState)
      error.value = ''
      const participantAssemblyId = String(participantState.assembly?.id || sessionAssemblyId.value)
      if (participantAssemblyId) {
        sessionAssemblyId.value = participantAssemblyId
        localStorage.setItem('participantAssemblyId', participantAssemblyId)
      }
      if (incomingJoinCode && participantAssemblyId && !incomingJoinChecked) {
        incomingJoinChecked = true
        const target = await request<Record<string, any>>(`/assemblies/${encodeURIComponent(incomingJoinCode)}/public-state`)
          .catch((e) => { if (e instanceof ApiRequestError && e.status === 404) return null; throw e })
        const targetAssemblyId = String(target?.assembly?.id || '')
        if (sessionToken.value !== requestToken || seq !== stateLoadSeq) return
        if (targetAssemblyId && targetAssemblyId !== participantAssemblyId) pendingJoinCode.value = incomingJoinCode
        else {
          pendingJoinCode.value = ''
          if (target) code.value = incomingJoinCode
        }
      }
      state.value = pendingJoinCode.value ? null : loadedState
    } catch (e) {
      if (sessionToken.value !== requestToken) return
      if (!handleParticipantUnauthorized(e, requestToken) && !(state.value && realtimeActive.value && !realtimeConnected.value)) {
        error.value = (e as Error).message
      }
    } finally { syncing.value = false }
  } else if (role.value === 'projector' && code.value) {
    syncing.value = true
    try {
      const publicState = await request<Record<string, any>>(`/assemblies/${encodeURIComponent(code.value)}/public-state`)
      if (seq !== stateLoadSeq) return
      state.value = normalizeState(publicState)
      error.value = ''
    }
    catch (e) { if (!state.value) error.value = (e as Error).message }
    finally { syncing.value = false }
  } else if (role.value === 'moderator' && moderatorToken.value && assemblyId.value) {
    syncing.value = true
    try {
      if (moderatorAuthState.value !== 'authenticated') {
        moderatorAuthState.value = 'validating'
        state.value = null
      }
      const moderatorState = await request<Record<string, any>>(`/moderator/assemblies/${encodeURIComponent(assemblyId.value)}`, {}, moderatorToken.value)
      if (seq !== stateLoadSeq) return
      state.value = normalizeState(moderatorState)
      moderatorAuthState.value = 'authenticated'
      void loadAssemblyLists().catch(() => undefined)
      sessionStorage.setItem('moderatorToken', moderatorToken.value)
      error.value = ''
    }
    catch (e) {
      const message = (e as Error).message
      if (isUnauthorized(e)) {
        moderatorToken.value = ''
        moderatorAuthState.value = 'unauthenticated'
        state.value = null
        sessionStorage.removeItem('moderatorToken')
        error.value = 'La credencial guardada ya no es válida. Ingresa de nuevo la clave de moderación.'
      } else if (state.value && realtimeActive.value && !realtimeConnected.value) {
        error.value = ''
      } else {
        moderatorAuthState.value = 'validation_error'
        state.value = null
        error.value = message
      }
    }
    finally { syncing.value = false }
  } else if (role.value === 'moderator' && moderatorToken.value) {
    syncing.value = true
    moderatorAuthState.value = 'validating'
    try {
      await request('/moderator/session', {}, moderatorToken.value)
      moderatorAuthState.value = 'authenticated'
      sessionStorage.setItem('moderatorToken', moderatorToken.value)
      error.value = ''
      await recoverActiveAssembly()
    } catch (e) {
      const message = (e as Error).message
      state.value = null
      if (isUnauthorized(e)) {
        moderatorToken.value = ''
        moderatorAuthState.value = 'unauthenticated'
        sessionStorage.removeItem('moderatorToken')
        error.value = 'La credencial guardada ya no es válida. Ingresa de nuevo la clave de moderación.'
      } else {
        moderatorAuthState.value = 'validation_error'
        error.value = message
      }
    } finally { syncing.value = false }
    if (assemblyId.value) await refresh()
  }
}

async function resumeParticipantSession(resumeCode: string) {
  history.replaceState({}, '', window.location.pathname)
  loading.value = true
  try {
    const resumed = await request<Record<string, any>>('/assemblies/resume', { method: 'POST', body: JSON.stringify({ resumeCode }) })
    clearParticipantSession()
    sessionToken.value = resumed.participantSessionToken
    sessionAssemblyId.value = String(resumed.assembly?.id || '')
    localStorage.setItem('participantSessionToken', resumed.participantSessionToken)
    if (sessionAssemblyId.value) localStorage.setItem('participantAssemblyId', sessionAssemblyId.value)
    state.value = normalizeState(resumed)
    notice.value = 'Tu sesión se reconectó en este dispositivo.'
  } catch (e) {
    error.value = e instanceof ApiRequestError && e.status === 404
      ? 'El código de reconexión no es válido o ya venció. Pide uno nuevo a la mesa.'
      : (e as Error).message
  } finally { loading.value = false }
}

function setBrowsingActas(value: boolean) {
  browsingActas.value = value
  if (value) sessionStorage.setItem('browsingActas', 'true')
  else sessionStorage.removeItem('browsingActas')
}

function selectAssembly(id: string) {
  assemblyId.value = id
  sessionStorage.setItem('assemblyId', id)
  code.value = localStorage.getItem('assemblyJoinCodeAssemblyId') === id ? localStorage.getItem('assemblyJoinCode') || '' : ''
  qrImage.value = ''
}

async function loadAssemblyLists() {
  const recovered = await request<{ assembly: { id: string; name: string } | null; completed?: Array<{ id: string; name: string; completedAt: string | null }> }>('/moderator/assemblies/active', {}, moderatorToken.value)
  liveAssembly.value = recovered.assembly
  completedAssemblies.value = recovered.completed || []
  return recovered.assembly
}

async function recoverActiveAssembly() {
  if (assemblyId.value) return
  let assembly: { id: string; name: string } | null = null
  try {
    assembly = await loadAssemblyLists()
  } catch {
    return
  }
  if (!assembly || browsingActas.value) return
  selectAssembly(assembly.id)
  notice.value = `Se recuperó la Asamblea activa: ${assembly.name}.`
}

function rememberJoinCode(joinCode: string) {
  code.value = joinCode
  localStorage.setItem('assemblyJoinCode', joinCode)
  localStorage.setItem('assemblyJoinCodeAssemblyId', assemblyId.value)
}

async function refreshQr() {
  if (!code.value) { qrImage.value = ''; return }
  qrImage.value = await QRCode.toDataURL(projectorJoinUrl.value, { width: 420, margin: 2 })
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function syncRealtime() {
  realtimeSocket?.disconnect()
  realtimeSocket = null
  realtimeActive.value = false
  realtimeConnected.value = false
  let auth: Record<string, string> | null = null
  if (role.value === 'participant' && sessionToken.value) auth = { audience: 'participant', participantSessionToken: sessionToken.value }
  else if (role.value === 'moderator' && moderatorToken.value && assemblyId.value) auth = { audience: 'moderator', moderatorCredential: moderatorToken.value, assemblyId: assemblyId.value }
  else if (role.value === 'projector' && code.value) auth = { audience: 'public', assemblyCode: code.value }
  if (!auth) return
  const socketUrl = import.meta.env.VITE_SOCKET_URL || `${API.replace(/\/api\/v1\/?$/, '')}/events`
  realtimeActive.value = true
  realtimeSocket = io(socketUrl, { auth, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 5000 })
  for (const event of ['assembly.state', 'lobby.state', 'participant.joined', 'participant.updated', 'participant.removed', 'participant.state', 'round.state', 'round.opened', 'round.closed', 'participation.count', 'results.published']) {
    realtimeSocket.on(event, scheduleRefresh)
  }
  realtimeSocket.on('participant.left', (payload: { firstName?: string; lastName?: string } | undefined) => {
    const name = `${payload?.firstName || ''} ${payload?.lastName || ''}`.trim()
    if (name) participantLeft.value = name
    scheduleRefresh()
  })
  realtimeSocket.on('connect', () => { realtimeConnected.value = true; void refresh() })
  realtimeSocket.on('disconnect', () => { realtimeConnected.value = false })
  realtimeSocket.on('connect_error', () => { realtimeConnected.value = false })
}

function startAssembly() {
  window.addEventListener('afterprint', () => { printingActa.value = false })
  document.addEventListener('fullscreenchange', syncProjectorFullscreen)
  window.addEventListener('popstate', () => {
    const nextRoute = window.location.pathname
    if (nextRoute.startsWith('/moderator')) {
      moderatorAuthState.value = moderatorToken.value ? 'validating' : 'unauthenticated'
      state.value = null
    } else if (role.value === 'moderator') state.value = null
    route.value = nextRoute
    void refresh()
  })
  if (incomingResumeCode && role.value === 'participant') void resumeParticipantSession(incomingResumeCode)
  else void refresh()
  void refreshQr()
  syncRealtime()
  refreshTimer = window.setInterval(() => {
    if (loading.value || (role.value === 'moderator' && moderatorAuthState.value === 'validation_error')) return
    const interval = realtimeConnected.value ? POLL_WHILE_CONNECTED_MS : POLL_WHILE_DISCONNECTED_MS
    if (Date.now() - lastRefreshAt >= interval - 500) void refresh()
  }, POLL_WHILE_DISCONNECTED_MS)
}

function stopAssembly() {
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh)
  realtimeSocket?.disconnect()
  document.removeEventListener('fullscreenchange', syncProjectorFullscreen)
}

export function useAssembly() {
  return {
    origin, route, loading, syncing, error, notice, state, code, firstName, lastName, sessionToken, sessionAssemblyId, pendingJoinCode,
    moderatorToken, moderatorAuthState, assemblyId, selectedOptions, reviewingVote, voteSubmitting, qrImage, realtimeActive, realtimeConnected,
    projectorFullscreen, printingActa, completedAssemblies, liveAssembly, browsingActas, participantLeft,
    role, assemblyStatus, lobbyStatus, round, totalParticipants, eligibleVotes, completionTime, ballotMaxChoices, projectorJoinUrl,
    go, openProjectorWindow, request, isUnauthorized, handleParticipantUnauthorized, clearParticipantSession, normalizeState, refresh,
    setBrowsingActas, selectAssembly, loadAssemblyLists, recoverActiveAssembly, rememberJoinCode, refreshQr, formatDateTime,
    syncRealtime, startAssembly, stopAssembly,
  }
}
