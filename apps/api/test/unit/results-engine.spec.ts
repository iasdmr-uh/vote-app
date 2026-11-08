import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionOutcome, electionOutcome, meetsThreshold, thresholdVotes, type Tally } from '../../src/voting/results-engine.js'

function tallies(counts: Record<string, number>): Tally[] {
  return Object.entries(counts).map(([optionId, count]) => ({ optionId, count }))
}

test('majority is more than half of the enabled participants; exactly half is not enough', () => {
  assert.equal(thresholdVotes(38), 20)
  assert.equal(thresholdVotes(60), 31)
  assert.equal(thresholdVotes(37), 19)
  assert.equal(meetsThreshold(19, 38), false, '19 of 38 is exactly half')
  assert.equal(meetsThreshold(20, 38), true)
  assert.equal(thresholdVotes(0), 1, 'with nobody enabled, nobody can reach it')
})

test('the 3/4 rule rounds up and counts the same base', () => {
  assert.equal(thresholdVotes(38, 'three_quarters'), 29)
  assert.equal(thresholdVotes(40, 'three_quarters'), 30)
  assert.equal(meetsThreshold(28, 38, 'three_quarters'), false)
  assert.equal(meetsThreshold(29, 38, 'three_quarters'), true)
})

test('case 1 · office: A 35 of 60 is elected', () => {
  const outcome = electionOutcome(tallies({ A: 35, B: 20, C: 5 }), 1, 60)
  assert.deepEqual(outcome, { seats: 1, base: 60, threshold: 31, elected: ['A'], runoff: [], openSeats: 0 })
})

test('case 2 · office: A 20, B 15, C 15, D 5 goes to a runoff among A, B and C for 1 seat', () => {
  const outcome = electionOutcome(tallies({ A: 20, B: 15, C: 15, D: 5 }), 1, 55)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, ['A', 'B', 'C'])
  assert.equal(outcome.openSeats, 1)
})

test('office: top 2 go to the runoff when the 2nd is not tied', () => {
  const outcome = electionOutcome(tallies({ A: 18, B: 12, C: 6 }), 1, 38)
  assert.deepEqual(outcome.runoff, ['A', 'B'])
})

test('case 3 · committee of 3: 1st and 2nd with majority, 3rd and 4th tied → runoff 3rd and 4th for 1', () => {
  const outcome = electionOutcome(tallies({ A: 30, B: 25, C: 15, D: 15, E: 5 }), 3, 38)
  assert.deepEqual(outcome.elected, ['A', 'B'])
  assert.deepEqual(outcome.runoff, ['C', 'D'])
  assert.equal(outcome.openSeats, 1)
})

test('case 4 · committee of 3: 1st with majority, 2nd without, 3rd and 4th tied → runoff 2nd, 3rd and 4th for 2', () => {
  const outcome = electionOutcome(tallies({ 'Ana Ruiz': 30, 'Juan Mora': 19, 'Elena Castro': 17, 'Pedro Vargas': 17, 'Sofía Méndez': 14, 'Luis Pérez': 11 }), 3, 38)
  assert.deepEqual(outcome.elected, ['Ana Ruiz'])
  assert.deepEqual(outcome.runoff, ['Juan Mora', 'Elena Castro', 'Pedro Vargas'])
  assert.equal(outcome.openSeats, 2)
  assert.equal(outcome.threshold, 20)
})

test('case 5 · committee of 3: 1st with majority, 2nd and 3rd without and no tie → runoff 2nd, 3rd and 4th for 2', () => {
  const outcome = electionOutcome(tallies({ A: 30, B: 18, C: 16, D: 12, E: 4 }), 3, 38)
  assert.deepEqual(outcome.elected, ['A'])
  assert.deepEqual(outcome.runoff, ['B', 'C', 'D'])
  assert.equal(outcome.openSeats, 2)
})

