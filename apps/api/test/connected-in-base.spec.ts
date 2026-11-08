import assert from 'node:assert/strict'
import test from 'node:test'
import { connectedInBase } from '../src/voting/connected-in-base.js'

test('an empty base has nobody connected', () => {
  assert.deepEqual(connectedInBase([], ['p1']), { connected: 0, base: 0 })
})

test('everyone in the base connected', () => {
  assert.deepEqual(connectedInBase(['p1', 'p2', 'p3'], ['p1', 'p2', 'p3']), { connected: 3, base: 3 })
})

test('some people in the base are offline', () => {
  assert.deepEqual(connectedInBase(['p1', 'p2', 'p3', 'p4'], ['p2', 'p4']), { connected: 2, base: 4 })
})

test('connected people outside the base do not count', () => {
  assert.deepEqual(connectedInBase(['p1', 'p2'], ['p1', 'secretary', 'p9']), { connected: 1, base: 2 })
})

test('a person listed twice as online counts once', () => {
  assert.deepEqual(connectedInBase(['p1', 'p2'], ['p1', 'p1']), { connected: 1, base: 2 })
})

test('rejects a base that lists a person twice', () => {
  assert.throws(() => connectedInBase(['p1', 'p1'], []), /base/)
})

test('connected never exceeds the base and never goes below zero', () => {
  const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
  for (let mask = 0; mask < 1 << people.length; mask += 1) {
    for (let onlineMask = 0; onlineMask < 1 << people.length; onlineMask += 7) {
      const base = people.filter((_, i) => mask & (1 << i))
      const online = people.filter((_, i) => onlineMask & (1 << i))
      const { connected, base: size } = connectedInBase(base, online)
      assert.equal(size, base.length)
      assert.ok(connected >= 0 && connected <= size)
    }
  }
})
