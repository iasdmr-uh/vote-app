import assert from 'node:assert/strict'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { buildProviders } from '../support/providers.js'

const service = buildProviders({}, {}).voting
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

test('a committee is a multiple-choice ballot of typed names, sized to its seats, with no null vote', async () => {
  let created: Record<string, any> | undefined
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'in_progress' }],
    round: { count: async () => 0, create: async ({ data }: { data: Record<string, any> }) => { created = data; return { id: 'round', status: 'draft', ...data, options: data.options.create } } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = buildProviders({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUnique: async () => null } }, {}).voting
  const round = await voting.createRound('assembly', { ...base, format: 'single_choice', category: 'committee', memberCount: 2 })
  assert.equal(created?.format, 'multiple_choice')
  assert.equal(created?.memberCount, 2)
  assert.equal(created?.electionSeats, 2, 'each delegate marks exactly the committee size')
  assert.deepEqual(round.options.map((option: { label: string }) => option.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'], 'more candidates than seats; nothing added')
})

test('"Voto nulo" is an ordinary name now: nothing is added to the ballot or reserved', async () => {
  let labels: string[] = []
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'in_progress' }],
    round: { count: async () => 0, create: async ({ data }: { data: Record<string, any> }) => { labels = data.options.create.map((option: { label: string }) => option.label); return { id: 'round', ...data, options: [] } } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = buildProviders({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUnique: async () => null } }, {}).voting
  await voting.createRound('assembly', { ...base, category: 'office', format: 'single_choice', options: [{ label: 'A' }, { label: 'B' }] })
  assert.deepEqual(labels, ['A', 'B'])
})

function exactSeatsVoting(seats: { member_count: number | null; election_seats: number | null }, format = 'multiple_choice') {
  const votes: string[][] = []
  const tx = {
    $queryRaw: async () => [{ id: 'round', assembly_id: 'assembly', status: 'open', format, ...seats }],
    ballotOption: { count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length },
    participation: { create: async () => ({}) },
    anonymousVote: { createMany: async ({ data }: { data: Array<{ optionId: string }> }) => { votes.push(data.map((vote) => vote.optionId)) } },
  }
  const database = {
    participantSession: { findUnique: async () => ({ id: 'delegate', assemblyId: 'assembly', status: 'active' }), count: async () => 1, findMany: async () => [], findFirst: async () => null },
    participation: { count: async () => 1 },
    round: { findMany: async () => [{ id: 'round', committeeRootRoundId: null }] },
    $transaction: async (work: (value: unknown) => unknown) => work(tx),
  }
  const voting = buildProviders(database, { participantState: () => undefined, participationCount: () => undefined }).voting
  Object.assign(voting, { participantState: async () => ({}) })
  return { voting, votes }
}

test('a committee vote takes exactly the committee size, never fewer or more', async () => {
  const { voting, votes } = exactSeatsVoting({ member_count: 2, election_seats: 2 })
  await assert.rejects(voting.castVote('delegate', 'round', ['a', 'b', 'c']), /exactamente 2 nombres/)
  await assert.rejects(voting.castVote('delegate', 'round', ['a']), /exactamente 2 nombres/)
  await assert.rejects(voting.castVote('delegate', 'round', []), /al menos una opción/)
  await voting.castVote('delegate', 'round', ['a', 'b'])
  assert.deepEqual(votes, [['a', 'b']])
})

test('a runoff takes exactly its open seats, not the committee size', async () => {
  const { voting, votes } = exactSeatsVoting({ member_count: 3, election_seats: 2 })
  await assert.rejects(voting.castVote('delegate', 'round', ['a', 'b', 'c']), /exactamente 2 nombres/)
  await assert.rejects(voting.castVote('delegate', 'round', ['a']), /exactamente 2 nombres/)
  await voting.castVote('delegate', 'round', ['b', 'c'])
  assert.deepEqual(votes, [['b', 'c']])
})

test('a one-seat runoff takes exactly one name', async () => {
  const { voting, votes } = exactSeatsVoting({ member_count: 3, election_seats: 1 })
  await assert.rejects(voting.castVote('delegate', 'round', ['a', 'b']), /exactamente 1 nombre$/)
  await voting.castVote('delegate', 'round', ['a'])
  assert.deepEqual(votes, [['a']])
})

test('an office ballot without seats still takes a single choice', async () => {
  const { voting, votes } = exactSeatsVoting({ member_count: null, election_seats: null }, 'single_choice')
  await assert.rejects(voting.castVote('delegate', 'round', ['a', 'b']), /una sola opción/)
  await voting.castVote('delegate', 'round', ['a'])
  assert.deepEqual(votes, [['a']])
})

test('the mesa sees how many voted in the latest opened ballot and never who (#55)', async () => {
  const database = {
    assembly: { findUnique: async () => ({
      id: 'assembly', name: 'Asamblea', status: 'in_progress', completedAt: null,
      participants: [{ id: 'ana', firstName: 'Ana', lastName: 'Reyes' }, { id: 'luis', firstName: 'Luis', lastName: 'Mejía' }],
      rounds: [],
    }) },
    round: { findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: Record<string, string> }) => {
      assert.deepEqual(where.openedAt, { not: null }, 'a closed ballot keeps its count until the next one opens')
      assert.deepEqual(orderBy, { openedAt: 'desc' })
      return { id: 'closed-round', status: 'closed' }
    }, findMany: async () => [{ id: 'closed-round', committeeRootRoundId: null }] },
    participation: {
      count: async ({ where }: { where: { roundId: string } }) => where.roundId === 'closed-round' ? 1 : 0,
      findMany: async () => assert.fail('the mesa never reads who voted'),
    },
    participantSession: { count: async () => 2, findMany: async () => [], findFirst: async () => null },
    position: { findMany: async () => [] },
  }
  const voting = buildProviders(database, {}).voting
  const state = await voting.moderatorAssembly('assembly')
  assert.deepEqual(state.participants.map((person) => 'voted' in person), [false, false])
  assert.deepEqual(state.attendanceRound, { roundId: 'closed-round', status: 'closed', votedCount: 1, eligibleCount: 2 })
})

test('before any ballot opens, nobody carries a voted flag', async () => {
  const database = {
    assembly: { findUnique: async () => ({ id: 'assembly', name: 'Asamblea', status: 'lobby_closed', completedAt: null, participants: [{ id: 'ana', firstName: 'Ana', lastName: 'Reyes' }], rounds: [] }) },
    round: { findFirst: async () => null, findMany: async () => [] },
    participation: { findMany: async () => assert.fail('no receipts to read') },
    participantSession: { count: async () => 1, findMany: async () => [], findFirst: async () => null },
    position: { findMany: async () => [] },
  }
  const state = await buildProviders(database, {}).voting.moderatorAssembly('assembly')
  assert.equal('voted' in state.participants[0]!, false)
  assert.equal(state.attendanceRound, null)
})

test('recovery lists completed assemblies still holding data, so a closed tab does not lose the acta', async () => {
  const completedAt = new Date('2026-10-14T20:00:00.000Z')
  const voting = buildProviders({ assembly: {
    findFirst: async () => null,
    findMany: async ({ where }: { where: { status: string } }) => where.status === 'completed' ? [{ id: 'done', name: 'Asamblea 2026', completedAt }] : [],
  } }, {}).voting
  assert.deepEqual(await voting.activeAssembly(), { assembly: null, completed: [{ id: 'done', name: 'Asamblea 2026', completedAt: completedAt.toISOString() }] })
})
