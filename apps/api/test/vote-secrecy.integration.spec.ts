import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ServiceUnavailableException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('closing a round leaves no database-level link between participation receipts and anonymous votes', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  const prisma = new PrismaService()
  await prisma.$connect()
  const organizationId = randomUUID()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined
  const linkedRows = async (roundId: string) => (await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM participations p
    JOIN anonymous_votes v ON v.xmin = p.xmin AND v.round_id = p.round_id
    WHERE p.round_id = ${roundId}::uuid
  `)[0]!.count

  try {
    await prisma.organization.create({ data: { id: organizationId, name: `secrecy-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({ data: {
      organizationId, name: 'Secrecy test', status: 'lobby_closed', joinCodeHash: hashCredential(newOpaqueCredential()),
    } })
    assemblyId = assembly.id
    const voters = await Promise.all(Array.from({ length: 4 }, (_, index) => prisma.participantSession.create({ data: {
      assemblyId: assembly.id, firstName: `Voter${index}`, lastName: 'Test', tokenHash: hashCredential(newOpaqueCredential()),
    } })))
    const round = await prisma.round.create({ data: {
      assemblyId: assembly.id, title: 'Secret ballot', countingRule: { kind: 'count_only' },
      options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }, { label: 'C', order: 2 }] },
    }, include: { options: { orderBy: { order: 'asc' } } } })
    await service.openRound(round.id)
    const choices = [0, 2, 1, 2]
    for (const [index, voter] of voters.entries()) await service.castVote(voter.id, round.id, round.options[choices[index]!]!.id)

    assert.equal(await linkedRows(round.id), 4n, 'sanity check: while open, each vote shares its receipt transaction id')

    await service.closeRound(round.id)

    assert.equal(await linkedRows(round.id), 0n)
    assert.ok((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).votesUnlinkedAt, 'cleanup completion is recorded')
    const counts = await prisma.anonymousVote.groupBy({ by: ['optionId'], where: { roundId: round.id }, _count: { _all: true } })
    const byLabel = Object.fromEntries(round.options.map((option) => [option.label, counts.find((row) => row.optionId === option.id)?._count._all ?? 0]))
    assert.deepEqual(byLabel, { A: 1, B: 1, C: 2 }, 'unlinking must not change the tally')
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})

test('a failed VACUUM keeps the round closed, blocks publication, and is retried', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  const prisma = new PrismaService()
  await prisma.$connect()
  const organizationId = randomUUID()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `secrecy-retry-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({ data: {
      organizationId, name: 'Secrecy retry test', status: 'lobby_closed', joinCodeHash: hashCredential(newOpaqueCredential()),
    } })
    assemblyId = assembly.id
    const voter = await prisma.participantSession.create({ data: {
      assemblyId: assembly.id, firstName: 'Voter', lastName: 'Retry', tokenHash: hashCredential(newOpaqueCredential()),
    } })
    const round = await prisma.round.create({ data: {
      assemblyId: assembly.id, title: 'Retry ballot', countingRule: { kind: 'count_only' },
      options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] },
    }, include: { options: true } })
    await service.openRound(round.id)
    await service.castVote(voter.id, round.id, round.options[0]!.id)

    Object.assign(service, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })
    const closed = await service.closeRound(round.id)
    assert.equal(closed.status, 'closed', 'votes stop being accepted even if the cleanup fails')
    assert.equal(closed.secrecyCleanupPending, true)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).votesUnlinkedAt, null)
    await assert.rejects(service.publishRound(round.id), ServiceUnavailableException)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'closed')
    await assert.rejects(service.completeAssembly(assembly.id, true), ServiceUnavailableException, 'completion would remove every retry path')
    assert.equal((await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).status, 'in_progress')
    assert.equal((await service.moderatorAssembly(assembly.id)).rounds[0]?.secrecyCleanupPending, true, 'the pending state survives reloads')
    await assert.rejects(service.retrySecrecyCleanup(assembly.id), ServiceUnavailableException)

    delete (service as unknown as Record<string, unknown>).vacuumAnonymousVotes
    assert.deepEqual(await service.retrySecrecyCleanup(assembly.id), { assemblyId: assembly.id, secrecyCleanupPending: false })
    assert.ok((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).votesUnlinkedAt)
    assert.equal((await service.moderatorAssembly(assembly.id)).rounds[0]?.secrecyCleanupPending, false)
    const published = await service.publishRound(round.id)
    assert.equal(published.status, 'published')
    assert.equal(published.results.find((option) => option.label === 'A')?.count, 1)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})

test('startup unlinks rounds published before this protection existed, even in completed assemblies', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  const prisma = new PrismaService()
  await prisma.$connect()
  const organizationId = randomUUID()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `secrecy-legacy-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({ data: {
      organizationId, name: 'Legacy assembly', status: 'lobby_closed', joinCodeHash: hashCredential(newOpaqueCredential()),
    } })
    assemblyId = assembly.id
    const voter = await prisma.participantSession.create({ data: {
      assemblyId: assembly.id, firstName: 'Legacy', lastName: 'Voter', tokenHash: hashCredential(newOpaqueCredential()),
    } })
    const round = await prisma.round.create({ data: {
      assemblyId: assembly.id, title: 'Legacy ballot', countingRule: { kind: 'count_only' },
      options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] },
    }, include: { options: true } })
    await service.openRound(round.id)
    await service.castVote(voter.id, round.id, round.options[1]!.id)
    // Simulates data written by the previous release: published and completed without any unlinking.
    await prisma.round.update({ where: { id: round.id }, data: { status: 'published', closedAt: new Date(), publishedAt: new Date() } })
    await prisma.assembly.update({ where: { id: assembly.id }, data: { status: 'completed', completedAt: new Date() } })
    const linked = async () => (await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM participations p JOIN anonymous_votes v ON v.xmin = p.xmin AND v.round_id = p.round_id
      WHERE p.round_id = ${round.id}::uuid
    `)[0]!.count
    assert.equal(await linked(), 1n)

    await service.onModuleInit()

    assert.equal(await linked(), 0n)
    assert.ok((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).votesUnlinkedAt)
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id, optionId: round.options[1]!.id } }), 1)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})
