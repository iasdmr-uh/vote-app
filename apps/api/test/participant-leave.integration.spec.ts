import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from '../src/auth/auth.service.js'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('leaving ends the session once, and the percentage base keeps those who voted before leaving', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const events: Array<{ name: string; payload: unknown }> = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    events.push({ name, payload: args[1] })
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const auth = new AuthService(prisma)
  const organizationId = randomUUID()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `leave-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Leave test', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: Record<string, { id: string; token: string }> = {}
    for (const name of ['Ana', 'Luis', 'Marta', 'Pedro']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      const session = await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })
      people[name] = { id: session.id, token: joined.participantSessionToken }
    }
    // Expelled by the mesa before voting: never part of any base.
    await service.patchParticipant(people.Pedro!.id, { status: 'removed' })
    await service.changeLobby(assemblyId, 'lobby_closed')

    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'Opción A' }, { label: 'Opción B' }],
    })
    await service.openRound(round.id)
    await service.castVote(people.Ana!.id, round.id, round.options[0]!.id)

    events.length = 0
    assert.deepEqual(await service.leaveAssembly(people.Ana!.id), { left: true })
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Ana!.id } })).status, 'left')
    assert.deepEqual(events.find((event) => event.name === 'participantLeft')?.payload, { participantId: people.Ana!.id, firstName: 'Ana', lastName: 'Delegado' })
    assert.deepEqual(events.find((event) => event.name === 'lobbyState')?.payload, { status: 'closed', participantCount: 2 })
    assert.deepEqual(events.find((event) => event.name === 'participationCount')?.payload, { roundId: round.id, recorded: 1, eligible: 3 })

    // Idempotent: the ended session still resolves for leaving, and nothing is recorded or announced twice.
    events.length = 0
    assert.equal((await auth.participantSessionForToken(people.Ana!.token)).id, people.Ana!.id)
    assert.deepEqual(await service.leaveAssembly(people.Ana!.id), { left: true })
    assert.deepEqual(events, [])
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.left' } }), 1)

    // The session is invalidated for everything else.
    await assert.rejects(auth.participantForToken(people.Ana!.token), UnauthorizedException)
    await assert.rejects(service.participantState(people.Ana!.id), NotFoundException)

    let publicState = await service.publicState(joinCode)
    assert.equal(publicState.participantCount, 2, 'people in the room')
    assert.equal(publicState.recordedCount, 1)
    assert.equal(publicState.eligibleCount, 3, 'Ana voted and left: she still counts')

    await service.leaveAssembly(people.Luis!.id)
    publicState = await service.publicState(joinCode)
    assert.equal(publicState.participantCount, 1)
    assert.equal(publicState.eligibleCount, 2, 'Luis left without voting: he no longer counts')

    await service.castVote(people.Marta!.id, round.id, round.options[1]!.id)
    await service.closeRound(round.id)
    await service.publishRound(round.id)
    const mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.participants.map((person) => person.firstName), ['Marta'])
    assert.equal(mesa.participantCount, 1)
    assert.deepEqual(mesa.leftParticipants.map((person) => person.firstName), ['Ana', 'Luis'])
    assert.equal(mesa.rounds[0]!.eligibleCount, 2)
    assert.equal(mesa.rounds[0]!.participationCount, 2)
    assert.equal(mesa.attendanceRound?.eligibleCount, 2)

    const phone = await service.participantState(people.Marta!.id)
    assert.equal(phone.recordedCount, 2)
    assert.equal(phone.eligibleCount, 2)

    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).eligibleCount, 2, 'frozen when closed')

    // Someone joining after the lobby reopens does not change the base of a ballot that already closed.
    await service.changeLobby(assemblyId, 'lobby_open')
    await service.joinAssembly(joinCode, 'Rosa', 'Delegada')
    await service.changeLobby(assemblyId, 'lobby_closed')
    publicState = await service.publicState(joinCode)
    assert.equal(publicState.participantCount, 2)
    assert.equal(publicState.eligibleCount, 2, 'the published ballot keeps its frozen base')
    const afterArrival = await service.moderatorAssembly(assemblyId)
    assert.equal(afterArrival.rounds[0]!.eligibleCount, 2)
    assert.equal((await service.participantState(people.Marta!.id)).eligibleCount, 2)

    // A repetition belongs to the same chain, so whoever voted in the original keeps counting, and its
    // base stays live until it closes: Marta and Rosa in the room plus Ana.
    const repeated = await service.repeatRound(round.id, { optionIds: round.options.map((option) => option.id) })
    const afterRepeat = await service.moderatorAssembly(assemblyId)
    assert.equal(afterRepeat.rounds.find((item) => item.id === repeated.id)?.eligibleCount, 3)
    await service.openRound(repeated.id)
    await service.leaveAssembly(people.Marta!.id)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 3, 'live while open: Marta left, but she voted in the original')
    await service.closeRound(repeated.id)
    const rosa = await prisma.participantSession.findFirstOrThrow({ where: { assemblyId, firstName: 'Rosa' } })
    await service.leaveAssembly(rosa.id)
    const final = await service.moderatorAssembly(assemblyId)
    assert.equal(final.rounds.find((item) => item.id === repeated.id)?.eligibleCount, 3, 'frozen at close: Rosa leaving afterwards changes nothing')
    assert.equal(final.rounds[0]!.eligibleCount, 2)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})
