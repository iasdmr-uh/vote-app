import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { ConflictException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { lockAssembly } from '../../src/voting/assembly-tx.js'
import { trackAutoClose } from '../support/auto-close.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { removeOrganization, seedAssembly } from '../support/seed.js'
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

test('the mesa cannot prepare anything while a vote is open, and can once it ends', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting, room } = buildProviders(prisma, gateway)
  const settled = trackAutoClose(voting)
  const seeded = await seedAssembly(prisma, room, { label: 'prepare-open-vote', delegates: ['Amós', 'Joel'] })
  const { assemblyId, people } = seeded
  const refused = (error: unknown) => error instanceof ConflictException && /votación abierta/.test(error.message)
  try {
    const annulled = await voting.createRound(assemblyId, { title: 'Secretaría', category: 'office', format: 'single_choice', options: [{ label: 'Daniel' }, { label: 'Esdras' }] })
    await voting.openRound(annulled.id)
    await voting.annulRound(annulled.id, 'Papeleta con un error')

    const first = await voting.createRound(assemblyId, { title: 'Presidencia', category: 'office', format: 'single_choice', options: [{ label: 'Elías' }, { label: 'Eliseo' }] })
    let current: { id: string; options: Array<{ id: string; label: string }> } = first
    for (let vote = 1; vote <= 3; vote += 1) {
      await voting.openRound(current.id)
      await voting.castVote(people.Amós!.id, current.id, current.options.find((option) => option.label === 'Elías')!.id)
      await voting.castVote(people.Joel!.id, current.id, current.options.find((option) => option.label === 'Eliseo')!.id)
      await voting.closeRound(current.id)
      await settled()
      const next = (await voting.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === current.id && round.status === 'draft')
      assert.ok(next, `the tie in vote ${vote} prepares the next one`)
      current = next
    }
    const fourth = current
    const added = (await voting.addCandidate(fourth.id, 'Nahúm')).option

    const open = await prisma.round.create({ data: {
      assemblyId, title: 'Moción', countingRule: { kind: 'count_only' }, status: 'open', openedAt: new Date(),
      options: { create: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] },
    } })
    const snapshot = async () => ({
      rounds: await prisma.round.count({ where: { assemblyId } }),
      positions: await prisma.position.count({ where: { assemblyId } }),
      options: await prisma.ballotOption.findMany({ where: { roundId: fourth.id }, select: { label: true }, orderBy: { order: 'asc' } }),
      secretaryVotes: (await prisma.round.findUniqueOrThrow({ where: { id: fourth.id } })).regionalSecretaryVotes,
      secretaries: await prisma.participantSession.count({ where: { assemblyId, isRegionalSecretary: true } }),
      audits: await prisma.auditEvent.count({ where: { assemblyId } }),
    })
    const before = await snapshot()
    events.length = 0

    await assert.rejects(voting.createRound(assemblyId, { title: 'Tesorería', category: 'office', format: 'single_choice', options: [{ label: 'Hageo' }] }), refused)
    await assert.rejects(voting.addPosition(assemblyId, 'Mayordomía'), refused)
    await assert.rejects(voting.repeatRound(annulled.id, { optionIds: annulled.options.map((option) => option.id) }), refused)
    await assert.rejects(voting.addCandidate(fourth.id, 'Abdías'), refused)
    await assert.rejects(voting.removeCandidate(fourth.id, added.id), refused)
    await assert.rejects(voting.addRegionalSecretary(fourth.id, { firstName: 'Débora', lastName: 'Regional' }), refused)
    await assert.rejects(voting.removeRegionalSecretary(fourth.id), refused)
    assert.deepEqual(await snapshot(), before)
    assert.equal(events.length, 0)

    await prisma.round.update({ where: { id: open.id }, data: { status: 'annulled', annulledAt: new Date(), votesUnlinkedAt: new Date() } })
    await voting.addCandidate(fourth.id, 'Abdías')
    await voting.removeCandidate(fourth.id, added.id)
    await voting.addRegionalSecretary(fourth.id, { firstName: 'Débora', lastName: 'Regional' })
    await voting.removeRegionalSecretary(fourth.id)
    await voting.addPosition(assemblyId, 'Mayordomía')
    await voting.createRound(assemblyId, { title: 'Tesorería', category: 'office', format: 'single_choice', options: [{ label: 'Hageo' }] })
    await voting.repeatRound(annulled.id, { optionIds: annulled.options.map((option) => option.id) })
  } finally {
    await seeded.cleanup()
    await prisma.$disconnect()
  }
})

