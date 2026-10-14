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

    // Committee rows reference participant sessions with ON DELETE RESTRICT; deletion must order around them.
    const committee = await prisma.round.create({ data: { assemblyId, title: 'Comisión', category: 'committee', committeeType: 'nomination', countingRule: { kind: 'count_only' } } })
    const proposal = await prisma.committeeProposal.create({ data: { roundId: committee.id, candidateParticipantId: sessions[1]!, proposedByParticipantId: sessions[0]! } })
    await prisma.committeeProposalSupport.create({ data: { proposalId: proposal.id, supporterParticipantId: sessions[2]! } })
    await prisma.ballotOption.create({ data: { roundId: committee.id, label: 'Luis', order: 1, candidateParticipantId: sessions[1]! } })
    await prisma.committeeWinner.create({ data: { rootRoundId: committee.id, candidateParticipantId: sessions[1]!, sourceRoundId: committee.id, order: 1 } })

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
    assert.equal(await prisma.committeeProposal.count({ where: { roundId: committee.id } }), 0)
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
