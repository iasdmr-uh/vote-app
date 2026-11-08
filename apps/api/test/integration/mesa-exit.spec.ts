import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { MODERATOR_ACTOR } from '../../src/auth/actors.js'
import { AuthService } from '../../src/auth/auth.service.js'
import { ParticipantLeaveController } from '../../src/voting/voting.controller.js'
import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import type { PrismaService } from '../../src/prisma/prisma.service.js'
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
  return { prisma, service, room, auth: new AuthService(prisma), events, joinCode: seeded.joinCode, assemblyId: seeded.assemblyId, people: seeded.people, cleanup }
}

const twoOptions = { format: 'single_choice' as const, countingRule: { kind: 'count_only' as const }, options: [{ label: 'Opción A' }, { label: 'Opción B' }] }

test('a delegate cannot leave on their own', async () => {
  const { prisma, service, assemblyId, people, cleanup } = await setup('self-leave', ['Elías'])
  try {
    const controller = new ParticipantLeaveController(service)
    assert.throws(() => controller.leave(), ForbiddenException)
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: people['Elías']!.id } })).status, 'active')
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: { in: ['participant.left', 'participant.taken_out'] } } }), 0)
  } finally { await cleanup() }
})

test('the mesa takes someone out between votes: the closed vote keeps them in its base and the next one drops them', async () => {
  const { prisma, service, room, auth, events, joinCode, assemblyId, people, cleanup } = await setup('take-out', ['Eliseo', 'Isaías', 'Jeremías'])
  try {
    const first = await service.createRound(assemblyId, { title: 'Primera', ...twoOptions })
    await service.openRound(first.id)
    await service.castVote(people.Eliseo!.id, first.id, first.options[0]!.id)
    await assert.rejects(room.takeOutOfRoom(people.Isaías!.id), ConflictException, 'no take-out while a vote is open (#55)')
    await service.castVote(people.Jeremías!.id, first.id, first.options[1]!.id)
    await service.closeRound(first.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: first.id } })).eligibleCount, 3)

    events.length = 0
    assert.deepEqual(await room.takeOutOfRoom(people.Isaías!.id), { id: people.Isaías!.id, firstName: 'Isaías', lastName: 'Delegado', status: 'left' })
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Isaías!.id } })).status, 'left')
    assert.deepEqual(events.find((event) => event.name === 'participantLeft')?.payload, { participantId: people.Isaías!.id, firstName: 'Isaías', lastName: 'Delegado' })
    assert.deepEqual(events.find((event) => event.name === 'lobbyState')?.payload, { status: 'closed', participantCount: 2 })
    assert.equal(JSON.stringify(events).includes(people.Isaías!.token), false, 'no token in broadcasts')

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { assemblyId, action: 'participant.taken_out' } })
    assert.equal(audit.actorRef, MODERATOR_ACTOR)
    assert.deepEqual(audit.metadata, { participantId: people.Isaías!.id, personName: 'Isaías Delegado' })

    await assert.rejects(auth.participantForToken(people.Isaías!.token), UnauthorizedException)
    await assert.rejects(service.participantState(people.Isaías!.id), NotFoundException)

    events.length = 0
    await room.takeOutOfRoom(people.Isaías!.id)
    assert.equal(events.length, 0)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.taken_out' } }), 1)

    let mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.participants.map((person) => person.firstName), ['Eliseo', 'Jeremías'])
    assert.deepEqual(mesa.leftParticipants.map((person) => person.firstName), ['Isaías'])
    assert.equal(mesa.rounds[0]!.eligibleCount, 3, 'the closed vote keeps Isaías in its base')

    const second = await service.createRound(assemblyId, { title: 'Segunda', ...twoOptions })
    mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.rounds.find((round) => round.id === second.id)?.eligibleCount, 2, 'a draft uses the new roster')
    await service.openRound(second.id)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 2)
    await assert.rejects(service.castVote(people.Isaías!.id, second.id, second.options[0]!.id))

    events.length = 0
    await assert.rejects(room.returnToRoom(people.Isaías!.id), ConflictException, 'no return while a vote is open')
    assert.equal(events.length, 0)
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Isaías!.id } })).status, 'left')
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.returned' } }), 0)
    await service.closeRound(second.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: second.id } })).eligibleCount, 2)

    events.length = 0
    const returned = await room.returnToRoom(people.Isaías!.id)
    assert.deepEqual(returned, { id: people.Isaías!.id, firstName: 'Isaías', lastName: 'Delegado', status: 'active' })
    assert.deepEqual(events.find((event) => event.name === 'lobbyState')?.payload, { status: 'closed', participantCount: 3 })
    assert.equal(events.some((event) => event.name === 'participantJoined'), true)
    assert.equal(JSON.stringify(events).includes(people.Isaías!.token), false)
    const back = await prisma.participantSession.findUniqueOrThrow({ where: { id: people.Isaías!.id } })
    assert.equal(back.status, 'active')
    await assert.rejects(auth.participantForToken(people.Isaías!.token), UnauthorizedException, 'the old device stays revoked')
    const returnAudit = await prisma.auditEvent.findFirstOrThrow({ where: { assemblyId, action: 'participant.returned' } })
    assert.deepEqual(returnAudit.metadata, { participantId: people.Isaías!.id, personName: 'Isaías Delegado' })

    mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.participants.map((person) => person.firstName), ['Eliseo', 'Isaías', 'Jeremías'])
    assert.deepEqual(mesa.leftParticipants, [])
    assert.equal(mesa.rounds.find((round) => round.id === second.id)?.eligibleCount, 2, 'returning does not change a closed vote')
    const resume = await service.issueResumeCode(people.Isaías!.id)
    assert.match(resume.resumeUrl, /resume=/)

    const third = await service.createRound(assemblyId, { title: 'Tercera', ...twoOptions })
    await service.openRound(third.id)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 3, 'counted again from the next vote')
    await service.closeRound(third.id)

    await assert.rejects(room.returnToRoom(people.Isaías!.id), NotFoundException)
    await assert.rejects(room.takeOutOfRoom(randomUUID()), NotFoundException)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.returned' } }), 1)

    await service.completeAssembly(assemblyId, true)
    await assert.rejects(room.takeOutOfRoom(people.Eliseo!.id), ConflictException)
  } finally { await cleanup() }
})

