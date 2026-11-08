import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import { AuthService } from '../../src/auth/auth.service.js'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

async function setup(label: string, names: string[]) {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const seeded = await seedAssembly(prisma, room, { label, delegates: names })
  const cleanup = async () => {
    await seeded.cleanup()
    await prisma.$disconnect()
  }
  return { prisma, service, auth: new AuthService(prisma), events, assemblyId: seeded.assemblyId, people: seeded.people, cleanup }
}

const twoOptions = { format: 'single_choice' as const, countingRule: { kind: 'count_only' as const }, options: [{ label: 'Opción A' }, { label: 'Opción B' }] }
const codeOf = (url: string) => new URL(url).searchParams.get('resume')!

test('while a vote is open no reconnection code is issued or redeemed, and an earlier code works once the vote closes', async () => {
  const { prisma, service, auth, events, assemblyId, people, cleanup } = await setup('reconnect-open', ['Amós', 'Joel', 'Oseas'])
  try {
    const earlier = codeOf((await service.issueResumeCode(people.Amós!.id)).resumeUrl)
    const round = await service.createRound(assemblyId, { title: 'Presidencia', ...twoOptions })
    await service.openRound(round.id)
    const audits = await prisma.auditEvent.count({ where: { assemblyId } })

    events.length = 0
    await assert.rejects(service.issueResumeCode(people.Joel!.id), ConflictException)
    await assert.rejects(service.redeemResumeCode(earlier), ConflictException)
    assert.equal(events.length, 0)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId } }), audits)
    const joel = await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Joel!.id } })
    assert.equal(joel.resumeCodeHash, null)
    const amos = await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Amós!.id } })
    assert.equal(amos.resumeCodeHash, hashCredential(earlier), 'the refused code stays unused')

    assert.equal(await auth.participantForToken(people.Amós!.token), people.Amós!.id, 'the phone keeps its own session')
    assert.equal(await auth.participantForToken(people.Oseas!.token), people.Oseas!.id)
    await service.castVote(people.Amós!.id, round.id, round.options[0]!.id)
    await service.closeRound(round.id)

    const resumed = await service.redeemResumeCode(earlier)
    assert.equal(await auth.participantForToken(resumed.participantSessionToken), people.Amós!.id)
    assert.ok(await service.issueResumeCode(people.Joel!.id))
  } finally { await cleanup() }
})

test('annulling the open vote lets the mesa reconnect a device right away', async () => {
  const { service, auth, assemblyId, people, cleanup } = await setup('reconnect-annul', ['Abdías', 'Miqueas'])
  try {
    const earlier = codeOf((await service.issueResumeCode(people.Abdías!.id)).resumeUrl)
    const round = await service.createRound(assemblyId, { title: 'Secretaría', ...twoOptions })
    await service.openRound(round.id)
    await assert.rejects(service.issueResumeCode(people.Miqueas!.id), ConflictException)

    await service.annulRound(round.id, 'Un delegado perdió su teléfono')
    const resumed = await service.redeemResumeCode(earlier)
    assert.equal(await auth.participantForToken(resumed.participantSessionToken), people.Abdías!.id)
    const fresh = codeOf((await service.issueResumeCode(people.Miqueas!.id)).resumeUrl)
    const moved = await service.redeemResumeCode(fresh)
    assert.equal(await auth.participantForToken(moved.participantSessionToken), people.Miqueas!.id)
  } finally { await cleanup() }
})

test('the regional secretary gets no reconnection code', async () => {
  const { prisma, service, assemblyId, cleanup } = await setup('reconnect-secretary', ['Hageo'])
  try {
    const secretary = await prisma.participantSession.create({
      data: { assemblyId, firstName: 'Débora', lastName: 'Secretaria', isRegionalSecretary: true, tokenHash: hashCredential(newOpaqueCredential()) },
    })
    await assert.rejects(service.issueResumeCode(secretary.id), ConflictException)
    const stored = await prisma.participantSession.findUniqueOrThrow({ where: { id: secretary.id } })
    assert.equal(stored.resumeCodeHash, null)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.resume_code_issued' } }), 0)
  } finally { await cleanup() }
})
