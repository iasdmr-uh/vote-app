import assert from 'node:assert/strict'
import type { Fixture, Group } from './tie-sessions.js'

export type Ballot = { delegate: number; marks: string[] }

export type VoteResult = {
  candidates: string[]
  seats: number
  elected: string[]
  continuing: string[]
  openSeats: number
  nextPrepared: boolean
}

export const delegateName = (number: number) => `Delegado ${String(number).padStart(2, '0')}`

export const sorted = (labels: string[]) => [...labels].sort((a, b) => a.localeCompare(b, 'es'))

export function expandBallots(groups: Group[], delegates: number): Ballot[] {
  const ballots: Ballot[] = []
  for (const { delegates: [from, to], marks } of groups) {
    for (let delegate = from; delegate <= to; delegate += 1) ballots.push({ delegate, marks })
  }
  const numbers = ballots.map((ballot) => ballot.delegate).sort((a, b) => a - b)
  assert.deepEqual(numbers, Array.from({ length: delegates }, (_, index) => index + 1), 'every delegate appears exactly once')
  return ballots
}

export function tallyOf(candidates: string[], ballots: Ballot[]) {
  const tally = Object.fromEntries(candidates.map((label) => [label, 0])) as Record<string, number>
  let abstained = 0
  for (const { marks } of ballots) {
    if (!marks.length) abstained += 1
    for (const mark of marks) {
      assert.ok(mark in tally, `${mark} is on the ballot`)
      tally[mark] += 1
    }
  }
  return { tally, abstained }
}

export function candidatesOf(fixture: Fixture, voteIndex: number) {
  if (voteIndex === 0) return [...fixture.candidates]
  const previous = fixture.votes[voteIndex - 1]!.expect.continuing
  const added = fixture.votes[voteIndex]!.before
  return added && 'addCandidate' in added ? [...previous, added.addCandidate] : [...previous]
}

export function seatsOf(fixture: Fixture, voteIndex: number) {
  return voteIndex === 0 ? fixture.seats : fixture.votes[voteIndex - 1]!.expect.openSeats
}

export function seededShuffle<T>(items: T[], seed: number) {
  const result = [...items]
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1))
    ;[result[index], result[other]] = [result[other]!, result[index]!]
  }
  return result
}

export function assertBallotsValid(fixture: Fixture, voteIndex: number, ballots: Ballot[]) {
  const candidates = candidatesOf(fixture, voteIndex)
  const seats = fixture.kind === 'decision' ? 1 : seatsOf(fixture, voteIndex)
  for (const { delegate, marks } of ballots) {
    assert.equal(new Set(marks).size, marks.length, `${delegateName(delegate)} repeats a name`)
    assert.ok(marks.every((mark) => candidates.includes(mark)), `${delegateName(delegate)} marks someone off the ballot`)
    if (!fixture.setupRejected) assert.ok(marks.length === 0 || marks.length === seats, `${delegateName(delegate)} marks exactly ${seats} names or none`)
  }
}

export function assertVoteInvariants(result: VoteResult, electedBefore: string[], context: string) {
  assert.ok(result.elected.length <= result.seats, `${context}: elected never exceed the seats`)
  assert.ok(result.elected.every((label) => result.candidates.includes(label)), `${context}: the elected were on the ballot`)
  assert.equal(new Set(result.elected).size, result.elected.length, `${context}: nobody is elected twice`)
  assert.deepEqual(result.elected.filter((label) => result.continuing.includes(label)), [], `${context}: nobody is both elected and continuing`)
  assert.deepEqual(result.elected.filter((label) => electedBefore.includes(label)), [], `${context}: nobody is elected again`)
  assert.deepEqual(result.continuing.filter((label) => electedBefore.includes(label)), [], `${context}: nobody elected earlier continues`)
  assert.ok(result.continuing.every((label) => result.candidates.includes(label)), `${context}: the pool comes from the ballot`)
  assert.equal(result.openSeats, result.seats - result.elected.length, `${context}: open seats are seats minus elected`)
  if (result.openSeats > 0 && result.candidates.length >= result.seats) {
    assert.equal(result.nextPrepared, true, `${context}: seats left open prepare a next vote`)
    assert.ok(result.continuing.length > 0, `${context}: the next vote has candidates`)
  }
  if (result.openSeats === 0) assert.equal(result.nextPrepared, false, `${context}: a filled office prepares no next vote`)
}
