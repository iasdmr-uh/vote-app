import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { decisionOutcome, electionOutcome, thresholdVotes, type Tally } from '../src/voting/results-engine.js'
import { writeChain, type ChainVote } from './fixtures/chain-diagram.js'
import { assertBallotsValid, assertVoteInvariants, candidatesOf, expandBallots, seatsOf, seededShuffle, sorted, tallyOf, type VoteResult } from './fixtures/session-tools.js'
import { fixtures, type Fixture } from './fixtures/tie-sessions.js'

const outputDirectory = process.env.TIE_FIXTURES_OUT ?? fileURLToPath(new URL('../../../test-results/tie-fixtures/', import.meta.url))

type Run = { votes: ChainVote[]; elected: string[] }

function playChain(fixture: Fixture, seed: number | null): Run {
  const votes: ChainVote[] = []
  const electedBefore: string[] = []
  fixture.votes.forEach((vote, index) => {
    const context = `${fixture.id} vote ${index + 1}${seed === null ? '' : ` (shuffle ${seed})`}`
    const candidates = candidatesOf(fixture, index)
    const seats = seatsOf(fixture, index)
    const ballots = expandBallots(vote.ballots, fixture.delegates)
    assertBallotsValid(fixture, index, ballots)

    const delegatesVoting = seed === null ? ballots : seededShuffle(ballots, seed)
    const onBallot = fixture.kind === 'decision' || seed === null ? candidates : seededShuffle(candidates, seed + index)
    const counted = tallyOf(onBallot, delegatesVoting)
    const secretary = vote.secretaryMarks ? tallyOf(onBallot, [{ delegate: 0, marks: vote.secretaryMarks }]) : null
    const tally = Object.fromEntries(onBallot.map((label) => [label, counted.tally[label]! + (secretary?.tally[label] ?? 0)]))
    assert.deepEqual(tally, vote.expect.tally, `${context}: the ballots add up to the declared tally`)
    assert.equal(counted.abstained, vote.expect.abstained, `${context}: abstentions`)

    const tallies: Tally[] = onBallot.map((label) => ({ optionId: label, count: tally[label]! }))
    assert.equal(thresholdVotes(vote.expect.base), vote.expect.threshold, `${context}: the majority of the base`)
    const outcome = fixture.kind === 'decision'
      ? decisionOutcome(tallies, 'boolean', vote.expect.base)
      : electionOutcome(tallies, seats, vote.expect.base)

    assert.deepEqual(sorted(outcome.elected), sorted(vote.expect.elected), `${context}: elected`)
    assert.deepEqual(sorted(outcome.runoff), sorted(vote.expect.continuing), `${context}: continuing`)
    assert.equal(outcome.openSeats, vote.expect.openSeats, `${context}: open seats`)
    assert.equal(outcome.threshold, vote.expect.threshold, `${context}: threshold`)
    if (vote.expect.approved !== undefined) assert.equal((outcome as { approved?: boolean }).approved, vote.expect.approved, `${context}: approval`)

    const result: VoteResult = { candidates, seats, elected: outcome.elected, continuing: outcome.runoff, openSeats: outcome.openSeats, nextPrepared: outcome.runoff.length > 0 }
    assert.equal(result.nextPrepared, vote.expect.next, `${context}: next vote prepared`)
    if (fixture.kind !== 'decision') assertVoteInvariants(result, electedBefore, context)
    electedBefore.push(...outcome.elected)

    votes.push({
      number: index + 1,
      base: vote.expect.base,
      threshold: outcome.threshold,
      tally: candidates.map((label) => ({ label, count: tally[label]! })),
      abstained: counted.abstained,
      elected: outcome.elected,
      continuing: outcome.runoff,
      note: vote.before ? ('addCandidate' in vote.before ? `candidato nuevo: ${vote.before.addCandidate}` : 'con la secretaría regional') : undefined,
      approved: fixture.kind === 'decision' ? (outcome as { approved?: boolean }).approved : undefined,
    })
  })
  return { votes, elected: electedBefore }
}

for (const fixture of fixtures) {
  test(`engine · ${fixture.id}`, () => {
    const natural = playChain(fixture, null)
    writeChain(join(outputDirectory, 'engine'), fixture.id, `${fixture.office} (${fixture.seats} ${fixture.seats === 1 ? 'cupo' : 'cupos'}, ${fixture.delegates} delegados)`, natural.votes)

    for (const seed of [3, 17, 101]) {
      const shuffled = playChain(fixture, seed)
      assert.deepEqual(sorted(shuffled.elected), sorted(natural.elected), `${fixture.id}: shuffling ballots and options never changes who is elected`)
      assert.deepEqual(shuffled.votes.map((vote) => sorted(vote.continuing)), natural.votes.map((vote) => sorted(vote.continuing)), `${fixture.id}: nor who continues`)
    }

    const last = fixture.votes.at(-1)!
    if (!last.expect.next && fixture.kind !== 'decision' && !fixture.setupRejected) {
      assert.equal(natural.elected.length, fixture.seats, `${fixture.id}: a finished chain fills every seat`)
    }
    for (const [index, vote] of fixture.votes.entries()) {
      if (index < fixture.votes.length - 1) assert.equal(vote.expect.next, true, `${fixture.id}: vote ${index + 1} has a vote after it, so it prepared one`)
    }
  })
}

test('engine · more seats than candidates elects only those with a majority and never more than the candidates', () => {
  const outcome = electionOutcome([{ optionId: 'Elías', count: 30 }, { optionId: 'Eliseo', count: 5 }], 3, 38)
  assert.deepEqual(outcome.elected, ['Elías'])
  assert.deepEqual(outcome.runoff, ['Eliseo'])
  assert.equal(outcome.openSeats, 2)
})

test('engine · an empty ballot list elects nobody and does not throw', () => {
  const outcome = electionOutcome([], 1, 38)
  assert.deepEqual(outcome.elected, [])
  assert.deepEqual(outcome.runoff, [])
  assert.equal(outcome.openSeats, 1)
})
