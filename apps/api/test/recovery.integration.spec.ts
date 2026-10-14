import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from '../src/auth/auth.service.js'
import { hashCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('moderator and delegates can recover from lost devices without enabling a second vote', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const replacedSessions: string[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    if (name === 'participantSessionReplaced') replacedSessions.push(String(args[0]))
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const auth = new AuthService(prisma)
  let assemblyId: string | undefined

  try {
    const created = await service.createAssembly('Recovery test')
    assemblyId = created.assemblyId
    assert.equal((await service.activeAssembly()).assembly?.id, assemblyId, 'a new tab can find the live assembly')

    const rotated = await service.rotateJoinCode(assemblyId)
    assert.ok(rotated.joinUrl.includes(encodeURIComponent(rotated.joinCode)))
    await assert.rejects(service.joinAssembly(created.joinCode, 'Old', 'Code'), NotFoundException)
    const ana = await service.joinAssembly(rotated.joinCode, 'Ana', 'Lopez')
    const anaId = (await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(ana.participantSessionToken) } })).id

    await service.changeLobby(assemblyId, 'lobby_closed')
    await assert.rejects(service.joinAssembly(rotated.joinCode, 'Late', 'Delegate'), ConflictException)
    assert.equal((await service.changeLobby(assemblyId, 'lobby_open')).status, 'lobby_open')
    await service.joinAssembly(rotated.joinCode, 'Late', 'Delegate')
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'lobby.reopened' } }), 1)
    await service.changeLobby(assemblyId, 'lobby_closed')

    const round = await service.createRound(assemblyId, {
      title: 'Recovery ballot', format: 'single_choice', options: [{ label: 'A' }, { label: 'B' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(round.id)
    await assert.rejects(service.changeLobby(assemblyId, 'lobby_open'), ConflictException)
    await service.castVote(anaId, round.id, round.options[0]!.id)

    const issued = await service.issueResumeCode(anaId)
    const resumeCode = new URL(issued.resumeUrl).searchParams.get('resume')!
    const resumed = await service.redeemResumeCode(resumeCode)
    assert.equal(resumed.participationStatus, 'recorded', 'the new device inherits the existing participation')
    assert.deepEqual(replacedSessions, [anaId])
    await assert.rejects(auth.participantForToken(ana.participantSessionToken), UnauthorizedException)
    assert.equal(await auth.participantForToken(resumed.participantSessionToken), anaId)
    await assert.rejects(service.castVote(anaId, round.id, round.options[1]!.id), ConflictException)
    await assert.rejects(service.redeemResumeCode(resumeCode), NotFoundException, 'codes are single-use')

    const expired = new URL((await service.issueResumeCode(anaId)).resumeUrl).searchParams.get('resume')!
    await prisma.participantSession.update({ where: { id: anaId }, data: { resumeExpiresAt: new Date(Date.now() - 1000) } })
    await assert.rejects(service.redeemResumeCode(expired), NotFoundException)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.$disconnect()
  }
})
