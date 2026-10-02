import http from 'k6/http'
import { check } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const BASE_URL = (__ENV.VOTE_BASE_URL || '').replace(/\/$/, '')
const API_PREFIX = (__ENV.VOTE_API_PREFIX || '/api/v1').replace(/\/$/, '')
const MODE = __ENV.VOTE_MODE || 'join'
const TARGET_SESSIONS = Number(__ENV.VOTE_SESSIONS || 50)
const P95_LIMIT_MS = Number(__ENV.VOTE_P95_MS || '')
const MAX_ERROR_RATE = Number(__ENV.VOTE_MAX_ERROR_RATE || '')
const MODERATOR_TOKEN = __ENV.VOTE_MODERATOR_TOKEN || ''
const RUN_LABEL = (__ENV.VOTE_RUN_LABEL || '').trim()
const ALLOWED_STAGING_HOSTS = (__ENV.VOTE_ALLOWED_STAGING_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
  .filter(Boolean)

const requestErrors = new Rate('vote_request_errors')
const loadLatency = new Trend('vote_load_request_latency', true)
const joinedSessions = new Counter('vote_joined_sessions')
const seededSessions = new Counter('vote_seeded_sessions')
const acceptedVotes = new Counter('vote_expected_accepted')
const duplicateRejections = new Counter('vote_expected_duplicate_rejections')
const closedRejections = new Counter('vote_expected_closed_rejections')

if (!BASE_URL) throw new Error('Set VOTE_BASE_URL to an explicitly selected test API origin.')
if (__ENV.VOTE_ENVIRONMENT !== 'staging') {
  throw new Error('Set VOTE_ENVIRONMENT=staging. This script refuses to run without an explicit staging target declaration.')
}
if (__ENV.VOTE_DISPOSABLE_TARGET !== 'true') {
  throw new Error('Set VOTE_DISPOSABLE_TARGET=true only for a fresh, disposable staging deployment/database for this single run.')
}
if (ALLOWED_STAGING_HOSTS.length === 0) {
  throw new Error('Set VOTE_ALLOWED_STAGING_HOSTS to the protected comma-separated staging hostname allowlist.')
}
const originMatch = BASE_URL.match(/^https:\/\/([a-z0-9.-]+)(?::([0-9]+))?\/?$/i)
if (!originMatch || (originMatch[2] && originMatch[2] !== '443')) {
  throw new Error('VOTE_BASE_URL must be an HTTPS origin without credentials, path, query, or nonstandard port.')
}
const targetHost = originMatch[1].toLowerCase().replace(/\.$/, '')
if (!ALLOWED_STAGING_HOSTS.includes(targetHost)) {
  throw new Error(`Refusing target host "${targetHost}": it is not in VOTE_ALLOWED_STAGING_HOSTS.`)
}
if (!MODERATOR_TOKEN) throw new Error('Set VOTE_MODERATOR_TOKEN to the moderator credential for the isolated staging environment.')
if (!RUN_LABEL) throw new Error('Set VOTE_RUN_LABEL to a unique synthetic run label.')
if (!['join', 'vote-retry', 'closed-vote'].includes(MODE)) {
  throw new Error('VOTE_MODE must be join, vote-retry, or closed-vote.')
}
if (!Number.isInteger(TARGET_SESSIONS) || TARGET_SESSIONS < 50 || TARGET_SESSIONS > 70) {
  throw new Error('VOTE_SESSIONS must be an integer between 50 and 70 for acceptance runs.')
}
if (!Number.isFinite(P95_LIMIT_MS) || P95_LIMIT_MS <= 0) {
  throw new Error('Set VOTE_P95_MS to the P95 latency limit approved before the run.')
}
if (!__ENV.VOTE_MAX_ERROR_RATE || !Number.isFinite(MAX_ERROR_RATE) || MAX_ERROR_RATE < 0 || MAX_ERROR_RATE > 1) {
  throw new Error('Set VOTE_MAX_ERROR_RATE to the approved maximum unexpected request error rate (0–1).')
}

const moderatorHeaders = {
  Authorization: `Bearer ${MODERATOR_TOKEN}`,
  'Content-Type': 'application/json',
}

export const options = {
  scenarios: {
    synthetic_sessions: {
      executor: 'per-vu-iterations',
      vus: TARGET_SESSIONS,
      iterations: 1,
      maxDuration: __ENV.VOTE_MAX_DURATION || '5m',
    },
  },
  thresholds: {
    vote_load_request_latency: [`p(95)<=${P95_LIMIT_MS}`],
    vote_request_errors: [`rate<=${MAX_ERROR_RATE}`],
  },
}

function endpoint(path) {
  return `${BASE_URL}${API_PREFIX}${path}`
}

function body(response) {
  try { return response.json() } catch { return {} }
}

function controlRequest(method, path, payload, expectedStatuses) {
  const response = http.request(method, endpoint(path), payload === undefined ? null : JSON.stringify(payload), {
    headers: moderatorHeaders,
    tags: { phase: 'setup', operation: path },
  })
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Staging setup failed for ${method} ${path}: HTTP ${response.status}`)
  }
  return body(response)
}

function batchJoin(joinCode) {
  const requests = Array.from({ length: TARGET_SESSIONS }, (_, index) => ({
    method: 'POST',
    url: endpoint(`/assemblies/${encodeURIComponent(joinCode)}/join`),
    body: JSON.stringify({ firstName: 'Prueba', lastName: `${RUN_LABEL}-${index + 1}` }),
    params: { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'setup', operation: 'seed_join' } },
  }))
  const responses = http.batch(requests)
  const participants = responses.map((response, index) => {
    const value = body(response)
    if (![200, 201].includes(response.status) || !value.participantSessionToken) {
      throw new Error(`Could not create synthetic participant ${index + 1}: HTTP ${response.status}`)
    }
    return { token: value.participantSessionToken }
  })
  return participants
}

function batchVotes(participants, roundId, optionId) {
  const requests = participants.map(({ token }) => ({
    method: 'POST',
    url: endpoint(`/participant/rounds/${encodeURIComponent(roundId)}/vote`),
    body: JSON.stringify({ optionId, confirmation: true }),
    params: {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      tags: { phase: 'setup', operation: 'seed_vote' },
    },
  }))
  const responses = http.batch(requests)
  responses.forEach((response, index) => {
    if (![200, 201].includes(response.status)) {
      throw new Error(`Could not seed vote for synthetic participant ${index + 1}: HTTP ${response.status}`)
    }
  })
}

export function setup() {
  const assembly = controlRequest('POST', '/moderator/assemblies', { name: `k6 ${RUN_LABEL}` }, [200, 201])
  if (MODE === 'join') return { joinCode: assembly.joinCode }

  const participants = batchJoin(assembly.joinCode)
  seededSessions.add(participants.length)

  controlRequest('PATCH', `/moderator/assemblies/${encodeURIComponent(assembly.assemblyId)}/lobby`, { status: 'lobby_closed' }, [200])
  const round = controlRequest('POST', `/moderator/assemblies/${encodeURIComponent(assembly.assemblyId)}/rounds`, {
    title: `Prueba k6 ${RUN_LABEL}`,
    format: 'single_choice',
    options: [{ label: 'Opción sintética' }],
    countingRule: { kind: 'count_only' },
  }, [200, 201])
  controlRequest('POST', `/moderator/rounds/${encodeURIComponent(round.id)}/open`, undefined, [200])

  const optionId = round.options?.[0]?.id
  if (!optionId) throw new Error('Staging setup failed: created round has no option ID.')

  if (MODE === 'closed-vote') {
    batchVotes(participants, round.id, optionId)
    controlRequest('POST', `/moderator/rounds/${encodeURIComponent(round.id)}/close`, undefined, [200])
  }

  return { participants, roundId: round.id, optionId }
}

function record(response, label, acceptedStatuses) {
  loadLatency.add(response.timings.duration)
  const ok = check(response, { [label]: (value) => acceptedStatuses.includes(value.status) })
  requestErrors.add(!ok)
  return ok
}

export default function (data) {
  if (MODE === 'join') {
    const suffix = `${RUN_LABEL}-${__VU}`
    const joined = http.post(
      endpoint(`/assemblies/${encodeURIComponent(data.joinCode)}/join`),
      JSON.stringify({ firstName: 'Prueba', lastName: suffix }),
      { headers: { 'Content-Type': 'application/json' }, tags: { operation: 'join' } },
    )
    if (!record(joined, 'synthetic participant joined', [200, 201])) return
    joinedSessions.add(1)
    const token = body(joined).participantSessionToken
    if (!token) {
      requestErrors.add(true)
      check(joined, { 'join returns participant token': () => false })
      return
    }
    const state = http.get(endpoint('/participant/me'), {
      headers: { Authorization: `Bearer ${token}` },
      tags: { operation: 'participant_state' },
    })
    record(state, 'participant state loaded', [200])
    return
  }

  const participant = data.participants[__VU - 1]
  const voteUrl = endpoint(`/participant/rounds/${encodeURIComponent(data.roundId)}/vote`)
  const voteParams = {
    headers: { Authorization: `Bearer ${participant.token}`, 'Content-Type': 'application/json' },
    tags: { operation: MODE === 'closed-vote' ? 'closed_vote' : 'vote' },
  }
  const payload = JSON.stringify({ optionId: data.optionId, confirmation: true })

  if (MODE === 'vote-retry') {
    const first = http.post(voteUrl, payload, voteParams)
    if (record(first, 'first vote accepted', [200, 201])) acceptedVotes.add(1)
    const retry = http.post(voteUrl, payload, voteParams)
    if (record(retry, 'duplicate vote rejected', [409])) duplicateRejections.add(1)
    return
  }

  const closed = http.post(voteUrl, payload, voteParams)
  if (record(closed, 'vote rejected after round closure', [409])) closedRejections.add(1)
}

export function handleSummary(data) {
  const target = __ENV.K6_SUMMARY_FILE
  return target
    ? { [target]: JSON.stringify(data, null, 2) }
    : { stdout: `${JSON.stringify(data, null, 2)}\n` }
}