test('committee: the extra candidate brings anyone tied with it', () => {
  const outcome = electionOutcome(tallies({ A: 30, B: 18, C: 16, D: 12, E: 12, F: 2 }), 3, 38)
  assert.deepEqual(outcome.runoff, ['B', 'C', 'D', 'E'])
})

test('case 6 · committee of 3: 4 candidates with majority → the 3 most voted stay', () => {
  const outcome = electionOutcome(tallies({ A: 30, B: 28, C: 25, D: 22 }), 3, 38)
  assert.deepEqual(outcome.elected, ['A', 'B', 'C'])
  assert.deepEqual(outcome.runoff, [])
  assert.equal(outcome.openSeats, 0)
})

test('committee: a tie at the cut among candidates with majority goes to a runoff among only the tied', () => {
  const outcome = electionOutcome(tallies({ A: 30, B: 28, C: 25, D: 25 }), 3, 38)
  assert.deepEqual(outcome.elected, ['A', 'B'])
  assert.deepEqual(outcome.runoff, ['C', 'D'])
  assert.equal(outcome.openSeats, 1)
})

test('a runoff asks for majority again over the same kind of base', () => {
  const first = electionOutcome(tallies({ B: 19, C: 17, D: 17 }), 2, 38)
  assert.deepEqual(first.elected, [])
  assert.deepEqual(first.runoff, ['B', 'C', 'D'])
  const second = electionOutcome(tallies({ B: 24, C: 18, D: 16 }), 2, 38)
  assert.deepEqual(second.elected, ['B'])
  assert.deepEqual(second.runoff, ['C', 'D'])
  assert.equal(second.openSeats, 1)
  const third = electionOutcome(tallies({ C: 21, D: 15 }), 1, 38)
  assert.deepEqual(third.elected, ['C'])
  assert.equal(third.openSeats, 0)
})

test('a vote with no votes keeps everyone in the runoff; ties keep ballot order', () => {
  const outcome = electionOutcome(tallies({ A: 0, B: 0, C: 0 }), 1, 10)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, ['A', 'B', 'C'])
})

test('the input order of tallies does not change who is elected', () => {
  const outcome = electionOutcome(tallies({ D: 22, B: 28, A: 30, C: 25 }), 3, 38)
  assert.deepEqual(outcome.elected, ['A', 'B', 'C'])
})

// Decisions (#42): "A favor" is the first tally, in ballot order.

test('decision A favor / En contra · mayoría simple: 20 of 38 approves, 19 does not', () => {
  assert.deepEqual(decisionOutcome(tallies({ favor: 20, contra: 16 }), 'boolean', 38), {
    seats: 1, base: 38, threshold: 20, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: true,
  })
  assert.equal(decisionOutcome(tallies({ favor: 19, contra: 2 }), 'boolean', 38).approved, false, 'exactly half is not a majority, even with few against')
})

test('decision A favor / En contra · 3/4: 29 of 38 approves, 28 does not, and nothing repeats', () => {
  const approved = decisionOutcome(tallies({ favor: 30, contra: 6 }), 'boolean', 38, 'three_quarters')
  assert.equal(approved.threshold, 29)
  assert.equal(approved.approved, true)
  const rejected = decisionOutcome(tallies({ favor: 28, contra: 8 }), 'boolean', 38, 'three_quarters')
  assert.equal(rejected.approved, false)
  assert.deepEqual(rejected.runoff, [])
  assert.equal(rejected.openSeats, 0)
})

test('decision A favor / En contra: a 50/50 tie is not approved', () => {
  assert.equal(decisionOutcome(tallies({ favor: 19, contra: 19 }), 'boolean', 38).approved, false)
  assert.equal(decisionOutcome(tallies({ favor: 0, contra: 0 }), 'boolean', 0).approved, false, 'with nobody enabled nothing is approved')
})

