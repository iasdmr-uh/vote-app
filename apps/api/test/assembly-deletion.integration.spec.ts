import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('after the acta, the mesa erases every record of a completed assembly', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const deletedAssemblies: string[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    if (name === 'assemblyDeleted') deletedAssemblies.push(args[0] as string)
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId = ''
  let otherAssemblyId = ''

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `deletion-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Deletion test', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    otherAssemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Kept', status: 'completed', joinCodeHash: hashCredential(newOpaqueCredential()) } })).id
    const keptRound = await prisma.round.create({ data: { assemblyId: otherAssemblyId, title: 'Kept round', countingRule: { kind: 'count_only' } } })

    const sessions = []
    for (const name of ['Ana', 'Luis', 'Marta']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      sessions.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', options: [{ label: 'Rosa' }, { label: 'Pedro' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(round.id)
    await service.castVote(sessions[0]!, round.id, round.options[0]!.id)
    await service.closeRound(round.id)
    await service.publishRound(round.id)
    await service.declareOfficialResult(round.id, { optionIds: [round.options[0]!.id] })

    const committee = await service.createRound(assemblyId, {
      title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 1, options: [{ label: 'Luis' }, { label: 'Marta' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(committee.id)
    await service.castVote(sessions[1]!, committee.id, [committee.options[1]!.id])
    await service.closeRound(committee.id)

    await assert.rejects(service.deleteAssemblyData(assemblyId, true), /Finaliza la Asamblea/)
    assert.equal(await prisma.participantSession.count({ where: { assemblyId } }), 3, 'nothing is erased before the assembly is completed')

    await service.completeAssembly(assemblyId, true)
    assert.deepEqual(await service.deleteAssemblyData(assemblyId, true), { assemblyId, deleted: true, vacuumed: true })
    assert.deepEqual(deletedAssemblies, [assemblyId], 'live sockets of the assembly are closed')

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
    for (const id of [assemblyId, otherAssemblyId].filter(Boolean)) {
      await prisma.round.deleteMany({ where: { assemblyId: id } })
      await prisma.participantSession.deleteMany({ where: { assemblyId: id } })
      await prisma.assembly.deleteMany({ where: { id } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})
