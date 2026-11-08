import assert from 'node:assert/strict'
import test from 'node:test'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'

test('the published count gives "no votaron" as the majority base minus votes cast, inhabilitados included', async () => {
  const prisma = await connectDatabase()
  const service = new VotingService(prisma, gatewayStub().gateway)
  const delegates = ['Ana', 'Luis', 'Marta', 'Pedro', 'Rosa']
  const seeded = await seedAssembly(prisma, service, { label: 'not-voted-test', delegates })
  const { assemblyId, joinCode } = seeded
  const people = Object.fromEntries(delegates.map((name) => [name, seeded.people[name]!.id]))

  try {
    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'Opción A' }, { label: 'Opción B' }],
    })
    await service.openRound(round.id)
    await service.castVote(people.Ana!, round.id, round.options[0]!.id)
    await service.castVote(people.Marta!, round.id, round.options[0]!.id)
    // Luis is inhabilitado without voting and Pedro just does not vote: both count as "no votaron".
    await service.setVotingDisabled(people.Luis!, true)
    // Rosa votes and is inhabilitada afterwards: her vote is kept, so she is not among them.
    await service.castVote(people.Rosa!, round.id, round.options[1]!.id)
    await service.setVotingDisabled(people.Rosa!, true)
    await service.closeRound(round.id)
    await service.publishRound(round.id)

    const mesa = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === round.id)!
    assert.equal(mesa.eligibleCount, 5)
    assert.equal(mesa.participationCount, 3)
    assert.equal(mesa.outcome?.base, mesa.eligibleCount, 'same base as the majority')
    assert.equal(mesa.eligibleCount - mesa.participationCount, 2)

    const projector = await service.publicState(joinCode)
    assert.equal(projector.recordedCount, 3)
    assert.equal(projector.eligibleCount, 5)
    assert.equal(projector.outcome?.base, projector.eligibleCount)

    const phone = await service.participantState(people.Marta!)
    assert.equal(phone.recordedCount, 3)
    assert.equal(phone.eligibleCount, 5)

    await service.takeOutOfRoom(people.Pedro!)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 5)
  } finally {
    await seeded.cleanup()
    await prisma.$disconnect()
  }
})
