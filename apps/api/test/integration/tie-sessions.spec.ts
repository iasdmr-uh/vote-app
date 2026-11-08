import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { writeChain, type ChainVote } from '../scenarios/chain-diagram.js'
import { assertVoteInvariants, candidatesOf, delegateName, expandBallots, seatsOf, seededShuffle, sorted } from '../scenarios/session-tools.js'
import { fixtures, type Fixture } from '../scenarios/tie-sessions.js'

const outputDirectory = process.env.SCENARIOS_OUT ?? fileURLToPath(new URL('../../../../test-results/scenarios/', import.meta.url))

type Option = { id: string; label: string }
type Mesa = Awaited<ReturnType<VotingService['moderatorAssembly']>>

async function withAssembly(name: string, count: number, body: (context: { service: VotingService; assemblyId: string; people: string[] }) => Promise<void>) {
  const prisma = await connectDatabase()
  const service = new VotingService(prisma, gatewayStub().gateway)
  const names = Array.from({ length: count }, (_, index) => delegateName(index + 1))
  const seeded = await seedAssembly(prisma, service, { label: name, delegates: names })
  try {
    await body({ service, assemblyId: seeded.assemblyId, people: names.map((person) => seeded.people[person]!.id) })
  } finally {
    await seeded.cleanup()
    await prisma.$disconnect()
  }
}

const idsOf = (options: Option[], labels: string[]) => labels.map((label) => options.find((option) => option.label === label)!.id)
const labelsOf = (options: Option[], ids: string[]) => ids.map((id) => options.find((option) => option.id === id)!.label)
const roundOf = (mesa: Mesa, id: string) => mesa.rounds.find((round) => round.id === id)!

function createInput(fixture: Fixture, candidates: string[]) {
  const options = candidates.map((label) => ({ label }))
  if (fixture.kind === 'committee') return { title: fixture.office, category: 'committee' as const, memberCount: fixture.seats, format: 'multiple_choice' as const, options }
  if (fixture.kind === 'decision') return { title: fixture.office, category: 'decision' as const, decisionFormat: 'boolean' as const, format: 'single_choice' as const }
  return { title: fixture.office, category: 'office' as const, format: 'single_choice' as const, options }
}

