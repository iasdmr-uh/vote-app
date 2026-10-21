import assert from 'node:assert/strict'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { VotingService } from '../src/voting/voting.service.js'

const service = new VotingService({} as never, {} as never)
const base = {
  title: 'Comisión de Finanzas',
  format: 'multiple_choice' as const,
  options: [{ label: 'Ana Reyes' }, { label: 'Luis Mejía' }, { label: 'Rosa Paz' }],
  countingRule: { kind: 'count_only' },
}

test('a committee needs its size, at least as many candidates as seats, and only committees take a size', async () => {
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee' }), /cuántos integrantes/)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee', memberCount: 4 }), /al menos 4 candidatos/)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'office', memberCount: 3 }), UnprocessableEntityException)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee', memberCount: 2, options: [] }), /al menos una opción/)
})

test('a committee is a multiple-choice ballot of typed names, limited to its size, with no null vote', async () => {
  let created: Record<string, any> | undefined
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'in_progress' }],
    round: { create: async ({ data }: { data: Record<string, any> }) => { created = data; return { id: 'round', status: 'draft', ...data, options: data.options.create } } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUnique: async () => null } } as never, {} as never)
  const round = await voting.createRound('assembly', { ...base, format: 'single_choice', category: 'committee', memberCount: 2 })
  assert.equal(created?.format, 'multiple_choice')
  assert.equal(created?.memberCount, 2)
  assert.equal(created?.electionSeats, 2, 'each delegate marks up to the committee size')
  assert.deepEqual(round.options.map((option: { label: string }) => option.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'], 'more candidates than seats; nothing added')
})

test('"Voto nulo" is an ordinary name now: nothing is added to the ballot or reserved', async () => {
  let labels: string[] = []
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'in_progress' }],
    round: { create: async ({ data }: { data: Record<string, any> }) => { labels = data.options.create.map((option: { label: string }) => option.label); return { id: 'round', ...data, options: [] } } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUnique: async () => null } } as never, {} as never)
  await voting.createRound('assembly', { ...base, category: 'office', format: 'single_choice', options: [{ label: 'A' }, { label: 'B' }] })
  assert.deepEqual(labels, ['A', 'B'])
})

test('a committee vote takes from one up to the committee size, never more', async () => {
  const votes: string[][] = []
  const tx = {
    $queryRaw: async () => [{ id: 'round', assembly_id: 'assembly', status: 'open', format: 'multiple_choice', member_count: 2, election_seats: 2 }],
    ballotOption: { count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length },
    participation: { create: async () => ({}) },
    anonymousVote: { createMany: async ({ data }: { data: Array<{ optionId: string }> }) => { votes.push(data.map((vote) => vote.optionId)) } },
  }
  const database = {
    participantSession: { findUnique: async () => ({ id: 'delegate', assemblyId: 'assembly', status: 'active' }), count: async () => 1 },
    participation: { count: async () => 1 },
    $transaction: async (work: (value: unknown) => unknown) => work(tx),
  }
  const voting = new VotingService(database as never, { participantState: () => undefined, participationCount: () => undefined } as never)
  Object.assign(voting, { participantState: async () => ({}) })
  await assert.rejects(voting.castVote('delegate', 'round', ['a', 'b', 'c']), /como máximo 2 nombres/)
  await assert.rejects(voting.castVote('delegate', 'round', []), /al menos una opción/)
  await voting.castVote('delegate', 'round', ['a'])
  await voting.castVote('delegate', 'round', ['a', 'b'])
  assert.deepEqual(votes, [['a'], ['a', 'b']])
})

test('a declared committee composition must match its configured number of seats', async () => {
  const database = {
    $transaction: async (work: (tx: unknown) => unknown) => work({
      $queryRaw: async () => [{ id: 'round', assembly_id: 'assembly', status: 'closed', category: 'committee', member_count: 3 }],
      round: { findUniqueOrThrow: async () => ({ committeeRootRoundId: null }), findMany: async () => [{ status: 'closed' }] },
    }),
  }
  const voting = new VotingService(database as never, {} as never)
  await assert.rejects(
    voting.declareOfficialResult('round', { optionIds: ['one', 'two'] }),
    UnprocessableEntityException,
  )
})

test('the mesa sees who voted in the latest opened ballot, never what they chose', async () => {
  const database = {
    assembly: { findUnique: async () => ({
      id: 'assembly', name: 'Asamblea', status: 'in_progress', completedAt: null,
      participants: [{ id: 'ana', firstName: 'Ana', lastName: 'Reyes' }, { id: 'luis', firstName: 'Luis', lastName: 'Mejía' }],
      rounds: [],
    }) },
    round: { findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: Record<string, string> }) => {
      assert.deepEqual(where.openedAt, { not: null }, 'a closed ballot keeps its dots until the next one opens')
      assert.deepEqual(orderBy, { openedAt: 'desc' })
      return { id: 'closed-round', status: 'closed' }
    } },
    participation: { findMany: async ({ where }: { where: { roundId: string } }) => where.roundId === 'closed-round' ? [{ participantSessionId: 'ana' }] : [] },
  }
  const voting = new VotingService(database as never, {} as never)
  const state = await voting.moderatorAssembly('assembly')
  assert.deepEqual(state.participants.map((person) => [person.id, person.voted]), [['ana', true], ['luis', false]])
  assert.deepEqual(state.attendanceRound, { roundId: 'closed-round', status: 'closed', votedCount: 1 })
})

test('before any ballot opens, nobody carries a voted flag', async () => {
  const database = {
    assembly: { findUnique: async () => ({ id: 'assembly', name: 'Asamblea', status: 'lobby_closed', completedAt: null, participants: [{ id: 'ana', firstName: 'Ana', lastName: 'Reyes' }], rounds: [] }) },
    round: { findFirst: async () => null },
    participation: { findMany: async () => assert.fail('no receipts to read') },
  }
  const state = await new VotingService(database as never, {} as never).moderatorAssembly('assembly')
  assert.equal('voted' in state.participants[0]!, false)
  assert.equal(state.attendanceRound, null)
})

test('recovery lists completed assemblies still holding data, so a closed tab does not lose the acta', async () => {
  const completedAt = new Date('2026-10-14T20:00:00.000Z')
  const voting = new VotingService({ assembly: {
    findFirst: async () => null,
    findMany: async ({ where }: { where: { status: string } }) => where.status === 'completed' ? [{ id: 'done', name: 'Asamblea 2026', completedAt }] : [],
  } } as never, {} as never)
  assert.deepEqual(await voting.activeAssembly(), { assembly: null, completed: [{ id: 'done', name: 'Asamblea 2026', completedAt: completedAt.toISOString() }] })
})
