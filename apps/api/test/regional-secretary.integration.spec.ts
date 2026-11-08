import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { RealtimeAuthService } from '../src/auth/auth.service.js'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

type Context = { service: VotingService; assemblyId: string; joinCode: string; people: string[]; auth: RealtimeAuthService; replaced: string[] }
type Ballot = Array<{ id: string; label: string }>
type Vote = { id: string; options: Ballot }

const REGIONAL_SECRETARY = { firstName: 'Marta', lastName: 'Regional' }

async function withAssembly(name: string, count: number, body: (context: Context) => Promise<void>) {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const replaced: string[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    if (name === 'participantSessionReplaced') replaced.push(String(args[0]))
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const auth = new RealtimeAuthService(prisma)
  const organizationId = randomUUID()
  let assemblyId: string | undefined
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `${name}-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId, name, status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: string[] = []
    for (let index = 0; index < count; index += 1) {
      const joined = await service.joinAssembly(joinCode, `Delegado ${index + 1}`, 'Prueba')
      people.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    await body({ service, assemblyId, joinCode, people, auth, replaced })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
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
  await service.publishRound(vote.id)
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

test('the regional secretary breaks a tie in the 4th vote as one more secret voter', { skip }, async () => {
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
    await service.publishRound(fourth.id)

    const screen = await service.publicState(joinCode)
    assert.equal(screen.eligibleCount, 11)
    assert.equal(screen.recordedCount, 11)
    assert.equal(screen.participantCount, 10)
    assert.equal(screen.round?.regionalSecretaryVotes, true)
    assert.deepEqual(screen.officialResult?.elected.map((person) => person.label), ['Ana'])
    assert.equal((await roundOnMesa(service, assemblyId, fourth.id)).eligibleCount, 11)
  })
})

test('the regional secretary cannot join before the 4th vote', { skip }, async () => {
  await withAssembly('secretary-too-early', 4, async ({ service, assemblyId, people }) => {
    const first = await election(service, assemblyId)
    await assert.rejects(service.addRegionalSecretary(first.id, REGIONAL_SECRETARY), conflict(/4\.ª votación/))
    const third = await tiedVotes(service, assemblyId, first, people, 2)
    await assert.rejects(service.addRegionalSecretary(third.id, REGIONAL_SECRETARY), conflict(/4\.ª votación/))
  })
})

test('the regional secretary cannot join when the previous vote did not tie', { skip }, async () => {
  await withAssembly('secretary-no-tie', 10, async ({ service, assemblyId, people }) => {
    const third = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 2)
    await voteAndClose(service, third, people.slice(0, 9), ['Ana', 'Luis'])
    const fourth = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === third.id)!
    await assert.rejects(service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY), conflict(/empate/))
  })
})

test('the regional secretary gets no ballot and no place in the base of other votes', { skip }, async () => {
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

test('the regional secretary stays in later votes of that election until the mesa removes them', { skip }, async () => {
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

test('a vote already open cannot take the regional secretary', { skip }, async () => {
  await withAssembly('secretary-open', 4, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    await service.openRound(fourth.id)
    await assert.rejects(service.addRegionalSecretary(fourth.id, REGIONAL_SECRETARY), conflict(/antes de abrir/))
  })
})

test('a tied decision with options takes the regional secretary and a yes or no decision does not', { skip }, async () => {
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

test('adding the regional secretary again retires the previous device', { skip }, async () => {
  await withAssembly('secretary-readded', 10, async ({ service, assemblyId, people, auth, replaced }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const first = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    const oldToken = (await service.redeemResumeCode(resumeCodeOf(first.resumeUrl))).participantSessionToken
    const oldIdentity = await auth.authenticate({ audience: 'participant', participantSessionToken: oldToken })
    assert.equal(oldIdentity.audience === 'participant' && oldIdentity.sessionId, first.participantId)
    replaced.length = 0

    const second = await service.addRegionalSecretary(fourth.id, { firstName: 'Eliseo', lastName: 'Regional' })
    assert.equal(second.participantId, first.participantId)
    assert.deepEqual(replaced, [first.participantId])
    await assert.rejects(auth.authenticate({ audience: 'participant', participantSessionToken: oldToken }), UnauthorizedException)

    const newToken = (await service.redeemResumeCode(resumeCodeOf(second.resumeUrl))).participantSessionToken
    const newIdentity = await auth.authenticate({ audience: 'participant', participantSessionToken: newToken })
    assert.equal(newIdentity.audience === 'participant' && newIdentity.sessionId, first.participantId)

    await service.openRound(fourth.id)
    await service.castVote(first.participantId, fourth.id, optionId(fourth, 'Ana'))
  })
})

test('adding the regional secretary again clears a voting block', { skip }, async () => {
  await withAssembly('secretary-readded-disabled', 10, async ({ service, assemblyId, people }) => {
    const fourth = await tiedVotes(service, assemblyId, await election(service, assemblyId), people, 3)
    const first = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    await service.setVotingDisabled(first.participantId, true)
    const second = await service.addRegionalSecretary(fourth.id, { firstName: 'Elías', lastName: 'Regional' })
    await service.redeemResumeCode(resumeCodeOf(second.resumeUrl))
    await service.openRound(fourth.id)
    assert.equal((await service.participantState(second.participantId)).votingDisabled, false)
    await service.castVote(second.participantId, fourth.id, optionId(fourth, 'Ana'))
  })
})