async function playFixture(fixture: Fixture, seed: number | null) {
  const label = seed === null ? 'natural order' : `shuffle ${seed}`
  await withAssembly(`${fixture.id}-${label}`, fixture.delegates, async ({ service, assemblyId, people }) => {
    const initial = seed === null || fixture.kind === 'decision' ? candidatesOf(fixture, 0) : seededShuffle(candidatesOf(fixture, 0), seed)

    if (fixture.setupRejected) {
      await assert.rejects(service.createRound(assemblyId, createInput(fixture, initial)), UnprocessableEntityException)
      return
    }

    let current: { id: string; options: Option[] } = await service.createRound(assemblyId, createInput(fixture, initial))
    let secretaryId: string | null = null
    const chain: ChainVote[] = []
    const electedBefore: string[] = []

    for (const [index, vote] of fixture.votes.entries()) {
      const context = `${fixture.id} (${label}) vote ${index + 1}`
      const castAll = async (roundId: string, options: Option[], groups: typeof vote.ballots, secretaryMarks?: string[]) => {
        const ballots = expandBallots(groups, fixture.delegates)
        for (const { delegate, marks } of seed === null ? ballots : seededShuffle(ballots, seed + index)) {
          if (marks.length) await service.castVote(people[delegate - 1]!, roundId, idsOf(options, marks))
        }
        if (secretaryMarks) await service.castVote(secretaryId!, roundId, idsOf(options, secretaryMarks))
      }

      if (vote.before && 'addCandidate' in vote.before) {
        const added = await service.addCandidate(current.id, vote.before.addCandidate)
        assert.equal(added.option.isNew, true, `${context}: the added candidate is marked new`)
      }
      if (vote.before && 'addRegionalSecretary' in vote.before) {
        secretaryId = (await service.addRegionalSecretary(current.id, vote.before.addRegionalSecretary)).participantId
      }

      let mesa = await service.moderatorAssembly(assemblyId)
      let draft = roundOf(mesa, current.id)
      assert.equal(draft.status, 'draft', `${context}: waits as a draft`)
      assert.equal(draft.voteNumber, index + 1, `${context}: vote number`)
      if (fixture.kind !== 'decision') {
        assert.deepEqual(sorted(draft.options.map((option) => option.label)), sorted(candidatesOf(fixture, index)), `${context}: the ballot holds the pool`)
        if (fixture.kind === 'committee') assert.equal(draft.electionSeats, seatsOf(fixture, index), `${context}: asks for the open seats`)
      }

      if (vote.annulledAttempt) {
        await service.openRound(current.id)
        await castAll(current.id, draft.options, vote.annulledAttempt.ballots)
        await service.annulRound(current.id, vote.annulledAttempt.reason)
        mesa = await service.moderatorAssembly(assemblyId)
        assert.equal(roundOf(mesa, current.id).status, 'annulled', `${context}: the first attempt is annulled`)
        const repeated = await service.repeatRound(current.id, { optionIds: draft.options.map((option) => option.id) })
        current = repeated
        mesa = await service.moderatorAssembly(assemblyId)
        draft = roundOf(mesa, current.id)
        assert.equal(draft.voteNumber, index + 1, `${context}: the repeat keeps the vote number`)
      }

      await service.openRound(current.id)
      await castAll(current.id, draft.options, vote.ballots, vote.secretaryMarks)
      await service.closeRound(current.id)

      mesa = await service.moderatorAssembly(assemblyId)
      const closed = roundOf(mesa, current.id)
      const outcome = closed.outcome!
      assert.equal(closed.eligibleCount, vote.expect.base, `${context}: base`)
      assert.equal(outcome.threshold, vote.expect.threshold, `${context}: threshold`)
      const counts = Object.fromEntries(closed.results!.map((row) => [row.label, row.count]))
      assert.deepEqual(counts, vote.expect.tally, `${context}: tally`)
      const elected = labelsOf(closed.options, outcome.elected)
      const continuing = labelsOf(closed.options, outcome.runoff)
      assert.deepEqual(sorted(elected), sorted(vote.expect.elected), `${context}: elected`)
      assert.deepEqual(sorted(continuing), sorted(vote.expect.continuing), `${context}: continuing`)
      assert.equal(outcome.openSeats, vote.expect.openSeats, `${context}: open seats`)
      if (vote.expect.approved !== undefined) assert.equal((outcome as { approved?: boolean }).approved, vote.expect.approved, `${context}: approval`)

      const drafts = mesa.rounds.filter((round) => round.status === 'draft')
      assert.equal(mesa.rounds.some((round) => round.status === 'open'), false, `${context}: nothing opens by itself`)
      assert.equal(drafts.length, vote.expect.next ? 1 : 0, `${context}: next vote prepared`)
      const next = drafts[0]
      if (next) {
        assert.equal(next.runoffSourceRoundId, current.id, `${context}: the next vote comes from this one`)
        assert.deepEqual(sorted(next.options.map((option) => option.label)), sorted(vote.expect.continuing), `${context}: the next ballot holds the pool`)
      }
      if (fixture.kind !== 'decision') {
        assertVoteInvariants({ candidates: closed.options.map((option) => option.label), seats: seatsOf(fixture, index), elected, continuing, openSeats: outcome.openSeats, nextPrepared: drafts.length > 0 }, electedBefore, context)
      }
      electedBefore.push(...elected)

      chain.push({
        number: index + 1,
        base: closed.eligibleCount,
        threshold: outcome.threshold,
        tally: closed.results!.map((row) => ({ label: row.label, count: row.count })),
        abstained: closed.eligibleCount - closed.participationCount,
        elected,
        continuing,
        note: vote.annulledAttempt ? 'repetida tras anular' : vote.before ? ('addCandidate' in vote.before ? `candidato nuevo: ${vote.before.addCandidate}` : 'con la secretaría regional') : undefined,
        approved: fixture.kind === 'decision' ? (outcome as { approved?: boolean }).approved : undefined,
      })

      if (next) current = next
    }

    const final = await service.moderatorAssembly(assemblyId)
    const official = final.rounds.flatMap((round) => (round.officialResult?.elected ?? []).map((person) => person.label))
    const rootOfficial = [...new Set(official)]
    assert.deepEqual(sorted(rootOfficial), sorted(electedBefore), `${fixture.id} (${label}): the official result lists everyone elected`)
    assert.ok(electedBefore.length <= fixture.seats, `${fixture.id} (${label}): elected never exceed the seats`)
    writeChain(join(outputDirectory, 'api'), `${fixture.id}-${seed === null ? 'natural' : `shuffle-${seed}`}`, `${fixture.office} (${label})`, chain)
  })
}

for (const fixture of fixtures) {
  test(`api · ${fixture.id} · natural order`, () => playFixture(fixture, null))
  test(`api · ${fixture.id} · shuffled ballots`, () => playFixture(fixture, 29))
}
