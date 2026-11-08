import assert from 'node:assert/strict'
import test from 'node:test'
import { roomNumbers } from '../../src/voting/room.js'

test('the quorum is two thirds of the accredited, rounded up', () => {
  const quorums = [[0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [45, 30], [46, 31], [47, 32]]
  for (const [accredited, quorum] of quorums) assert.equal(roomNumbers(accredited, accredited).quorum, quorum, `accredited ${accredited}`)
})

test('the room numbers keep present and accredited as given', () => {
  assert.deepEqual(roomNumbers(30, 45), { present: 30, accredited: 45, quorum: 30 })
})
