import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const BASE_URL = (__ENV.VOTE_BASE_URL || '').replace(/\/$/, '')
const ASSEMBLY_CODE = __ENV.VOTE_ASSEMBLY_CODE || ''
const ROUND_ID = __ENV.VOTE_ROUND_ID || ''
const OPTION_ID = __ENV.VOTE_OPTION_ID || ''
const API_PREFIX = (__ENV.VOTE_API_PREFIX || '/api/v1').replace(/\/$/, '')
const TARGET_SESSIONS = Number(__ENV.VOTE_SESSIONS || 50)
const JOIN_ONLY = __ENV.VOTE_JOIN_ONLY === 'true'
const P95_LIMIT_MS = Number(__ENV.VOTE_P95_MS || '')
const MAX_ERROR_RATE = Number(__ENV.VOTE_MAX_ERROR_RATE || '')

const requestErrors = new Rate('vote_request_errors')
const joinLatency = new Trend('vote_join_latency', true)
const stateLatency = new Trend('vote_state_latency', true)
const voteLatency = new Trend('vote_submit_latency', true)
const joinedSessions = new Counter('vote_joined_sessions')

if (!BASE_URL) throw new Error('Set VOTE_BASE_URL to an explicitly selected candidate API origin before running k6.')
if (!ASSEMBLY_CODE) throw new Error('Set VOTE_ASSEMBLY_CODE to a synthetic test assembly code.')
if (!JOIN_ONLY && (!ROUND_ID || !OPTION_ID)) {
  throw new Error('For the voting scenario, set VOTE_ROUND_ID and VOTE_OPTION_ID for a synthetic open round.')
}
if (!Number.isInteger(TARGET_SESSIONS) || TARGET_SESSIONS < 1 || TARGET_SESSIONS > 70) {
  throw new Error('VOTE_SESSIONS must be an integer between 1 and 70; acceptance runs should use 50–70.')
}
if (!Number.isFinite(P95_LIMIT_MS) || P95_LIMIT_MS <= 0) {
  throw new Error('Set VOTE_P95_MS to the P95 latency limit approved for this run.')
}
if (!__ENV.VOTE_MAX_ERROR_RATE || !Number.isFinite(MAX_ERROR_RATE) || MAX_ERROR_RATE < 0 || MAX_ERROR_RATE > 1) {
  throw new Error('Set VOTE_MAX_ERROR_RATE to the approved maximum request error rate (0–1).')
}

export const options = {
  scenarios: {
    assembly_sessions: {
      executor: 'per-vu-iterations',
      vus: TARGET_SESSIONS,
      iterations: 1,
      maxDuration: __ENV.VOTE_MAX_DURATION || '3m',
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<=${P95_LIMIT_MS}`],
    vote_request_errors: [`rate<=${MAX_ERROR_RATE}`],
  },
}

function endpoint(path) {
  return `${BASE_URL}${API_PREFIX}${path}`
}

export default function () {
  const suffix = `load-${__VU}-${Date.now()}`
  const joinResponse = http.post(
    endpoint(`/assemblies/${encodeURIComponent(ASSEMBLY_CODE)}/join`),
    JSON.stringify({ firstName: 'Prueba', lastName: suffix }),
    { headers: { 'Content-Type': 'application/json' }, tags: { operation: 'join' } },
  )
  joinLatency.add(joinResponse.timings.duration)
  const joinOk = check(joinResponse, {
    'join accepted (200/201)': (response) => response.status === 200 || response.status === 201,
    'join returns synthetic participant token': (response) => Boolean(response.json('participantSessionToken')),
  })
  requestErrors.add(!joinOk)
  if (!joinOk) return

  joinedSessions.add(1)
  const token = joinResponse.json('participantSessionToken')
  const meResponse = http.get(endpoint('/participant/me'), {
    headers: { Authorization: `Bearer ${token}` },
    tags: { operation: 'participant_state' },
  })
  stateLatency.add(meResponse.timings.duration)
  const stateOk = check(meResponse, { 'participant snapshot loaded': (response) => response.status === 200 })
  requestErrors.add(!stateOk)

  if (stateOk && !JOIN_ONLY) {
    const voteResponse = http.post(
      endpoint(`/participant/rounds/${encodeURIComponent(ROUND_ID)}/vote`),
      JSON.stringify({ optionId: OPTION_ID, confirmation: true }),
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, tags: { operation: 'vote' } },
    )
    voteLatency.add(voteResponse.timings.duration)
    const voteOk = check(voteResponse, { 'vote accepted (200/201)': (response) => response.status === 200 || response.status === 201 })
    requestErrors.add(!voteOk)
  }

  sleep(0.2)
}

export function handleSummary(data) {
  const target = __ENV.K6_SUMMARY_FILE
  return target
    ? { [target]: JSON.stringify(data, null, 2) }
    : { stdout: `${JSON.stringify(data, null, 2)}\n` }
}
