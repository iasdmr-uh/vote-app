import assert from 'node:assert/strict'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { electionOutcome, electionReasons, type Tally } from '../../src/voting/results-engine.js'
import { buildProviders } from '../support/providers.js'

const BASE = 28

function tallies(counts: Record<string, number>): Tally[] {
  return Object.entries(counts).map(([optionId, count]) => ({ optionId, count }))
}

test('worked examples use a base of 28 and a majority of 15', () => {
  assert.equal(electionOutcome(tallies({ Isaías: 0 }), 1, BASE).threshold, 15)
})

test('Tie at the cut', () => {
  const counts = tallies({ Isaías: 28, Jeremías: 27, Ezequiel: 25, Daniel: 15, Oseas: 15, Joel: 15, Amós: 15 })
  assert.deepEqual(electionOutcome(counts, 5, BASE), {
    seats: 5,
    base: 28,
    threshold: 15,
    elected: ['Isaías', 'Jeremías', 'Ezequiel'],
    runoff: ['Daniel', 'Oseas', 'Joel', 'Amós'],
    openSeats: 2,
  })
  assert.deepEqual(electionReasons(counts, 5, BASE), {
    Isaías: 'elected',
    Jeremías: 'elected',
    Ezequiel: 'elected',
    Daniel: 'tied_at_cut',
    Oseas: 'tied_at_cut',
    Joel: 'tied_at_cut',
    Amós: 'tied_at_cut',
  })
})

test('Several above the line without a majority', () => {
  const counts = tallies({ Isaías: 20, Jeremías: 14, Ezequiel: 13, Daniel: 12, Oseas: 11, Joel: 10, Amós: 4 })
  assert.deepEqual(electionOutcome(counts, 3, BASE), {
    seats: 3,
    base: 28,
    threshold: 15,
    elected: ['Isaías'],
    runoff: ['Jeremías', 'Ezequiel', 'Daniel'],
    openSeats: 2,
  })
  assert.deepEqual(electionReasons(counts, 3, BASE), {
    Isaías: 'elected',
    Jeremías: 'no_majority',
    Ezequiel: 'no_majority',
    Daniel: 'added_for_choice',
    Oseas: 'out',
    Joel: 'out',
    Amós: 'out',
  })
})

test('More candidates with a majority than seats', () => {
  const counts = tallies({ Isaías: 25, Jeremías: 22, Ezequiel: 20, Daniel: 17 })
  assert.deepEqual(electionOutcome(counts, 3, BASE), {
    seats: 3,
    base: 28,
    threshold: 15,
    elected: ['Isaías', 'Jeremías', 'Ezequiel'],
    runoff: [],
    openSeats: 0,
  })
  assert.deepEqual(electionReasons(counts, 3, BASE), {
    Isaías: 'elected',
    Jeremías: 'elected',
    Ezequiel: 'elected',
    Daniel: 'out',
  })
})

test('Ties away from the cut', () => {
  const counts = tallies({ Isaías: 22, Jeremías: 22, Ezequiel: 18, Daniel: 11, Oseas: 11 })
  assert.deepEqual(electionOutcome(counts, 3, BASE), {
    seats: 3,
    base: 28,
    threshold: 15,
    elected: ['Isaías', 'Jeremías', 'Ezequiel'],
    runoff: [],
    openSeats: 0,
  })
  assert.deepEqual(electionReasons(counts, 3, BASE), {
    Isaías: 'elected',
    Jeremías: 'elected',
    Ezequiel: 'elected',
    Daniel: 'out',
    Oseas: 'out',
  })
})

test('Tie at the cut and a tie above it', () => {
  const counts = tallies({ Isaías: 22, Jeremías: 22, Ezequiel: 18, Daniel: 18, Oseas: 2, Joel: 2 })
  assert.deepEqual(electionOutcome(counts, 3, BASE), {
    seats: 3,
    base: 28,
    threshold: 15,
    elected: ['Isaías', 'Jeremías'],
    runoff: ['Ezequiel', 'Daniel'],
    openSeats: 1,
  })
  assert.deepEqual(electionReasons(counts, 3, BASE), {
    Isaías: 'elected',
    Jeremías: 'elected',
    Ezequiel: 'tied_at_cut',
    Daniel: 'tied_at_cut',
    Oseas: 'out',
    Joel: 'out',
  })
})

test('Fewer candidates than seats', async () => {
  const voting = buildProviders({}, {}).voting
  const ballot = {
    title: 'Comisión de Nombramientos',
    format: 'multiple_choice' as const,
    category: 'committee' as const,
    memberCount: 5,
    options: [{ label: 'Isaías' }, { label: 'Jeremías' }, { label: 'Ezequiel' }, { label: 'Daniel' }],
    countingRule: { kind: 'count_only' },
  }
  await assert.rejects(voting.createRound('assembly', ballot), (error: unknown) => {
    assert.ok(error instanceof UnprocessableEntityException)
    assert.match(error.message, /al menos 5 candidatos/)
    return true
  })
})

test('Office with no majority', () => {
  const counts = tallies({ Isaías: 13, Jeremías: 10, Ezequiel: 5 })
  assert.deepEqual(electionOutcome(counts, 1, BASE), {
    seats: 1,
    base: 28,
    threshold: 15,
    elected: [],
    runoff: ['Isaías', 'Jeremías'],
    openSeats: 1,
  })
  assert.deepEqual(electionReasons(counts, 1, BASE), {
    Isaías: 'no_majority',
    Jeremías: 'added_for_choice',
    Ezequiel: 'out',
  })
})

test('Nobody voted', () => {
  const counts = tallies({ Isaías: 0, Jeremías: 0, Ezequiel: 0 })
  for (const seats of [1, 3]) {
    assert.deepEqual(electionOutcome(counts, seats, BASE), {
      seats,
      base: 28,
      threshold: 15,
      elected: [],
      runoff: ['Isaías', 'Jeremías', 'Ezequiel'],
      openSeats: seats,
    })
  }
})
