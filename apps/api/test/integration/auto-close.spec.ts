import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import type { PrismaService } from '../../src/prisma/prisma.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'
import { RESULTS_ENGINE_ACTOR } from '../../src/voting/constants.js'

const delegates = ['Delegado 1', 'Delegado 2', 'Delegado 3']
const ballot = { title: 'Presidente', format: 'single_choice' as const, countingRule: { kind: 'count_only' as const }, options: [{ label: 'Isaías' }, { label: 'Jeremías' }] }
const closeActions = ['round.closed', 'round.closed_automatically']

async function statusOf(prisma: PrismaService, roundId: string) {
  return (await prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { status: true } })).status
}

async function settledStatus(prisma: PrismaService, roundId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await statusOf(prisma, roundId)
    if (status === 'published') return status
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return statusOf(prisma, roundId)
}

test('a vote closes by itself after the last ballot of everyone who can vote, and a disabled delegate does not hold it open', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-test', delegates })

  try {
    await room.setVotingDisabled(people['Delegado 3']!.id, true)
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)

    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    assert.equal(await statusOf(prisma, round.id), 'open', 'one person still has to vote')

    events.length = 0
    const accepted = await service.castVote(people['Delegado 2']!.id, round.id, round.options[1]!.id)
    assert.equal(accepted.accepted, true)
    assert.equal(await settledStatus(prisma, round.id), 'published', 'the result shows like any other closed vote')
    const closed = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    assert.equal(closed.eligibleCount, 3, 'the disabled delegate stays in the base')
    assert.ok(closed.votesUnlinkedAt, 'the votes are separated like after a manual close')
    assert.ok(events.some((event) => event.name === 'roundClosed'))

    const entries = await prisma.auditEvent.findMany({ where: { assemblyId, roundId: round.id, action: { in: closeActions } } })
    assert.deepEqual(entries.map((entry) => [entry.action, entry.actorRef, entry.metadata]), [['round.closed_automatically', RESULTS_ENGINE_ACTOR, { reason: 'everyone_voted' }]])

    await service.annulRound(round.id, 'Error en la papeleta')
    assert.equal(await statusOf(prisma, round.id), 'annulled')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('a vote stays open until the operator closes it while someone who can vote has not voted', async () => {
  const prisma = await connectDatabase()
  const { gateway } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-open-test', delegates })

  try {
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)
    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    await service.castVote(people['Delegado 2']!.id, round.id, round.options[0]!.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(await statusOf(prisma, round.id), 'open')

    await service.closeRound(round.id)
    const entries = await prisma.auditEvent.findMany({ where: { assemblyId, roundId: round.id, action: { in: closeActions } } })
    assert.deepEqual(entries.map((entry) => entry.action), ['round.closed'])
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('a vote where nobody in the base can vote stays open until the operator closes it', async () => {
  const prisma = await connectDatabase()
  const { gateway } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-nobody-test', delegates: ['Delegado 1'] })

  try {
    await room.setVotingDisabled(people['Delegado 1']!.id, true)
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)
    await assert.rejects(service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id))
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(await statusOf(prisma, round.id), 'open')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('an operator close racing the automatic close records one close and shows the result once', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-race-test', delegates: ['Delegado 1', 'Delegado 2'] })

  try {
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)
    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    events.length = 0
    await service.castVote(people['Delegado 2']!.id, round.id, round.options[1]!.id)
    await service.closeRound(round.id)
    assert.equal(await settledStatus(prisma, round.id), 'published')
    await new Promise((resolve) => setTimeout(resolve, 300))

    const entries = await prisma.auditEvent.findMany({ where: { assemblyId, roundId: round.id, action: { in: closeActions } } })
    assert.equal(entries.length, 1)
    assert.equal(events.filter((event) => event.name === 'roundClosed').length, 1)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('the last ballot is accepted without waiting for the votes to be separated, even when separating fails', async () => {
  const prisma = await connectDatabase()
  const locker = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
  await locker.connect()
  const { gateway } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-vacuum-test', delegates: ['Delegado 1', 'Delegado 2'] })
  let lockHeld = false

  try {
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)
    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    await locker.query('BEGIN')
    await locker.query('LOCK TABLE anonymous_votes IN ACCESS SHARE MODE')
    lockHeld = true

    const startedAt = Date.now()
    const accepted = await service.castVote(people['Delegado 2']!.id, round.id, round.options[1]!.id)
    const elapsed = Date.now() - startedAt
    assert.equal(accepted.accepted, true)
    assert.ok(elapsed < 2_000, `the last ballot waited ${elapsed} ms for the votes to be separated`)

    await locker.query('COMMIT')
    lockHeld = false
    if ((await settledStatus(prisma, round.id)) !== 'published') await service.closeRound(round.id)
    assert.equal(await settledStatus(prisma, round.id), 'published')
  } finally {
    if (lockHeld) await locker.query('ROLLBACK')
    await locker.end()
    await cleanup()
    await prisma.$disconnect()
  }
})
