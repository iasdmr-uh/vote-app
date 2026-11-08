import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../src/prisma/prisma.service.js'
import type { RoomService } from '../../src/voting/room.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { buildProviders } from '../support/providers.js'
import { seedAssembly } from '../support/seed.js'

type Context = { prisma: PrismaService; service: VotingService; room: RoomService; assemblyId: string; joinCode: string; people: string[] }
type Vote = { id: string; options: Array<{ id: string; label: string }> }

async function withAssembly(name: string, count: number, body: (context: Context) => Promise<void>) {
  const prisma = await connectDatabase()
  const { gateway } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const names = Array.from({ length: count }, (_, index) => `Delegado ${index + 1}`)
  const { assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, room, { label: name, delegates: names })
  try {
    await body({ prisma, service, room, assemblyId, joinCode, people: names.map((person) => people[person]!.id) })
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

const optionId = (vote: Vote, label: string) => vote.options.find((option) => option.label === label)!.id

const election = (service: VotingService, assemblyId: string) =>
  service.createRound(assemblyId, { title: 'Presidencia', category: 'office', format: 'single_choice', options: ['Isaías', 'Jeremías', 'Ezequiel'].map((label) => ({ label })) })

async function voteAndClose(service: VotingService, vote: Vote, people: string[], labels: string[]) {
  await service.openRound(vote.id)
  for (const [index, person] of people.entries()) await service.castVote(person, vote.id, optionId(vote, labels[index % labels.length]!))
  await service.closeRound(vote.id)
}

async function mesaRound(service: VotingService, assemblyId: string, roundId: string) {
  return (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.id === roundId)!
}

async function fourthVote(service: VotingService, assemblyId: string, people: string[]) {
  let vote: Vote = await election(service, assemblyId)
  for (let count = 0; count < 3; count += 1) {
    await voteAndClose(service, vote, people, ['Isaías', 'Jeremías'])
    vote = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === vote.id)!
  }
  return vote
}

test('the mesa and the projector get the rule, the reasons and the base of a result, and the phone does not', async () => {
  await withAssembly('explanation-office', 5, async ({ service, assemblyId, joinCode, people }) => {
    const vote = await election(service, assemblyId)
    await voteAndClose(service, vote, people, ['Isaías', 'Isaías', 'Jeremías', 'Isaías', 'Jeremías'])
    const expected = {
      rule: 'simple',
      reasons: { [optionId(vote, 'Isaías')]: 'elected', [optionId(vote, 'Jeremías')]: 'out', [optionId(vote, 'Ezequiel')]: 'out' },
      baseDelegates: 5,
      baseIncludesSecretary: false,
    }
    assert.deepEqual((await mesaRound(service, assemblyId, vote.id)).explanation, expected)
    assert.deepEqual((await service.publicState(joinCode)).explanation, expected)
    assert.equal('explanation' in (await service.participantState(people[0]!)), false)
  })
})

test('a vote records the regional secretary in its base when it opens and keeps it after a take-out', async () => {
  await withAssembly('explanation-secretary', 4, async ({ prisma, service, room, assemblyId, joinCode, people }) => {
    const fourth = await fourthVote(service, assemblyId, people)
    const { participantId } = await service.addRegionalSecretary(fourth.id, { firstName: 'Secretaría', lastName: 'Regional' })
    await voteAndClose(service, fourth, people, ['Isaías', 'Jeremías'])
    await room.takeOutOfRoom(participantId)

    const stored = await prisma.round.findUniqueOrThrow({ where: { id: fourth.id }, select: { regionalSecretaryInBase: true } })
    assert.equal(stored.regionalSecretaryInBase, true)
    const explanation = (await mesaRound(service, assemblyId, fourth.id)).explanation
    assert.equal(explanation?.baseDelegates, 4)
    assert.equal(explanation?.baseIncludesSecretary, true)
    assert.equal((await service.publicState(joinCode)).explanation?.baseIncludesSecretary, true)
  })
})

test('a vote without the regional secretary records that they are not in its base', async () => {
  await withAssembly('explanation-no-secretary', 3, async ({ prisma, service, assemblyId, people }) => {
    const vote = await election(service, assemblyId)
    await voteAndClose(service, vote, people, ['Isaías'])
    const stored = await prisma.round.findUniqueOrThrow({ where: { id: vote.id }, select: { regionalSecretaryInBase: true } })
    assert.equal(stored.regionalSecretaryInBase, false)
  })
})

test('a vote frozen before the column existed falls back to whether the secretary was asked to vote', async () => {
  await withAssembly('explanation-fallback', 4, async ({ prisma, service, assemblyId, people }) => {
    const fourth = await fourthVote(service, assemblyId, people)
    await service.addRegionalSecretary(fourth.id, { firstName: 'Secretaría', lastName: 'Regional' })
    await voteAndClose(service, fourth, people, ['Isaías', 'Jeremías'])
    await prisma.$executeRaw`UPDATE rounds SET regional_secretary_in_base = NULL WHERE id = ${fourth.id}::uuid`
    const explanation = (await mesaRound(service, assemblyId, fourth.id)).explanation
    assert.equal(explanation?.baseDelegates, 4)
    assert.equal(explanation?.baseIncludesSecretary, true)
  })
})
