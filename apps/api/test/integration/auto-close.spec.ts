import assert from 'node:assert/strict'
import test from 'node:test'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'
import { RESULTS_ENGINE_ACTOR } from '../../src/voting/constants.js'

const delegates = ['Delegado 1', 'Delegado 2', 'Delegado 3']
const ballot = { title: 'Presidente', format: 'single_choice' as const, countingRule: { kind: 'count_only' as const }, options: [{ label: 'Isaías' }, { label: 'Jeremías' }] }

test('a vote closes by itself after the last ballot of everyone who can vote, and a disabled delegate does not hold it open', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-test', delegates })

  try {
    await room.setVotingDisabled(people['Delegado 3']!.id, true)
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)

    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'open', 'one person still has to vote')

    events.length = 0
    await service.castVote(people['Delegado 2']!.id, round.id, round.options[1]!.id)
    const closed = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    assert.equal(closed.status, 'published', 'the result shows like any other closed vote')
    assert.equal(closed.eligibleCount, 3, 'the disabled delegate stays in the base')
    assert.ok(events.some((event) => event.name === 'roundClosed'))

    const entries = await prisma.auditEvent.findMany({ where: { assemblyId, roundId: round.id, action: { in: ['round.closed', 'round.closed_automatically'] } } })
    assert.deepEqual(entries.map((entry) => [entry.action, entry.actorRef, entry.metadata]), [['round.closed_automatically', RESULTS_ENGINE_ACTOR, { reason: 'everyone_voted' }]])

    await service.annulRound(round.id, 'Error en la papeleta')
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'annulled')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('a vote stays open until the operator closes it while someone who can vote has not voted', async () => {
  const prisma = await connectDatabase()
  const { gateway } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const { assemblyId, people, cleanup } = await seedAssembly(prisma, room, { label: 'auto-close-open-test', delegates })

  try {
    const round = await service.createRound(assemblyId, ballot)
    await service.openRound(round.id)
    await service.castVote(people['Delegado 1']!.id, round.id, round.options[0]!.id)
    await service.castVote(people['Delegado 2']!.id, round.id, round.options[0]!.id)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, 'open')

    await service.closeRound(round.id)
    const entries = await prisma.auditEvent.findMany({ where: { assemblyId, roundId: round.id, action: { in: ['round.closed', 'round.closed_automatically'] } } })
    assert.deepEqual(entries.map((entry) => entry.action), ['round.closed'])
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})
