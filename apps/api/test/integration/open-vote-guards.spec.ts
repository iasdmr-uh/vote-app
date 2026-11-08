import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { removeOrganization } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

async function setup(label: string) {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const providers = buildProviders(prisma, gateway)
  const organizationId = randomUUID()
  await prisma.organization.create({ data: { id: organizationId, name: `${label}-${organizationId}`, type: 'union' } })
  const assembly = await prisma.assembly.create({ data: {
    organizationId, name: 'Asamblea de prueba', status: 'lobby_closed', joinCodeHash: hashCredential(newOpaqueCredential()),
  } })
  const voter = await prisma.participantSession.create({ data: {
    assemblyId: assembly.id, firstName: 'Ezequiel', lastName: 'Buzí', tokenHash: hashCredential(newOpaqueCredential()),
  } })
  const ballot = (title: string) => prisma.round.create({ data: {
    assemblyId: assembly.id, title, countingRule: { kind: 'count_only' },
    options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] },
  }, include: { options: true } })
  const cleanup = async () => {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  }
  return { prisma, events, ...providers, assemblyId: assembly.id, voter, ballot, cleanup }
}

const auditCount = (prisma: Awaited<ReturnType<typeof setup>>['prisma'], assemblyId: string) => prisma.auditEvent.count({ where: { assemblyId } })

test('the mesa cannot start «Presentar oficiales» while a vote is open, and can once it closes', async () => {
  const { prisma, events, voting, presentation, assemblyId, ballot, cleanup } = await setup('presentation-open-vote')
  try {
    const round = await ballot('Presidencia')
    await voting.openRound(round.id)
    const audits = await auditCount(prisma, assemblyId)
    events.length = 0

    await assert.rejects(presentation.setPresentation({ assemblyId, active: true, slide: 0 }), (error: unknown) =>
      error instanceof ConflictException && /votación/.test(error.message))
    assert.equal(events.length, 0)
    assert.equal(await auditCount(prisma, assemblyId), audits)
    assert.equal((await prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } })).presentationActive, false)

    await voting.closeRound(round.id)
    assert.deepEqual(await presentation.setPresentation({ assemblyId, active: true, slide: 0 }), { assemblyId, presentation: { active: true, slide: 0 } })
  } finally { await cleanup() }
})

test('the mesa cannot retry the secrecy cleanup while a vote is open, and closing that vote runs it', async () => {
  const { prisma, voting, assemblyId, voter, ballot, cleanup } = await setup('cleanup-open-vote')
  try {
    const annulled = await ballot('Presidencia')
    await voting.openRound(annulled.id)
    await voting.castVote(voter.id, annulled.id, annulled.options[0]!.id)
    Object.assign(voting, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })
    await voting.annulRound(annulled.id, 'Falla de prueba')
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: annulled.id } })).votesUnlinkedAt, null)

    let vacuums = 0
    Object.assign(voting, { vacuumAnonymousVotes: async () => { vacuums += 1 } })
    const open = await ballot('Presidencia, de nuevo')
    await voting.openRound(open.id)
    await assert.rejects(voting.retrySecrecyCleanup(assemblyId), (error: unknown) =>
      error instanceof ConflictException && /votación/.test(error.message))
    assert.equal(vacuums, 0, 'no VACUUM FULL runs during the vote')
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: annulled.id } })).votesUnlinkedAt, null)

    await voting.castVote(voter.id, open.id, open.options[1]!.id)
    await voting.closeRound(open.id)
    assert.ok((await prisma.round.findUniqueOrThrow({ where: { id: annulled.id } })).votesUnlinkedAt)
    assert.ok((await prisma.round.findUniqueOrThrow({ where: { id: open.id } })).votesUnlinkedAt)
  } finally {
    delete (voting as unknown as Record<string, unknown>).vacuumAnonymousVotes
    await cleanup()
  }
})

test('the mesa cannot register an election while a vote is open, and can once it closes', async () => {
  const { prisma, events, voting, roster, assemblyId, voter, cleanup } = await setup('register-open-vote')
  try {
    const election = await voting.createRound(assemblyId, { title: 'Presidencia', category: 'office', format: 'single_choice', options: [{ label: 'Elías' }, { label: 'Eliseo' }] })
    await voting.openRound(election.id)
    await voting.castVote(voter.id, election.id, election.options[0]!.id)
    await voting.closeRound(election.id)
    const open = await prisma.round.create({ data: {
      assemblyId, title: 'Moción', countingRule: { kind: 'count_only' }, status: 'open', openedAt: new Date(),
      options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] },
    } })
    const audits = await auditCount(prisma, assemblyId)
    events.length = 0

    await assert.rejects(roster.register(election.id), (error: unknown) =>
      error instanceof ConflictException && /votación/.test(error.message))
    assert.equal(events.length, 0)
    assert.equal(await auditCount(prisma, assemblyId), audits)
    assert.equal((await prisma.officialResult.findUniqueOrThrow({ where: { roundId: election.id } })).registeredAt, null)

    await prisma.round.update({ where: { id: open.id }, data: { status: 'annulled', annulledAt: new Date(), votesUnlinkedAt: new Date() } })
    assert.ok((await roster.register(election.id)).registeredAt)
  } finally { await cleanup() }
})
