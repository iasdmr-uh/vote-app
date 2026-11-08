import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import type { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

type Context = { service: VotingService; assemblyId: string; people: string[] }

async function withAssembly(name: string, count: number, body: (context: Context) => Promise<void>) {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
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
    await body({ service, assemblyId, people })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
}

const election = (service: VotingService, assemblyId: string) =>
  service.createRound(assemblyId, { title: 'Presidencia', category: 'office', format: 'single_choice', options: ['Isaías', 'Jeremías'].map((label) => ({ label })) })

async function eligibleOnMesa(service: VotingService, assemblyId: string, roundId: string) {
  return (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.id === roundId)!.eligibleCount
}

test('no vote is open, so there is no base to count', { skip }, async () => {
  await withAssembly('connection-base-none', 3, async ({ service, assemblyId }) => {
    assert.equal(await service.openRoundBase(assemblyId), null)
    await election(service, assemblyId)
    assert.equal(await service.openRoundBase(assemblyId), null)
  })
})

test('the base of an open vote lists everyone who counts in "han votado"', { skip }, async () => {
  await withAssembly('connection-base-open', 4, async ({ service, assemblyId, people }) => {
    const vote = await election(service, assemblyId)
    await service.openRound(vote.id)
    const base = await service.openRoundBase(assemblyId)
    assert.equal(base?.roundId, vote.id)
    assert.deepEqual([...base!.participantIds].sort(), [...people].sort())
    assert.equal(base!.participantIds.length, await eligibleOnMesa(service, assemblyId, vote.id))
  })
})

test('a disabled delegate stays in the base', { skip }, async () => {
  await withAssembly('connection-base-disabled', 3, async ({ service, assemblyId, people }) => {
    await service.setVotingDisabled(people[0]!, true)
    const vote = await election(service, assemblyId)
    await service.openRound(vote.id)
    assert.ok((await service.openRoundBase(assemblyId))!.participantIds.includes(people[0]!))
  })
})

test('someone taken out of the room is not in the base', { skip }, async () => {
  await withAssembly('connection-base-out', 3, async ({ service, assemblyId, people }) => {
    await service.takeOutOfRoom(people[0]!)
    const vote = await election(service, assemblyId)
    await service.openRound(vote.id)
    const base = (await service.openRoundBase(assemblyId))!
    assert.equal(base.participantIds.includes(people[0]!), false)
    assert.equal(base.participantIds.length, await eligibleOnMesa(service, assemblyId, vote.id))
  })
})

test('the base closes with the vote and with an annulment', { skip }, async () => {
  await withAssembly('connection-base-closed', 2, async ({ service, assemblyId }) => {
    const first = await election(service, assemblyId)
    await service.openRound(first.id)
    await service.closeRound(first.id)
    assert.equal(await service.openRoundBase(assemblyId), null)
    const second = await election(service, assemblyId)
    await service.openRound(second.id)
    await service.annulRound(second.id, 'Prueba')
    assert.equal(await service.openRoundBase(assemblyId), null)
  })
})

test('the regional secretary is in the base only of a vote that adds them', { skip }, async () => {
  await withAssembly('connection-base-secretary', 4, async ({ service, assemblyId, people }) => {
    let vote = await election(service, assemblyId)
    for (let count = 0; count < 3; count += 1) {
      await service.openRound(vote.id)
      for (const [index, person] of people.entries()) {
        await service.castVote(person, vote.id, vote.options.find((option) => option.label === (index % 2 ? 'Jeremías' : 'Isaías'))!.id)
      }
      await service.closeRound(vote.id)
      await service.publishRound(vote.id)
      vote = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === vote.id)!
    }
    await service.addRegionalSecretary(vote.id, { firstName: 'Ester', lastName: 'Regional' })
    await service.openRound(vote.id)
    const base = (await service.openRoundBase(assemblyId))!
    assert.equal(base.participantIds.length, people.length + 1)
    assert.equal(base.participantIds.length, await eligibleOnMesa(service, assemblyId, vote.id))

    const secretary = base.participantIds.find((id) => !people.includes(id))!
    await service.annulRound(vote.id, 'Prueba')
    const next = await election(service, assemblyId)
    await service.openRound(next.id)
    const nextBase = (await service.openRoundBase(assemblyId))!
    assert.equal(nextBase.participantIds.includes(secretary), false)
    assert.equal(nextBase.participantIds.length, await eligibleOnMesa(service, assemblyId, next.id))
  })
})
