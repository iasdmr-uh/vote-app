import assert from 'node:assert/strict'
import test from 'node:test'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { OperatorLogService } from '../../src/voting/operator-log.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'

test('after the acta, the mesa erases every record of a completed assembly', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const service = new VotingService(prisma, gateway)
  const { organizationId, assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, service, { label: 'deletion-test', delegates: ['Ana', 'Luis', 'Marta'] })
  const sessions = ['Ana', 'Luis', 'Marta'].map((name) => people[name]!.id)

  try {
    const otherAssemblyId = (await prisma.assembly.create({ data: { organizationId, name: 'Kept', status: 'completed', joinCodeHash: hashCredential(newOpaqueCredential()) } })).id
    const keptRound = await prisma.round.create({ data: { assemblyId: otherAssemblyId, title: 'Kept round', countingRule: { kind: 'count_only' } } })

    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', options: [{ label: 'Rosa' }, { label: 'Pedro' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(round.id)
    await service.castVote(sessions[0]!, round.id, round.options[0]!.id)
    await service.closeRound(round.id)
    await service.publishRound(round.id)

    const committee = await service.createRound(assemblyId, {
      title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 1, options: [{ label: 'Luis' }, { label: 'Marta' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(committee.id)
    await service.castVote(sessions[1]!, committee.id, [committee.options[1]!.id])
    await service.closeRound(committee.id)

    await assert.rejects(service.deleteAssemblyData(assemblyId, true), /Finaliza la Asamblea/)
    assert.equal(await prisma.participantSession.count({ where: { assemblyId } }), 3, 'nothing is erased before the assembly is completed')

    await service.completeAssembly(assemblyId, true)
    await new OperatorLogService(prisma).download(assemblyId, 'delete')
    assert.deepEqual(await service.deleteAssemblyData(assemblyId, true), { assemblyId, deleted: true, vacuumed: true })
    assert.deepEqual(events.filter((event) => event.name === 'assemblyDeleted').map((event) => event.target), [assemblyId], 'live sockets of the assembly are closed')

    assert.equal(await prisma.assembly.count({ where: { id: assemblyId } }), 0)
    assert.equal(await prisma.participantSession.count({ where: { assemblyId } }), 0)
    assert.equal(await prisma.round.count({ where: { assemblyId } }), 0)
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 0)
    assert.equal(await prisma.participation.count({ where: { roundId: round.id } }), 0)
    assert.equal(await prisma.officialResult.count({ where: { roundId: round.id } }), 0)
    assert.equal(await prisma.ballotOption.count({ where: { roundId: committee.id } }), 0)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId } }), 0)
    await assert.rejects(service.publicState(joinCode), /no encontrada/)
    await assert.rejects(service.deleteAssemblyData(assemblyId, true), /no encontrada/)

    assert.equal(await prisma.assembly.count({ where: { id: otherAssemblyId } }), 1, 'other assemblies are untouched')
    assert.equal(await prisma.round.count({ where: { id: keptRound.id } }), 1)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})
