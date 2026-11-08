import assert from 'node:assert/strict'
import test from 'node:test'
import { ConnectionCountService } from '../src/voting/connection-count.service.js'
import { ConnectionPresence } from '../src/realtime/connection-presence.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'
import type { VotingService } from '../src/voting/voting.service.js'

function setup(base: { roundId: string; participantIds: string[] } | null) {
  const pending: Array<() => void> = []
  const presence = new ConnectionPresence((run) => { pending.push(run); return () => undefined })
  const emitted: Array<{ assemblyId: string; payload: unknown }> = []
  const realtime = { connectionCount(assemblyId: string, payload: unknown) { emitted.push({ assemblyId, payload }) } } as unknown as RealtimeGateway
  const state = { base }
  const voting = { async openRoundBase() { return state.base } } as unknown as VotingService
  const service = new ConnectionCountService(voting, presence, realtime)
  service.onModuleInit()
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  return { service, presence, emitted, state, settle, runTimers: () => pending.splice(0).forEach((run) => run()) }
}

test('reports the connected people in the base of the open vote', async () => {
  const { service, presence } = setup({ roundId: 'r-1', participantIds: ['p1', 'p2', 'p3'] })
  presence.connect('a1', 'p1')
  presence.connect('a1', 'outsider')
  assert.deepEqual(await service.current('a1'), { roundId: 'r-1', connected: 1, base: 3 })
})

test('reports nothing when no vote is open', async () => {
  const { service, presence } = setup(null)
  presence.connect('a1', 'p1')
  assert.equal(await service.current('a1'), null)
})

test('a presence change broadcasts the new count', async () => {
  const { presence, emitted, settle } = setup({ roundId: 'r-1', participantIds: ['p1', 'p2'] })
  presence.connect('a1', 'p1')
  await settle()
  assert.deepEqual(emitted, [{ assemblyId: 'a1', payload: { roundId: 'r-1', connected: 1, base: 2 } }])
})

test('a presence change that leaves the count the same broadcasts nothing new', async () => {
  const { presence, emitted, settle } = setup({ roundId: 'r-1', participantIds: ['p1'] })
  presence.connect('a1', 'p1')
  await settle()
  presence.connect('a1', 'outsider')
  await settle()
  assert.equal(emitted.length, 1)
})

test('a person going offline past the grace period lowers the count', async () => {
  const { presence, emitted, settle, runTimers } = setup({ roundId: 'r-1', participantIds: ['p1', 'p2'] })
  presence.connect('a1', 'p1')
  presence.connect('a1', 'p2')
  await settle()
  presence.disconnect('a1', 'p2')
  runTimers()
  await settle()
  assert.deepEqual(emitted.at(-1)?.payload, { roundId: 'r-1', connected: 1, base: 2 })
})

test('no vote open means no broadcast', async () => {
  const { presence, emitted, settle } = setup(null)
  presence.connect('a1', 'p1')
  await settle()
  assert.deepEqual(emitted, [])
})

test('the same numbers in a new vote are broadcast again', async () => {
  const { presence, emitted, settle, state } = setup({ roundId: 'r-1', participantIds: ['p1'] })
  presence.connect('a1', 'p1')
  await settle()
  state.base = { roundId: 'r-2', participantIds: ['p1', 'p2'] }
  presence.connect('a1', 'p2')
  await settle()
  state.base = { roundId: 'r-3', participantIds: ['p1', 'p2'] }
  presence.disconnect('a1', 'outsider')
  presence.connect('a1', 'p3')
  await settle()
  assert.deepEqual(emitted.map(({ payload }) => payload), [
    { roundId: 'r-1', connected: 1, base: 1 },
    { roundId: 'r-2', connected: 2, base: 2 },
    { roundId: 'r-3', connected: 2, base: 2 },
  ])
})

test('counts from quick successive changes are broadcast in order', async () => {
  const presence = new ConnectionPresence(() => () => undefined)
  const emitted: unknown[] = []
  const realtime = { connectionCount(_assemblyId: string, payload: unknown) { emitted.push(payload) } } as unknown as RealtimeGateway
  let calls = 0
  const voting = {
    async openRoundBase() {
      calls += 1
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 20))
      return { roundId: 'r-1', participantIds: ['p1', 'p2'] }
    },
  } as unknown as VotingService
  new ConnectionCountService(voting, presence, realtime).onModuleInit()
  presence.connect('a1', 'p1')
  presence.connect('a1', 'p2')
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(emitted.at(-1), { roundId: 'r-1', connected: 2, base: 2 })
})
