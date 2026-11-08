import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('inhabilitar during an open vote rejects the vote, keeps the base and a vote already cast, and habilitar restores it', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const events: Array<{ name: string; target: unknown; payload: unknown }> = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    events.push({ name, target: args[0], payload: args[1] })
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `disable-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Disable test', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: Record<string, { id: string; token: string }> = {}
    for (const name of ['Ana', 'Luis', 'Marta', 'Pedro']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      const session = await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })
      people[name] = { id: session.id, token: joined.participantSessionToken }
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'Opción A' }, { label: 'Opción B' }],
    })
    await service.openRound(round.id)
    await service.castVote(people.Ana!.id, round.id, round.options[0]!.id)

    // Ana already voted: inhabilitarla keeps that vote.
    events.length = 0
    assert.deepEqual(await service.setVotingDisabled(people.Ana!.id, true), { id: people.Ana!.id, firstName: 'Ana', lastName: 'Delegado', status: 'active', votingDisabled: true })
    assert.deepEqual(events.find((event) => event.name === 'participantVoting')?.payload, { participantId: people.Ana!.id, votingDisabled: true })
    const anaPhoneEvent = events.find((event) => event.name === 'participantState')
    assert.equal(anaPhoneEvent?.target, people.Ana!.id)
    assert.equal((anaPhoneEvent?.payload as { votingDisabled: boolean }).votingDisabled, true)

    // Luis has not voted: once inhabilitado his phone gets no ballot and the server rejects his vote.
    await service.setVotingDisabled(people.Luis!.id, true)
    const luisPhone = await service.participantState(people.Luis!.id)
    assert.equal(luisPhone.votingDisabled, true)
    assert.equal(luisPhone.openRound?.status, 'open')
    assert.deepEqual(luisPhone.openRound?.options, [])
    await assert.rejects(service.castVote(people.Luis!.id, round.id, round.options[1]!.id), ForbiddenException)
    assert.equal(await prisma.participation.count({ where: { roundId: round.id, participantSessionId: people.Luis!.id } }), 0)
    assert.equal((await service.participantState(people.Marta!.id)).openRound?.options.length, 2, 'others still get the ballot')

    // Repeating it changes nothing and records nothing twice.
    events.length = 0
    await service.setVotingDisabled(people.Luis!.id, true)
    assert.equal(events.length, 0)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.voting_disabled' } }), 2)

    // Still in the room, the list and the base.
    let mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.participantCount, 4)
    assert.deepEqual(mesa.participants.map((person) => [person.firstName, person.votingDisabled, person.voted]), [
      ['Ana', true, true], ['Luis', true, false], ['Marta', false, false], ['Pedro', false, false],
    ])
    assert.equal(mesa.attendanceRound?.eligibleCount, 4)
    assert.equal(mesa.rounds[0]!.participationCount, 1, 'Ana\'s vote is kept')
    assert.equal((await service.publicState(joinCode)).eligibleCount, 4)

    // Habilitar: Luis can vote again.
    events.length = 0
    await service.setVotingDisabled(people.Luis!.id, false)
    assert.deepEqual(events.find((event) => event.name === 'participantVoting')?.payload, { participantId: people.Luis!.id, votingDisabled: false })
    assert.equal((await service.participantState(people.Luis!.id)).openRound?.options.length, 2)
    await service.castVote(people.Luis!.id, round.id, round.options[1]!.id)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.voting_enabled' } }), 1)

    await service.takeOutOfRoom(people.Pedro!.id)
    await assert.rejects(service.setVotingDisabled(people.Pedro!.id, true), NotFoundException)
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Pedro!.id } })).status, 'left')

    // An unknown session cannot be inhabilitada.
    await assert.rejects(service.setVotingDisabled(randomUUID(), true), NotFoundException)

    // The inhabilitados stay in the base frozen at close.
    await service.closeRound(round.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).eligibleCount, 4)

    await service.completeAssembly(assemblyId, true)
    await assert.rejects(service.setVotingDisabled(people.Marta!.id, true), ConflictException)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})
