import assert from 'node:assert/strict'
import test from 'node:test'
import { everyoneHasVoted } from '../../src/voting/auto-close.js'

test('a vote closes by itself once everyone who can vote has voted', () => {
  assert.equal(everyoneHasVoted(['d1', 'd2'], new Set(['d1', 'd2'])), true)
})

test('a vote stays open while someone who can vote has not voted', () => {
  assert.equal(everyoneHasVoted(['d1', 'd2'], new Set(['d1'])), false)
  assert.equal(everyoneHasVoted(['d1', 'd2'], new Set()), false)
})

test('a vote where nobody can vote does not close by itself', () => {
  assert.equal(everyoneHasVoted([], new Set()), false)
  assert.equal(everyoneHasVoted([], new Set(['d1'])), false)
})

test('a ballot from outside the people who can vote does not count toward closing', () => {
  assert.equal(everyoneHasVoted(['d1', 'd2'], new Set(['d1', 'd3'])), false)
})