test('decision with options · mayoría simple: the most voted wins once it reaches the threshold', () => {
  const outcome = decisionOutcome(tallies({ Tegucigalpa: 8, SPS: 22, Ceiba: 6, Choluteca: 2 }), 'options', 38)
  assert.deepEqual(outcome, { seats: 1, base: 38, threshold: 20, elected: ['SPS'], runoff: [], openSeats: 0, rule: 'simple', approved: true })
})

test('decision with options · 3/4: without the threshold it repeats between the top 2', () => {
  const outcome = decisionOutcome(tallies({ Tegucigalpa: 8, SPS: 25, Ceiba: 3 }), 'options', 38, 'three_quarters')
  assert.equal(outcome.threshold, 29)
  assert.equal(outcome.approved, false)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, ['SPS', 'Tegucigalpa'])
  assert.equal(outcome.openSeats, 1)
})

test('decision with options: anyone tied with the 2nd also goes to the repeat', () => {
  const outcome = decisionOutcome(tallies({ A: 15, B: 10, C: 10, D: 3 }), 'options', 38)
  assert.deepEqual(outcome.runoff, ['A', 'B', 'C'])
  const tiedFirst = decisionOutcome(tallies({ A: 12, B: 12, C: 12 }), 'options', 36)
  assert.deepEqual(tiedFirst.runoff, ['A', 'B', 'C'], 'a tie for first repeats among only the tied')
})

// Edge cases (PR #45): ties at the cut among candidates who all have a majority, and runoffs with
// nobody left to add.

test('committee of 2, base 10: A 8, B 6, C 6 → A elected; B and C both have majority but tie for the last seat → runoff B and C for 1', () => {
  const outcome = electionOutcome(tallies({ A: 8, B: 6, C: 6 }), 2, 10)
  assert.deepEqual(outcome, { seats: 2, base: 10, threshold: 6, elected: ['A'], runoff: ['B', 'C'], openSeats: 1 })
})

test('committee of 2: three candidates tied with majority for both seats → nobody elected, runoff among the three for 2', () => {
  const outcome = electionOutcome(tallies({ A: 6, B: 6, C: 6, D: 2 }), 2, 10)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, ['A', 'B', 'C'])
  assert.equal(outcome.openSeats, 2)
})

test('office: two candidates can never tie with majority, because each delegate marks exactly one name', () => {
  // With one mark per voter the votes add up to at most the base, and two majorities would add up to
  // 2 × (⌊base/2⌋ + 1) > base. Checked exhaustively for small bases: the case cannot reach the engine.
  for (let base = 1; base <= 40; base += 1) {
    const threshold = thresholdVotes(base)
    assert.ok(2 * threshold > base, `base ${base}: two majorities need ${2 * threshold} marks`)
  }
  // The most an office can give two candidates is a tie just below the threshold: a runoff between both.
  const outcome = electionOutcome(tallies({ A: 5, B: 5 }), 1, 10)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, ['A', 'B'])
})

test('nobody left to add: a committee of 2 with only 2 candidates and no majority repeats the same runoff for 2', () => {
  const first = electionOutcome(tallies({ A: 4, B: 3 }), 2, 10)
  assert.deepEqual(first, { seats: 2, base: 10, threshold: 6, elected: [], runoff: ['A', 'B'], openSeats: 2 })
  // In that runoff the exact-N rule makes every voter mark both names, so both get one vote per voter:
  // with 5 of 10 voting nobody reaches 6 and the same runoff comes back; with 6 voting both are elected.
  assert.deepEqual(electionOutcome(tallies({ A: 5, B: 5 }), 2, 10).runoff, ['A', 'B'])
  assert.deepEqual(electionOutcome(tallies({ A: 6, B: 6 }), 2, 10).elected, ['A', 'B'])
})

test('nobody left to add: an office with a single candidate without majority repeats with that candidate alone', () => {
  const outcome = electionOutcome(tallies({ A: 4 }), 1, 10)
  assert.deepEqual(outcome, { seats: 1, base: 10, threshold: 6, elected: [], runoff: ['A'], openSeats: 1 })
})
