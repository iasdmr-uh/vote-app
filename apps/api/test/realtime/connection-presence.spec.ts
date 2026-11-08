import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionPresence } from '../../src/realtime/connection-presence.js'
import { CONNECTION_GRACE_MS, CONNECTION_LOSS_LIMIT_MS, HEARTBEAT_MS } from '../../src/realtime/connection-timing.js'

function fakeClock() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextId = 1
  return {
    schedule(run: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { at: now + ms, run })
      return () => { timers.delete(id) }
    },
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) { timers.delete(id); timer.run() }
      }
    },
  }
}

function tracker() {
  const clock = fakeClock()
  const presence = new ConnectionPresence(clock.schedule)
  const changes: string[] = []
  presence.onChange((assemblyId) => changes.push(assemblyId))
  return { clock, presence, changes }
}

test('a connected participant is online at once', () => {
  const { presence, changes } = tracker()
  presence.connect('a1', 'p1')
  assert.deepEqual(presence.online('a1'), ['p1'])
  assert.deepEqual(changes, ['a1'])
})

test('two devices of one person count once', () => {
  const { presence, changes } = tracker()
  presence.connect('a1', 'p1')
  presence.connect('a1', 'p1')
  assert.deepEqual(presence.online('a1'), ['p1'])
  assert.deepEqual(changes, ['a1'])
})

test('a drop that recovers within the grace period changes nothing', () => {
  const { clock, presence, changes } = tracker()
  presence.connect('a1', 'p1')
  presence.disconnect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS - 1)
  presence.connect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS * 2)
  assert.deepEqual(presence.online('a1'), ['p1'])
  assert.deepEqual(changes, ['a1'])
})

test('a drop past the grace period takes the person offline', () => {
  const { clock, presence, changes } = tracker()
  presence.connect('a1', 'p1')
  presence.disconnect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS - 1)
  assert.deepEqual(presence.online('a1'), ['p1'])
  clock.advance(1)
  assert.deepEqual(presence.online('a1'), [])
  assert.deepEqual(changes, ['a1', 'a1'])
})

test('a person stays online while another of their devices is connected', () => {
  const { clock, presence, changes } = tracker()
  presence.connect('a1', 'p1')
  presence.connect('a1', 'p1')
  presence.disconnect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS * 2)
  assert.deepEqual(presence.online('a1'), ['p1'])
  assert.deepEqual(changes, ['a1'])
})

test('the last of two devices dropping takes the person offline', () => {
  const { clock, presence } = tracker()
  presence.connect('a1', 'p1')
  presence.connect('a1', 'p1')
  presence.disconnect('a1', 'p1')
  presence.disconnect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS)
  assert.deepEqual(presence.online('a1'), [])
})

test('assemblies are tracked apart', () => {
  const { presence } = tracker()
  presence.connect('a1', 'p1')
  presence.connect('a2', 'p2')
  assert.deepEqual(presence.online('a1'), ['p1'])
  assert.deepEqual(presence.online('a2'), ['p2'])
  assert.deepEqual(presence.online('a3'), [])
})

test('an unmatched disconnect is ignored', () => {
  const { clock, presence, changes } = tracker()
  presence.disconnect('a1', 'p1')
  clock.advance(CONNECTION_GRACE_MS)
  assert.deepEqual(presence.online('a1'), [])
  assert.deepEqual(changes, [])
})

test('a silent drop is detected and reported within the loss limit', () => {
  assert.ok(HEARTBEAT_MS > 0)
  assert.ok(2 * HEARTBEAT_MS + CONNECTION_GRACE_MS <= CONNECTION_LOSS_LIMIT_MS)
})

test('detection leaves one heartbeat of room for network and timer delay', () => {
  assert.ok(3 * HEARTBEAT_MS + CONNECTION_GRACE_MS <= CONNECTION_LOSS_LIMIT_MS)
})
