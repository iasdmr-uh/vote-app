import assert from 'node:assert/strict'
import test from 'node:test'
import { ModeratorController, ParticipantController, PublicAssemblyController } from '../src/voting/voting.controller.js'
import { CONNECTION_GRACE_MS } from '../src/realtime/connection-timing.js'
import type { ConnectionCountService } from '../src/voting/connection-count.service.js'
import type { OperatorLogService } from '../src/voting/operator-log.service.js'
import type { PresentationService } from '../src/voting/presentation.service.js'
import type { VotingService } from '../src/voting/voting.service.js'
import { PARTICIPANT_ID } from '../src/auth/auth.service.js'

const voting = {
  async publicState() { return { assembly: { id: 'a1' }, recordedCount: 2 } },
  async moderatorAssembly() { return { id: 'a1', rounds: [] } },
  async participantState() { return { openRound: null } },
} as unknown as VotingService

function counts(value: { roundId: string; connected: number; base: number } | null) {
  return { async current() { return value } } as unknown as ConnectionCountService
}

const presentation = {} as PresentationService
const operatorLog = {} as OperatorLogService

test('the public state carries the connected count while a vote is open', async () => {
  const controller = new PublicAssemblyController(voting, counts({ roundId: 'r-1', connected: 3, base: 4 }))
  const state = await controller.publicState('code') as Record<string, unknown>
  assert.deepEqual(state.connection, { roundId: 'r-1', connected: 3, base: 4 })
  assert.equal(state.recordedCount, 2)
})

test('the public state has no connected count when no vote is open', async () => {
  const state = await new PublicAssemblyController(voting, counts(null)).publicState('code') as Record<string, unknown>
  assert.equal('connection' in state, false)
})

test('the mesa state carries the connected count while a vote is open', async () => {
  const controller = new ModeratorController(voting, presentation, counts({ roundId: 'r-1', connected: 1, base: 1 }), operatorLog)
  const state = await controller.assembly('a1') as Record<string, unknown>
  assert.deepEqual(state.connection, { roundId: 'r-1', connected: 1, base: 1 })
})

test('the mesa state has no connected count when no vote is open', async () => {
  const state = await new ModeratorController(voting, presentation, counts(null), operatorLog).assembly('a1') as Record<string, unknown>
  assert.equal('connection' in state, false)
})

test('a phone learns the grace period from its own state', async () => {
  const state = await new ParticipantController(voting).me({ [PARTICIPANT_ID]: 'p1' } as never) as Record<string, unknown>
  assert.equal(state.connectionGraceMs, CONNECTION_GRACE_MS)
})

test('a phone that joins learns the grace period at once', async () => {
  const joining = { ...voting, async joinAssembly() { return { participantSessionToken: 't' } } } as unknown as VotingService
  const joined = await new PublicAssemblyController(joining, counts(null)).join('code', { firstName: 'Delegado', lastName: '1' } as never) as Record<string, unknown>
  assert.equal(joined.connectionGraceMs, CONNECTION_GRACE_MS)
})

test('a phone that resumes its session learns the grace period at once', async () => {
  const resuming = { ...voting, async redeemResumeCode() { return { participantSessionToken: 't' } } } as unknown as VotingService
  const resumed = await new PublicAssemblyController(resuming, counts(null)).resume({ resumeCode: 'r' } as never) as Record<string, unknown>
  assert.equal(resumed.connectionGraceMs, CONNECTION_GRACE_MS)
})