test('a vote opened while the secrecy cleanup runs waits until the cleanup ends', async () => {
  const { prisma, voting, assemblyId, voter, ballot, cleanup } = await setup('cleanup-race-open')
  try {
    const annulled = await ballot('Presidencia')
    await voting.openRound(annulled.id)
    await voting.castVote(voter.id, annulled.id, annulled.options[0]!.id)
    Object.assign(voting, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })
    await voting.annulRound(annulled.id, 'Falla de prueba')

    const next = await ballot('Presidencia, de nuevo')
    let opening: Promise<unknown> | undefined
    let openDuringVacuum = 0
    Object.assign(voting, { vacuumAnonymousVotes: async () => {
      Object.assign(voting, { vacuumAnonymousVotes: async () => {} })
      opening = voting.openRound(next.id)
      await sleep(300)
      openDuringVacuum = await prisma.round.count({ where: { assemblyId, status: 'open' } })
    } })

    assert.deepEqual(await voting.retrySecrecyCleanup(assemblyId), { assemblyId, secrecyCleanupPending: false })
    await opening
    assert.equal(openDuringVacuum, 0, 'the vote opens only after VACUUM FULL ends')
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: next.id } })).status, 'open')
  } finally {
    delete (voting as unknown as Record<string, unknown>).vacuumAnonymousVotes
    await cleanup()
  }
})

test('actions queued behind an opening vote are refused once it opens', async () => {
  const { prisma, voting, assemblyId, voter, ballot, cleanup } = await setup('queued-behind-open')
  const refused = (error: unknown) => error instanceof ConflictException && /votación abierta/.test(error.message)
  try {
    const annulled = await ballot('Presidencia')
    await voting.openRound(annulled.id)
    await voting.castVote(voter.id, annulled.id, annulled.options[0]!.id)
    Object.assign(voting, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })
    await voting.annulRound(annulled.id, 'Falla de prueba')
    let vacuums = 0
    Object.assign(voting, { vacuumAnonymousVotes: async () => { vacuums += 1 } })

    const next = await ballot('Presidencia, de nuevo')
    let locked!: () => void
    let release!: () => void
    const lockTaken = new Promise<void>((resolve) => { locked = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const holder = prisma.$transaction(async (tx) => {
      await lockAssembly(tx, assemblyId)
      locked()
      await gate
    }, { timeout: 10_000 })
    await lockTaken

    const opening = voting.openRound(next.id)
    await sleep(150)
    const preparing = voting.createRound(assemblyId, { title: 'Tesorería', category: 'office', format: 'single_choice', options: [{ label: 'Hageo' }] })
    const retrying = voting.retrySecrecyCleanup(assemblyId)
    await sleep(150)
    release()
    await holder

    const [opened, prepared, retried] = await Promise.allSettled([opening, preparing, retrying])
    assert.equal(opened.status, 'fulfilled')
    assert.ok(prepared.status === 'rejected' && refused(prepared.reason), 'no draft is created behind the opening vote')
    assert.ok(retried.status === 'rejected' && refused(retried.reason), 'no cleanup runs behind the opening vote')
    assert.equal(vacuums, 0)
    assert.equal(await prisma.round.count({ where: { assemblyId, title: 'Tesorería' } }), 0)
  } finally {
    delete (voting as unknown as Record<string, unknown>).vacuumAnonymousVotes
    await cleanup()
  }
})