test('in an election, someone taken out after a vote stops counting from the next vote even if they voted, and one who returns counts again', async () => {
  const { prisma, service, room, joinCode, assemblyId, people, cleanup } = await setup('election-exit', ['Oseas', 'Joel', 'Amós'])
  try {
    const round = await service.createRound(assemblyId, { title: 'Presidencia', ...twoOptions })
    await service.openRound(round.id)
    await service.castVote(people.Oseas!.id, round.id, round.options[0]!.id)
    await service.castVote(people.Amós!.id, round.id, round.options[1]!.id)
    await service.closeRound(round.id)
    await room.takeOutOfRoom(people.Oseas!.id)
    await room.takeOutOfRoom(people.Joel!.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).eligibleCount, 3)

    const runoff = await prisma.round.findFirstOrThrow({ where: { committeeRootRoundId: round.id, status: 'draft' } })
    assert.equal((await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === runoff.id)?.eligibleCount, 1, 'only Amós is in the room')
    await service.openRound(runoff.id)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 1)

    await assert.rejects(room.returnToRoom(people.Joel!.id), ConflictException, 'Joel is not in the open vote base, so he cannot come back and vote in it')
    await service.closeRound(runoff.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: runoff.id } })).eligibleCount, 1)
    await room.returnToRoom(people.Oseas!.id)
    await room.returnToRoom(people.Joel!.id)

    const next = await service.createRound(assemblyId, { title: 'Otra', ...twoOptions })
    await service.openRound(next.id)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 3)
  } finally { await cleanup() }
})

test('the regional secretary is taken out by the mesa and never returned through the participant list', async () => {
  const { prisma, service, room, assemblyId, cleanup } = await setup('secretary-exit', ['Miqueas'])
  try {
    const secretary = await prisma.participantSession.create({
      data: { assemblyId, firstName: 'Débora', lastName: 'Secretaria', isRegionalSecretary: true, tokenHash: hashCredential(newOpaqueCredential()) },
    })
    assert.deepEqual(await room.takeOutOfRoom(secretary.id), { id: secretary.id, firstName: 'Débora', lastName: 'Secretaria', status: 'left' })
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: secretary.id } })).status, 'left')
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'participant.taken_out' } }), 1)
    await assert.rejects(room.returnToRoom(secretary.id), ConflictException)
    assert.equal((await prisma.participantSession.findUniqueOrThrow({ where: { id: secretary.id } })).status, 'left')
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 1, accredited: 1, quorum: 1 })
  } finally { await cleanup() }
})

async function addSecretary(prisma: PrismaService, assemblyId: string) {
  return prisma.participantSession.create({
    data: { assemblyId, firstName: 'Débora', lastName: 'Secretaria', isRegionalSecretary: true, tokenHash: hashCredential(newOpaqueCredential()) },
  })
}

test('the room numbers follow joins, take-outs and returns', async () => {
  const { service, room, assemblyId, people, cleanup } = await setup('room-numbers', ['Abdías', 'Nahúm', 'Sofonías', 'Hageo'])
  try {
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 4, accredited: 4, quorum: 3 })
    await room.takeOutOfRoom(people.Nahúm!.id)
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 3, accredited: 4, quorum: 3 })
    await room.takeOutOfRoom(people.Hageo!.id)
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 2, accredited: 4, quorum: 3 })
    await room.returnToRoom(people.Nahúm!.id)
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 3, accredited: 4, quorum: 3 })
  } finally { await cleanup() }
})

