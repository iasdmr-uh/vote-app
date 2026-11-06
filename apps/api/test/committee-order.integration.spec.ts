import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

type Context = { service: VotingService; assemblyId: string; joinCode: string; people: string[] }

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
    await body({ service, assemblyId, joinCode, people })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
}

type Ballot = Array<{ id: string; label: string }>
const idsOf = (ballot: Ballot, labels: string[]) => labels.map((label) => ballot.find((option) => option.label === label)!.id)
const namesOf = (elected?: Array<{ label: string }> | null) => elected?.map((person) => person.label)

async function electedOnMesa(service: VotingService, assemblyId: string, rootId: string) {
  const mesa = await service.moderatorAssembly(assemblyId)
  return namesOf(mesa.rounds.find((round) => round.id === rootId)?.officialResult?.elected)
}

test('a vote that fills several seats lists them from most voted to least voted', { skip }, async () => {
  await withAssembly('order-one-vote', 10, async ({ service, assemblyId, joinCode, people }) => {
    const candidates = ['Diego', 'Carla', 'Bruno', 'Ana', 'Elsa']
    const round = await service.createRound(assemblyId, { title: 'Comisión', category: 'committee', memberCount: 4, format: 'multiple_choice', options: candidates.map((label) => ({ label })) })
    await service.openRound(round.id)
    // Each delegate leaves one name out, so Ana 10, Bruno 9, Carla 8, Diego 7 and Elsa 6.
    const leftOut = ['Bruno', 'Carla', 'Carla', 'Diego', 'Diego', 'Diego', 'Elsa', 'Elsa', 'Elsa', 'Elsa']
    for (const [index, omitted] of leftOut.entries()) {
      await service.castVote(people[index]!, round.id, idsOf(round.options, candidates.filter((name) => name !== omitted)))
    }
    await service.closeRound(round.id)
    assert.deepEqual(await electedOnMesa(service, assemblyId, round.id), ['Ana', 'Bruno', 'Carla', 'Diego'])

    await service.publishRound(round.id)
    const screen = await service.publicState(joinCode)
    assert.deepEqual(namesOf(screen.officialResult?.elected), ['Ana', 'Bruno', 'Carla', 'Diego'])
  })
})

test('a member elected in an earlier vote stays ahead of a later vote with more votes', { skip }, async () => {
  await withAssembly('order-chain', 5, async ({ service, assemblyId, people }) => {
    const first = await service.createRound(assemblyId, { title: 'Comisión', category: 'committee', memberCount: 2, format: 'multiple_choice', options: ['Zoe', 'Ana', 'Luis'].map((label) => ({ label })) })
    await service.openRound(first.id)
    // Zoe 3 reaches the majority of 5. Ana 2 and Luis 1 go to a runoff for the open seat.
    const marks = [['Zoe', 'Ana'], ['Zoe', 'Ana'], ['Zoe', 'Luis']]
    for (const [index, names] of marks.entries()) await service.castVote(people[index]!, first.id, idsOf(first.options, names))
    await service.closeRound(first.id)
    await service.publishRound(first.id)

    const draft = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === first.id)!
    await service.openRound(draft.id)
    for (const person of people) await service.castVote(person, draft.id, idsOf(draft.options, ['Ana']))
    await service.closeRound(draft.id)
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe', 'Ana'])

    // Annulling and repeating the runoff returns the seat to the same place.
    await service.annulRound(draft.id, 'Error de lectura')
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe'])
    const repeat = await service.repeatRound(draft.id, { optionIds: idsOf(draft.options, ['Ana', 'Luis']), seats: 1 })
    await service.openRound(repeat.id)
    for (const person of people) await service.castVote(person, repeat.id, idsOf(repeat.options, ['Luis']))
    await service.closeRound(repeat.id)
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe', 'Luis'])
  })
})
