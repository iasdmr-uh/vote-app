import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { RealtimeAuthService } from '../../src/auth/auth.service.js'
import { OperatorLogService } from '../../src/voting/operator-log.service.js'
import { RoomService } from '../../src/voting/room.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub, type GatewayEvent } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

type Context = { service: VotingService; room: RoomService; assemblyId: string; joinCode: string; people: string[]; auth: RealtimeAuthService; events: GatewayEvent[]; log: OperatorLogService }
type Ballot = Array<{ id: string; label: string }>
type Vote = { id: string; options: Ballot }

const REGIONAL_SECRETARY = { firstName: 'Marta', lastName: 'Regional' }

async function withAssembly(name: string, count: number, body: (context: Context) => Promise<void>) {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room, operatorLog } = buildProviders(prisma, gateway)
  const auth = new RealtimeAuthService(prisma)
  const names = Array.from({ length: count }, (_, index) => `Delegado ${index + 1}`)
  const { assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, room, { label: name, delegates: names })
  try {
    await body({ service, room, assemblyId, joinCode, people: names.map((person) => people[person]!.id), auth, events, log: operatorLog })
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

const optionId = (vote: Vote, label: string) => vote.options.find((option) => option.label === label)!.id

async function roundOnMesa(service: VotingService, assemblyId: string, roundId: string) {
  return (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.id === roundId)!
}

async function voteAndClose(service: VotingService, vote: Vote, people: string[], labels: string[]) {
  await service.openRound(vote.id)
  for (const [index, person] of people.entries()) await service.castVote(person, vote.id, optionId(vote, labels[index % labels.length]!))
  await service.closeRound(vote.id)
}

async function tiedVotes(service: VotingService, assemblyId: string, first: Vote, people: string[], times: number) {
  let vote = first
  for (let count = 0; count < times; count += 1) {
    await voteAndClose(service, vote, people, ['Ana', 'Luis'])
    vote = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === vote.id)!
  }
  return vote
}

const election = (service: VotingService, assemblyId: string, title = 'Presidencia') =>
  service.createRound(assemblyId, { title, category: 'office', format: 'single_choice', options: ['Ana', 'Luis'].map((label) => ({ label })) })

function resumeCodeOf(resumeUrl: string) {
  return new URL(resumeUrl).searchParams.get('resume')!
}

const conflict = (message: RegExp) => (error: unknown) => error instanceof ConflictException && message.test(error.message)

test('the regional secretary breaks a tie in the 4th vote as one more secret voter', async () => {
  await withAssembly('secretary-breaks-tie', 10, async ({ service, assemblyId, joinCode, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const invitation = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    assert.equal(invitation.name, 'Marta Regional')

    const redeemed = await service.redeemResumeCode(resumeCodeOf(invitation.resumeUrl))
    assert.ok(redeemed.participantSessionToken)

    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.participantCount, 10)
    assert.equal(mesa.participants.length, 10)
    assert.equal(mesa.regionalSecretary?.id, invitation.participantId)
    const draft = mesa.rounds.find((round) => round.id === fourth.id)!
    assert.equal(draft.regionalSecretaryVotes, true)
    assert.equal(draft.eligibleCount, 11)

    await service.openRound(fourth.id)
    const phone = await service.participantState(invitation.participantId)
    assert.equal(phone.openRound?.options.length, 2)
    assert.equal(phone.votingDisabled, false)

    for (const [index, person] of people.entries()) await service.castVote(person, fourth.id, optionId(fourth, index % 2 ? 'Luis' : 'Ana'))
    await service.castVote(invitation.participantId, fourth.id, optionId(fourth, 'Ana'))
    await service.closeRound(fourth.id)

    const screen = await service.publicState(joinCode)
    assert.equal(screen.eligibleCount, 11)
    assert.equal(screen.recordedCount, 11)
    assert.equal(screen.participantCount, 10)
    assert.equal(screen.round?.regionalSecretaryVotes, true)
    assert.deepEqual(screen.officialResult?.elected.map((person) => person.label), ['Ana'])
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 11)
  })
})

