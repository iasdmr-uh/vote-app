import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'
import { delegateName } from './fixtures/session-tools.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

type Emitted = { name: string; args: unknown[] }

async function withAssembly(delegates: number, body: (context: {
  prisma: PrismaService
  service: VotingService
  emitted: Emitted[]
  assemblyId: string
  joinCode: string
  voters: string[]
}) => Promise<void>) {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const emitted: Emitted[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => { emitted.push({ name, args }) } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `result-flow-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId, name: 'Result flow', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const voters: string[] = []
    for (let number = 1; number <= delegates; number += 1) {
      const joined = await service.joinAssembly(joinCode, delegateName(number), 'Asamblea')
      voters.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    emitted.length = 0
    await body({ prisma, service, emitted, assemblyId, joinCode, voters })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.auditEvent.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
}

const countsOf = (options: Array<{ label: string; count: number }> | undefined) => options?.map((option) => [option.label, option.count])

test('closing a vote shows its result on every screen at once', { skip }, async () => {
  await withAssembly(3, async ({ prisma, service, emitted, assemblyId, joinCode, voters }) => {
    const round = await service.createRound(assemblyId, { title: 'Presidente', format: 'single_choice', options: [{ label: 'Isaías' }, { label: 'Jeremías' }], countingRule: { kind: 'count_only' } })
    await service.openRound(round.id)
    await service.castVote(voters[0]!, round.id, round.options[0]!.id)
    await service.castVote(voters[1]!, round.id, round.options[0]!.id)
    await service.castVote(voters[2]!, round.id, round.options[1]!.id)
    emitted.length = 0

    await service.closeRound(round.id)

    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'published')
    const expected = [['Isaías', 2], ['Jeremías', 1]]
    assert.deepEqual(countsOf((await service.publicState(joinCode)).results), expected)
    assert.deepEqual(countsOf((await service.participantState(voters[0]!)).results), expected)
    const mesa = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === round.id)!
    assert.deepEqual(countsOf(mesa.results), expected)
    assert.equal('privateResults' in mesa, false)
    const notices = emitted.filter((item) => item.name === 'resultsPublished')
    assert.equal(notices.length, 1, 'one notice reaches every room')
    assert.deepEqual(countsOf((notices[0]!.args[1] as { options: Array<{ label: string; count: number }> }).options), expected)
  })
})

test('no screen shows a result until the votes are separated, and a retry shows it everywhere', { skip }, async () => {
  await withAssembly(2, async ({ prisma, service, emitted, assemblyId, joinCode, voters }) => {
    const round = await service.createRound(assemblyId, { title: 'Presidente', format: 'single_choice', options: [{ label: 'Isaías' }, { label: 'Jeremías' }], countingRule: { kind: 'count_only' } })
    await service.openRound(round.id)
    await service.castVote(voters[0]!, round.id, round.options[0]!.id)
    await service.castVote(voters[1]!, round.id, round.options[0]!.id)
    emitted.length = 0
    Object.assign(service, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })

    const closed = await service.closeRound(round.id)

    assert.equal(closed.secrecyCleanupPending, true)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'closed')
    assert.equal((await service.publicState(joinCode)).results, undefined)
    assert.equal((await service.participantState(voters[0]!)).results, undefined)
    const pending = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === round.id)!
    assert.equal(pending.secrecyCleanupPending, true)
    assert.equal('results' in pending, false)
    assert.equal('privateResults' in pending, false, 'the mesa gets no counts before the public screen')
    assert.equal('outcome' in pending, false)
    assert.equal(pending.officialResult, null)
    assert.equal(emitted.some((item) => item.name === 'resultsPublished'), false)

    delete (service as unknown as Record<string, unknown>).vacuumAnonymousVotes
    await service.retrySecrecyCleanup(assemblyId)

    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'published')
    assert.deepEqual(countsOf((await service.publicState(joinCode)).results), [['Isaías', 2], ['Jeremías', 0]])
    assert.equal(emitted.filter((item) => item.name === 'resultsPublished').length, 1)
  })
})

test('the service offers no action to publish a result', { skip }, async () => {
  await withAssembly(1, async ({ service }) => {
    assert.equal('publishRound' in service, false)
  })
})

test('the vote that settles an election is recorded, and a vote that leaves seats open is not', { skip }, async () => {
  await withAssembly(4, async ({ prisma, service, assemblyId, voters }) => {
    const first = await service.createRound(assemblyId, { title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, format: 'multiple_choice', options: ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas'].map((label) => ({ label })) })
    const id = (round: { options: Array<{ id: string; label: string }> }, label: string) => round.options.find((option) => option.label === label)!.id
    await service.openRound(first.id)
    const ballots = [['Isaías', 'Jeremías', 'Ezequiel'], ['Isaías', 'Daniel', 'Oseas'], ['Isaías', 'Jeremías', 'Daniel'], ['Isaías', 'Ezequiel', 'Oseas']]
    for (const [index, voter] of voters.entries()) await service.castVote(voter, first.id, ballots[index]!.map((label) => id(first, label)))
    await service.closeRound(first.id)

    const afterFirst = await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id } })
    assert.equal(afterFirst.settledRoundId, null, 'seats remain open')
    const runoff = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.runoffSourceRoundId === first.id)!
    const runoffRound = { options: runoff.options.map((option) => ({ id: option.id, label: option.label })) }
    await service.openRound(runoff.id)
    for (const voter of voters) await service.castVote(voter, runoff.id, [id(runoffRound, 'Jeremías'), id(runoffRound, 'Ezequiel')])
    await service.closeRound(runoff.id)

    const settled = await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id } })
    assert.equal(settled.settledRoundId, runoff.id)
    assert.equal(settled.approved, null, 'an election has no approval')

    await service.annulRound(runoff.id, 'Se contó con un error')
    assert.equal((await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id } })).settledRoundId, null, 'annulling the settling vote unsettles the election')
  })
})

test('a yes or no decision records whether it was approved', { skip }, async () => {
  await withAssembly(3, async ({ prisma, service, assemblyId, voters }) => {
    const statute = await service.createRound(assemblyId, { title: 'Reforma de estatutos', format: 'single_choice', category: 'decision', decisionFormat: 'boolean' })
    const [, contra] = statute.options
    await service.openRound(statute.id)
    for (const voter of voters) await service.castVote(voter, statute.id, contra!.id)
    await service.closeRound(statute.id)

    const row = await prisma.officialResult.findUniqueOrThrow({ where: { roundId: statute.id } })
    assert.equal(row.settledRoundId, statute.id)
    assert.equal(row.approved, false)
    assert.equal(row.registeredAt, null)
  })
})
