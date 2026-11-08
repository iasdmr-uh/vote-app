import assert from 'node:assert/strict'
import test from 'node:test'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

type Context = { service: VotingService; assemblyId: string; joinCode: string; people: string[] }

async function withAssembly(name: string, count: number, body: (context: Context) => Promise<void>) {
  const prisma = await connectDatabase()
  const { voting: service, room } = buildProviders(prisma)
  const names = Array.from({ length: count }, (_, index) => `Delegado ${index + 1}`)
  const { assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, room, { label: name, delegates: names })
  try {
    await body({ service, assemblyId, joinCode, people: names.map((person) => people[person]!.id) })
  } finally {
    await cleanup()
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

test('a vote that fills several seats lists them from most voted to least voted', async () => {
  await withAssembly('order-one-vote', 10, async ({ service, assemblyId, joinCode, people }) => {
    const candidates = ['Diego', 'Carla', 'Bruno', 'Ana', 'Elsa']
    const round = await service.createRound(assemblyId, { title: 'Comisión', category: 'committee', memberCount: 4, format: 'multiple_choice', options: candidates.map((label) => ({ label })) })
    await service.openRound(round.id)
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

test('a member elected in an earlier vote stays ahead of a later vote with more votes', async () => {
  await withAssembly('order-chain', 5, async ({ service, assemblyId, people }) => {
    const first = await service.createRound(assemblyId, { title: 'Comisión', category: 'committee', memberCount: 2, format: 'multiple_choice', options: ['Zoe', 'Ana', 'Luis'].map((label) => ({ label })) })
    await service.openRound(first.id)
    const marks = [['Zoe', 'Ana'], ['Zoe', 'Ana'], ['Zoe', 'Luis']]
    for (const [index, names] of marks.entries()) await service.castVote(people[index]!, first.id, idsOf(first.options, names))
    await service.closeRound(first.id)
    await service.publishRound(first.id)

    const draft = (await service.moderatorAssembly(assemblyId)).rounds.find((round) => round.runoffSourceRoundId === first.id)!
    await service.openRound(draft.id)
    for (const person of people) await service.castVote(person, draft.id, idsOf(draft.options, ['Ana']))
    await service.closeRound(draft.id)
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe', 'Ana'])

    await service.annulRound(draft.id, 'Error de lectura')
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe'])
    const repeat = await service.repeatRound(draft.id, { optionIds: idsOf(draft.options, ['Ana', 'Luis']), seats: 1 })
    await service.openRound(repeat.id)
    for (const person of people) await service.castVote(person, repeat.id, idsOf(repeat.options, ['Luis']))
    await service.closeRound(repeat.id)
    assert.deepEqual(await electedOnMesa(service, assemblyId, first.id), ['Zoe', 'Luis'])
  })
})
