import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import type { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

/** A closed-lobby assembly with `count` delegates, torn down after `body`. */
async function withAssembly(name: string, count: number, body: (ctx: { service: VotingService; prisma: PrismaService; assemblyId: string; people: string[] }) => Promise<void>) {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined
  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `${name}-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name, status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: string[] = []
    for (let index = 0; index < count; index += 1) {
      const joined = await service.joinAssembly(joinCode, `Delegado ${index + 1}`, 'Prueba')
      people.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    await body({ service, prisma, assemblyId, people })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
}

type Ballot = Array<{ id: string; label: string }>
const idsOf = (ballot: Ballot, labels: string[]) => labels.map((label) => ballot.find((option) => option.label === label)!.id)
const labelsOf = (ballot: Ballot, ids: string[]) => ids.map((id) => ballot.find((option) => option.id === id)!.label)

test('committee of 2, base 10: A 8, B 6, C 6 elects A and drafts a runoff between B and C for 1 seat', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  await withAssembly('tie-at-cut', 10, async ({ service, assemblyId, people }) => {
    const first = await service.createRound(assemblyId, {
      title: 'Comisión de Finanzas', category: 'committee', memberCount: 2, format: 'multiple_choice',
      options: [{ label: 'Ana Ruiz' }, { label: 'Juan Mora' }, { label: 'Elena Castro' }],
    })
    await service.openRound(first.id)
    // Exactly 2 marks each: 4 × (Ana, Juan), 4 × (Ana, Elena), 2 × (Juan, Elena) → Ana 8, Juan 6, Elena 6.
    const pairs = [...Array(4).fill(['Ana Ruiz', 'Juan Mora']), ...Array(4).fill(['Ana Ruiz', 'Elena Castro']), ...Array(2).fill(['Juan Mora', 'Elena Castro'])] as string[][]
    for (const [index, pair] of pairs.entries()) await service.castVote(people[index]!, first.id, idsOf(first.options, pair))
    await service.closeRound(first.id)

    let mesa = await service.moderatorAssembly(assemblyId)
    const closed = mesa.rounds.find((round) => round.id === first.id)!
    assert.equal(closed.eligibleCount, 10)
    assert.equal(closed.outcome?.threshold, 6, 'Juan and Elena both reach the majority of 10')
    assert.deepEqual(labelsOf(closed.options, closed.outcome!.elected), ['Ana Ruiz'])
    assert.deepEqual(labelsOf(closed.options, closed.outcome!.runoff), ['Juan Mora', 'Elena Castro'])
    assert.equal(closed.outcome?.openSeats, 1)
    assert.deepEqual(closed.officialResult?.elected.map((person) => person.label), ['Ana Ruiz'])

    // The draft runoff holds only the tied pair, for the one seat still open.
    const runoff = mesa.rounds.find((round) => round.runoffSourceRoundId === first.id)!
    assert.equal(runoff.status, 'draft')
    assert.deepEqual(runoff.options.map((option) => option.label), ['Juan Mora', 'Elena Castro'])
    assert.equal(runoff.electionSeats, 1)
    assert.equal(runoff.voteNumber, 2)
    assert.equal(runoff.runoff, true)

    // In the runoff each delegate marks exactly one name; majority is required again.
    await service.openRound(runoff.id)
    await assert.rejects(service.castVote(people[0]!, runoff.id, idsOf(runoff.options, ['Juan Mora', 'Elena Castro'])), UnprocessableEntityException)
    for (const [index, label] of ['Juan Mora', 'Juan Mora', 'Juan Mora', 'Juan Mora', 'Juan Mora', 'Juan Mora', 'Elena Castro', 'Elena Castro'].entries()) {
      await service.castVote(people[index]!, runoff.id, idsOf(runoff.options, [label]))
    }
    await service.closeRound(runoff.id)
    mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.rounds.find((round) => round.id === first.id)!.officialResult?.elected.map((person) => person.label), ['Ana Ruiz', 'Juan Mora'])
    assert.equal(mesa.rounds.some((round) => round.status === 'draft'), false, 'the committee is complete')
  })
})

test('nobody left to add: a committee of 2 with 2 candidates repeats the same runoff; from the 3rd vote the mesa may add a candidate, or annul', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  await withAssembly('nobody-to-add', 5, async ({ service, prisma, assemblyId, people }) => {
    const first = await service.createRound(assemblyId, {
      title: 'Comisión de Música', category: 'committee', memberCount: 2, format: 'multiple_choice',
      options: [{ label: 'Rosa Díaz' }, { label: 'Pedro Vargas' }],
    })
    const both = (ballot: Ballot) => idsOf(ballot, ['Rosa Díaz', 'Pedro Vargas'])
    const roundsOf = async () => (await service.moderatorAssembly(assemblyId)).rounds
    /** After each close there is exactly one runoff draft and nothing opens by itself. */
    const onlyDraftAfter = async (sourceRoundId: string) => {
      const rounds = await roundsOf()
      const drafts = rounds.filter((round) => round.status === 'draft')
      assert.equal(drafts.length, 1, 'one draft, waiting for the mesa')
      assert.equal(rounds.some((round) => round.status === 'open'), false)
      assert.equal(drafts[0]!.runoffSourceRoundId, sourceRoundId)
      return drafts[0]!
    }

    // 1st vote, base 5, majority 3. Exact-N forces both names on every ballot, so with 2 voters each has 2.
    await service.openRound(first.id)
    await assert.rejects(service.castVote(people[0]!, first.id, idsOf(first.options, ['Rosa Díaz'])), UnprocessableEntityException)
    for (const person of people.slice(0, 2)) await service.castVote(person, first.id, both(first.options))
    await service.closeRound(first.id)
    const closed = (await roundsOf()).find((round) => round.id === first.id)!
    assert.deepEqual(closed.outcome?.elected, [])
    assert.equal(closed.outcome?.openSeats, 2)

    // The pool equals the open seats and there is no next-ranked candidate: the same two, for the same 2 seats.
    const second = await onlyDraftAfter(first.id)
    assert.deepEqual(second.options.map((option) => option.label), ['Rosa Díaz', 'Pedro Vargas'])
    assert.equal(second.electionSeats, 2)
    assert.equal(second.voteNumber, 2)

    // 2nd vote: same turnout, same result, and the same runoff comes back as the 3rd vote.
    await service.openRound(second.id)
    for (const person of people.slice(0, 2)) await service.castVote(person, second.id, both(second.options))
    await service.closeRound(second.id)
    const third = await onlyDraftAfter(second.id)
    assert.deepEqual(third.options.map((option) => option.label), ['Rosa Díaz', 'Pedro Vargas'])
    assert.equal(third.electionSeats, 2)
    assert.equal(third.voteNumber, 3)

    // Way out 1: from the 3rd vote the mesa may add a candidate (and take it back before opening).
    const added = await service.addCandidate(third.id, 'Luis Pérez')
    assert.equal(await prisma.ballotOption.count({ where: { roundId: third.id } }), 3)
    await service.removeCandidate(third.id, added.option.id)

    // Way out 2: annul the 2nd vote. Its pending runoff is discarded; the repetition is still the 2nd vote.
    await service.annulRound(second.id, 'Repetir con más participación')
    assert.equal(await prisma.round.count({ where: { id: third.id } }), 0, 'the 3rd vote draft is discarded')
    const again = await service.repeatRound(second.id, { optionIds: second.options.map((option) => option.id) })
    assert.equal(again.electionSeats, 2)
    const repeated = (await roundsOf()).find((round) => round.id === again.id)!
    assert.equal(repeated.voteNumber, 2)

    // With 3 of 5 voting both reach the majority and fill the committee: no further draft.
    await service.openRound(again.id)
    for (const person of people.slice(0, 3)) await service.castVote(person, again.id, both(again.options))
    await service.closeRound(again.id)
    const rounds = await roundsOf()
    assert.deepEqual(rounds.find((round) => round.id === first.id)!.officialResult?.elected.map((person) => person.label), ['Rosa Díaz', 'Pedro Vargas'])
    assert.equal(rounds.some((round) => round.status === 'draft'), false)
  })
})