test('the log names the regional secretary added to a vote', async () => {
  await withAssembly('secretary-in-log', 4, async ({ service, assemblyId, people, log }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    const { csv } = await log.download(assemblyId, 'review')
    assert.match(csv, /"Marta Regional agregado como secretario regional: /)
  })
})

test('the log keeps the vote title of a regional secretary entry after its runoff is discarded', async () => {
  await withAssembly('secretary-runoff-discarded', 4, async ({ service, assemblyId, people, log }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    const third = (await service.moderatorAssembly(assemblyId)).rounds.filter((round) => round.status !== 'draft').at(-1)!
    await service.annulRound(third.id, 'Error de conteo')
    const { csv } = await log.download(assemblyId, 'review')
    assert.match(csv, /"Marta Regional agregado como secretario regional: Presidencia"/)
  })
})

test('the regional secretary cannot join before the 4th vote', async () => {
  await withAssembly('secretary-too-early', 4, async ({ service, assemblyId, people }) => {
    const first = await election(service, assemblyId)
    await assert.rejects(service.addRegionalSecretary(first.id, REGIONAL_SECRETARY), conflict(/4\.ª votación/))
    const third = await tiedVotes(service, assemblyId, first, people, 2)
    await assert.rejects(service.addRegionalSecretary(third.id, REGIONAL_SECRETARY), conflict(/4\.ª votación/))
  })
})

test('the regional secretary cannot join when the previous vote did not tie', async () => {
  await withAssembly('secretary-no-tie', 10, async ({ service, assemblyId, people }) => {
    const third = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 2)
    await voteAndClose(service, third, people.slice(0, 9), ['Ana', 'Luis'])
    const fourth = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === third.id)!
    await assert.rejects(service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY), conflict(/empate/))
  })
})

test('the regional secretary gets no ballot and no place in the base of other votes', async () => {
  await withAssembly('secretary-other-votes', 4, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const { participantId } = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    await service.removeRegionalSecretary(fourth.id)
    await service.annulRound(fourth.id, 'Otra papeleta primero')

    const other = await election(service, assemblyId, 'Tesorería')
    await service.openRound(other.id)
    const phone = await service.participantState(participantId)
    assert.deepEqual(phone.openRound?.options, [])
    assert.equal(phone.votingDisabled, false)
    await assert.rejects(service.castVote(participantId, other.id, optionId(other, 'Ana')), ForbiddenException)
    assert.equal((await roundOnMesa(service, assemblyId, other.id)).eligibleCount, 4)
  })
})

test('the regional secretary stays in later votes of that election until the mesa removes them', async () => {
  await withAssembly('secretary-later-votes', 4, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    await voteAndClose(service, fourth, people, ['Ana', 'Luis'])
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 5)

    const fifth = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === fourth.id)!
    assert.equal(fifth.regionalSecretaryVotes, true)
    assert.equal(fifth.eligibleCount, 5)

    await service.removeRegionalSecretary(fifth.id)
    const removed = await roundOnMesa(service, assemblyId, fifth.id)
    assert.equal(removed.regionalSecretaryVotes, false)
    assert.equal(removed.eligibleCount, 4)
  })
})

test('a vote already open cannot take the regional secretary', async () => {
  await withAssembly('secretary-open', 4, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    await service.openRound(fourth.id)
    await assert.rejects(service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY), conflict(/antes de abrir/))
  })
})

test('a tied decision with options takes the regional secretary and a yes or no decision does not', async () => {
  await withAssembly('secretary-decisions', 4, async ({ service, assemblyId, people }) => {
    const options = await service.createRound(assemblyId, { title: 'Sede', category: 'decision', decisionFormat: 'options', format: 'single_choice', options: ['Ana', 'Luis'].map((label) => ({ label })) })
    const fourth = await tiedVotes(service, assemblyId, options, people, 3)
    await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 5)
    await service.removeRegionalSecretary(fourth.id)
    await service.annulRound(fourth.id, 'Otra decisión primero')

    const yesOrNo = await service.createRound(assemblyId, { title: 'Presupuesto', category: 'decision', decisionFormat: 'boolean', format: 'single_choice' })
    await assert.rejects(service.addRegionalSecretary(yesOrNo.id, REGIONAL_SECRETARY), conflict(/4\.ª votación/))
    await voteAndClose(service, yesOrNo, people, ['A favor', 'En contra'])
    const repeated = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === yesOrNo.id)
    assert.equal(repeated, undefined)
  })
})

test('adding the regional secretary again retires the previous device', async () => {
  await withAssembly('secretary-readded', 10, async ({ service, assemblyId, people, auth, events }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const first = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    const oldToken = (await service.redeemResumeCode(resumeCodeOf(first.resumeUrl))).participantSessionToken
    const oldIdentity = await auth.authenticate({ audience: 'participant', participantSessionToken: oldToken })
    assert.equal(oldIdentity.audience === 'participant' && oldIdentity.sessionId, first.participantId)
    events.length = 0

    const second = await service.addRegionalSecretary(fourth.id, { firstName: 'Eliseo', lastName: 'Regional' })
    assert.equal(second.participantId, first.participantId)
    assert.deepEqual(events.filter((event) => event.name === 'participantSessionReplaced').map((event) => String(event.target)), [first.participantId])
    await assert.rejects(auth.authenticate({ audience: 'participant', participantSessionToken: oldToken }), UnauthorizedException)

    const newToken = (await service.redeemResumeCode(resumeCodeOf(second.resumeUrl))).participantSessionToken
    const newIdentity = await auth.authenticate({ audience: 'participant', participantSessionToken: newToken })
    assert.equal(newIdentity.audience === 'participant' && newIdentity.sessionId, first.participantId)

    await service.openRound(fourth.id)
    await service.castVote(first.participantId, fourth.id, optionId(fourth, 'Ana'))
  })
})

