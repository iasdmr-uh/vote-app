import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionOutcome, decisionReasons, electionOutcome, electionReasons, thresholdVotes, type Tally, type ThresholdRule } from '../../src/voting/results-engine.js'

function tallies(counts: Record<string, number>): Tally[] {
  return Object.entries(counts).map(([optionId, count]) => ({ optionId, count }))
}

test('an office winner with a majority is elected and the rest are out', () => {
  assert.deepEqual(electionReasons(tallies({ isaias: 22, jeremias: 10, ezequiel: 6 }), 1, 38), { isaias: 'elected', jeremias: 'out', ezequiel: 'out' })
})

test('an office leader without a majority has no majority and the runner-up is added for choice', () => {
  assert.deepEqual(electionReasons(tallies({ isaias: 18, jeremias: 12, ezequiel: 8 }), 1, 38), { isaias: 'no_majority', jeremias: 'added_for_choice', ezequiel: 'out' })
})

test('candidates tied for the last committee seat are tied at the cut', () => {
  assert.deepEqual(electionReasons(tallies({ isaias: 22, jeremias: 8, ezequiel: 8, daniel: 0 }), 2, 38), { isaias: 'elected', jeremias: 'tied_at_cut', ezequiel: 'tied_at_cut', daniel: 'out' })
})

test('the next ranked candidate is added for choice when only one continues for one open seat', () => {
  assert.deepEqual(electionReasons(tallies({ isaias: 22, jeremias: 12, ezequiel: 4, daniel: 0 }), 2, 38), { isaias: 'elected', jeremias: 'no_majority', ezequiel: 'added_for_choice', daniel: 'out' })
})

test('a committee vote can carry every continuing reason at once', () => {
  assert.deepEqual(electionReasons(tallies({ isaias: 22, jeremias: 12, ezequiel: 8, daniel: 8, oseas: 0 }), 3, 38), { isaias: 'elected', jeremias: 'no_majority', ezequiel: 'tied_at_cut', daniel: 'tied_at_cut', oseas: 'out' })
})

test('an A favor / En contra decision reports no reasons', () => {
  assert.deepEqual(decisionReasons(tallies({ favor: 29, contra: 9 }), 'boolean', 38, 'three_quarters'), {})
})

test('an Opciones decision classifies its options like an office vote under its own rule', () => {
  assert.deepEqual(decisionReasons(tallies({ a: 19, b: 9 }), 'options', 28, 'two_thirds'), { a: 'elected', b: 'out' })
  assert.deepEqual(decisionReasons(tallies({ a: 18, b: 9, c: 1 }), 'options', 28, 'two_thirds'), { a: 'no_majority', b: 'added_for_choice', c: 'out' })
})

function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

const RULES: ThresholdRule[] = ['simple', 'two_thirds', 'three_quarters']
const CONTINUING = new Set(['tied_at_cut', 'no_majority', 'added_for_choice'])

test('reasons agree with the outcome and the outcome follows from the reported numbers alone', () => {
  const next = random(57)
  for (let run = 0; run < 2000; run += 1) {
    const base = Math.floor(next() * 40)
    const seats = 1 + Math.floor(next() * 5)
    const optionCount = Math.floor(next() * 8)
    const counts = Object.fromEntries(Array.from({ length: optionCount }, (_, index) => [`p${index}`, Math.floor(next() * (base + 1))]))
    const outcome = electionOutcome(tallies(counts), seats, base)
    const reasons = electionReasons(tallies(counts), seats, base)
    const label = JSON.stringify({ counts, seats, base })
    assert.deepEqual(Object.keys(reasons).sort(), Object.keys(counts).sort(), label)
    assert.ok(outcome.elected.length <= seats, label)
    assert.deepEqual(outcome.elected.filter((id) => outcome.runoff.includes(id)), [], label)
    for (const [id, reason] of Object.entries(reasons)) {
      assert.equal(reason === 'elected', outcome.elected.includes(id), label)
      assert.equal(CONTINUING.has(reason), outcome.runoff.includes(id), label)
    }
    assert.equal(outcome.threshold, thresholdVotes(base, 'simple'), label)
    assert.deepEqual(electionOutcome(tallies(counts), outcome.seats, outcome.base), outcome, label)
  }
})

test('decisions report numbers that recompute their approval', () => {
  const next = random(58)
  for (let run = 0; run < 2000; run += 1) {
    const base = Math.floor(next() * 40)
    const rule = RULES[Math.floor(next() * RULES.length)]
    const favor = Math.floor(next() * (base + 1))
    const outcome = decisionOutcome(tallies({ favor, contra: base - favor }), 'boolean', base, rule)
    const label = JSON.stringify({ favor, base, rule })
    assert.equal(outcome.threshold, thresholdVotes(base, outcome.rule), label)
    assert.equal(outcome.approved, favor >= outcome.threshold, label)
  }
})

test('a vote with nobody in the base needs 1 vote', () => {
  assert.equal(electionOutcome(tallies({ isaias: 0 }), 1, 0).threshold, 1)
  assert.deepEqual(electionReasons([], 1, 0), {})
})