test('a participant removed before voting is not accredited and the regional secretary is excluded', async () => {
  const { prisma, service, assemblyId, people, cleanup } = await setup('room-excluded', ['Habacuc', 'Malaquías', 'Zacarías'])
  try {
    await addSecretary(prisma, assemblyId)
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 3, accredited: 3, quorum: 2 })
    await prisma.participantSession.update({ where: { id: people.Zacarías!.id }, data: { status: 'removed' } })
    assert.deepEqual((await service.moderatorAssembly(assemblyId)).room, { present: 2, accredited: 2, quorum: 2 })
  } finally { await cleanup() }
})

test('the quorum is two thirds of the accredited, rounded up', async () => {
  const empty = await setup('room-empty', [])
  try {
    assert.deepEqual((await empty.service.moderatorAssembly(empty.assemblyId)).room, { present: 0, accredited: 0, quorum: 0 })
  } finally { await empty.cleanup() }

  const forty5 = await setup('room-45', Array.from({ length: 45 }, (_, index) => `Profeta ${index}`))
  try {
    assert.deepEqual((await forty5.service.moderatorAssembly(forty5.assemblyId)).room, { present: 45, accredited: 45, quorum: 30 })
  } finally { await forty5.cleanup() }

  const four = await setup('room-4', ['Esdras', 'Nehemías', 'Ezequiel', 'Daniel'])
  try {
    assert.deepEqual((await four.service.moderatorAssembly(four.assemblyId)).room, { present: 4, accredited: 4, quorum: 3 })
  } finally { await four.cleanup() }
})

test('while a vote is open the mesa cannot disable, re-enable or take out anyone, and can again once it closes', async () => {
  const { prisma, service, room, events, joinCode, assemblyId, people, cleanup } = await setup('open-vote-guards', ['Abdías', 'Jonás', 'Nahúm', 'Sofonías'])
  try {
    const secretary = await addSecretary(prisma, assemblyId)
    await room.setVotingDisabled(people.Sofonías!.id, true)
    await room.takeOutOfRoom(people.Nahúm!.id)
    const round = await service.createRound(assemblyId, { title: 'Presidencia', ...twoOptions })
    await service.openRound(round.id)
    const audits = await prisma.auditEvent.count({ where: { assemblyId } })

    events.length = 0
    await assert.rejects(room.setVotingDisabled(people.Abdías!.id, true), ConflictException)
    await assert.rejects(room.setVotingDisabled(people.Sofonías!.id, false), ConflictException)
    await assert.rejects(room.setVotingDisabled(people.Sofonías!.id, true), ConflictException)
    await assert.rejects(room.setVotingDisabled(people.Abdías!.id, false), ConflictException)
    await assert.rejects(room.takeOutOfRoom(people.Jonás!.id), ConflictException)
    await assert.rejects(room.takeOutOfRoom(people.Nahúm!.id), ConflictException)
    await assert.rejects(room.takeOutOfRoom(secretary.id), ConflictException)
    await assert.rejects(room.patchParticipant(people.Jonás!.id, { status: 'removed' }), ConflictException)
    assert.equal(events.length, 0)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId } }), audits)

    const rows = await prisma.participantSession.findMany({ where: { assemblyId }, orderBy: { firstName: 'asc' }, select: { firstName: true, status: true, votingDisabled: true } })
    assert.deepEqual(rows.map((row) => [row.firstName, row.status, row.votingDisabled]), [
      ['Abdías', 'active', false], ['Débora', 'active', false], ['Jonás', 'active', false], ['Nahúm', 'left', false], ['Sofonías', 'active', true],
    ])
    assert.deepEqual((await service.participantState(people.Sofonías!.id)).openRound?.options, [], 'a disabled delegate stays out of the open vote')
    await assert.rejects(service.castVote(people.Sofonías!.id, round.id, round.options[0]!.id), ForbiddenException)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 3)

    await service.closeRound(round.id)
    await room.setVotingDisabled(people.Sofonías!.id, false)
    await room.setVotingDisabled(people.Abdías!.id, true)
    await room.takeOutOfRoom(people.Jonás!.id)
    await room.takeOutOfRoom(secretary.id)
    const after = await prisma.participantSession.findMany({ where: { assemblyId }, orderBy: { firstName: 'asc' }, select: { firstName: true, status: true, votingDisabled: true } })
    assert.deepEqual(after.map((row) => [row.firstName, row.status, row.votingDisabled]), [
      ['Abdías', 'active', true], ['Débora', 'left', false], ['Jonás', 'left', false], ['Nahúm', 'left', false], ['Sofonías', 'active', false],
    ])
  } finally { await cleanup() }
})