test('adding the regional secretary again clears a voting block', async () => {
  await withAssembly('secretary-readded-disabled', 10, async ({ service, room, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const first = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    await room.setVotingDisabled(first.participantId, true)
    const second = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    await service.redeemResumeCode(resumeCodeOf(second.resumeUrl))
    await service.openRound(fourth.id)
    assert.equal((await service.participantState(second.participantId)).votingDisabled, false)
    await service.castVote(second.participantId, fourth.id, optionId(fourth, 'Ana'))
  })
})

test('the mesa list shows the regional secretary with whether they voted and never how', async () => {
  await withAssembly('secretary-in-list', 4, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const { participantId } = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    assert.deepEqual(
      (await service.moderatorAssembly(assemblyId)).regionalSecretary,
      { id: participantId, firstName: 'Marta', lastName: 'Regional', status: 'active', voted: false },
    )

    await service.openRound(fourth.id)
    await service.castVote(participantId, fourth.id, optionId(fourth, 'Ana'))
    const mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.regionalSecretary, { id: participantId, firstName: 'Marta', lastName: 'Regional', status: 'active', voted: true })
    assert.equal(mesa.participants.some((person) => person.id === participantId), false)
    assert.equal(mesa.participantCount, 4)
  })
})

test('the mesa takes the regional secretary out and the next vote drops them from the base', async () => {
  await withAssembly('secretary-taken-out', 4, async ({ service, room, assemblyId, people, auth }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const invitation = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    const token = (await service.redeemResumeCode(resumeCodeOf(invitation.resumeUrl))).participantSessionToken
    await voteAndClose(service, fourth, people, ['Ana', 'Luis'])
    const fifth = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === fourth.id)!
    assert.equal(fifth.eligibleCount, 5)

    const result = await room.takeOutOfRoom(invitation.participantId)
    assert.equal(result.status, 'left')

    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.regionalSecretary?.status, 'left')
    assert.equal(mesa.participantCount, 4)
    const draft = mesa.rounds.find((round) => round.id === fifth.id)!
    assert.equal(draft.eligibleCount, 4)
    assert.equal(draft.regionalSecretaryVotes, false)
    assert.equal(mesa.rounds.find((round) => round.id === fourth.id)!.eligibleCount, 5)
    await assert.rejects(auth.authenticate({ audience: 'participant', participantSessionToken: token }), UnauthorizedException)

    await service.openRound(fifth.id)
    await assert.rejects(service.castVote(invitation.participantId, fifth.id, optionId(fifth, 'Ana')))
    assert.equal((await roundOnMesa(service, assemblyId, fifth.id)).eligibleCount, 4)
  })
})

test('a vote already open keeps the regional secretary in its base after they are taken out', async () => {
  await withAssembly('secretary-taken-out-open', 4, async ({ service, room, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const { participantId } = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    await service.openRound(fourth.id)
    await room.takeOutOfRoom(participantId)
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 5)
    for (const [index, person] of people.entries()) await service.castVote(person, fourth.id, optionId(fourth, index % 2 ? 'Luis' : 'Ana'))
    await service.closeRound(fourth.id)
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 5)

    const fifth = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === fourth.id)!
    assert.equal(fifth.eligibleCount, 4)
  })
})

test('the regional secretary cannot be returned to the room', async () => {
  await withAssembly('secretary-no-return', 4, async ({ service, room, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const { participantId } = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    await room.takeOutOfRoom(participantId)
    await assert.rejects(room.returnToRoom(participantId), conflict(/secretaría regional/i))
    assert.equal((await service.moderatorAssembly(assemblyId)).regionalSecretary?.status, 'left')
  })
})

test('adding the regional secretary after a take-out brings them back with a new device', async () => {
  await withAssembly('secretary-readded-after-take-out', 4, async ({ service, room, assemblyId, people, auth }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const first = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    const oldToken = (await service.redeemResumeCode(resumeCodeOf(first.resumeUrl))).participantSessionToken
    await room.takeOutOfRoom(first.participantId)

    const second = await service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY)
    assert.equal(second.participantId, first.participantId)
    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.regionalSecretary?.status, 'active')
    assert.equal(mesa.rounds.find((round) => round.id === fourth.id)!.eligibleCount, 5)
    await assert.rejects(auth.authenticate({ audience: 'participant', participantSessionToken: oldToken }), UnauthorizedException)

    const newToken = (await service.redeemResumeCode(resumeCodeOf(second.resumeUrl))).participantSessionToken
    const identity = await auth.authenticate({ audience: 'participant', participantSessionToken: newToken })
    assert.equal(identity.audience === 'participant' && identity.sessionId, first.participantId)
    await service.openRound(fourth.id)
    await service.castVote(first.participantId, fourth.id, optionId(fourth, 'Ana'))
  })
})
