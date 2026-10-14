import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('the mesa can annul a ballot, repeat it, and count the null vote apart', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const roundStates: string[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    if (name === 'roundState') roundStates.push((args[1] as { status: string }).status)
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined
  const organizationId = randomUUID()

  try {
    // Its own organization, so this file can run in parallel with tests that use createAssembly().
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `annulment-test-${organizationId}`, type: 'union' } })
    const created = { joinCode: newOpaqueCredential(), assemblyId: '' }
    created.assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Annulment test', status: 'lobby_open', joinCodeHash: hashCredential(created.joinCode) } })).id
    assemblyId = created.assemblyId
    const voters = []
    for (const name of ['Ana', 'Luis', 'Marta']) {
      const joined = await service.joinAssembly(created.joinCode, name, 'Delegado')
      voters.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')

    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', options: [{ label: 'Juan Peres' }, { label: 'María López' }], countingRule: { kind: 'count_only' },
    })
    assert.deepEqual(round.options.map((option) => [option.label, option.isNullVote]), [['Juan Peres', false], ['María López', false], ['Voto nulo', true]])
    await service.openRound(round.id)
    await service.castVote(voters[0]!, round.id, round.options[0]!.id)

    // A misspelled name is noticed while the ballot is open.
    const annulled = await service.annulRound(round.id, 'Nombre mal escrito: Juan Pérez')
    assert.equal(annulled.status, 'annulled')
    assert.equal(roundStates.at(-1), 'annulled', 'phones and projector are told the ballot was annulled')
    const stored = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    assert.equal(stored.annulReason, 'Nombre mal escrito: Juan Pérez')
    assert.ok(stored.votesUnlinkedAt, 'the deleted votes went through the secrecy cleanup')
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 0, 'annulled votes can never be counted')
    assert.equal(await prisma.participation.count({ where: { roundId: round.id } }), 1, 'the participation receipt stays as a record')
    await assert.rejects(service.castVote(voters[1]!, round.id, round.options[0]!.id), ConflictException)
    await assert.rejects(service.publishRound(round.id), ConflictException)
    const publicAfterAnnul = await service.publicState(created.joinCode)
    assert.equal(publicAfterAnnul.round?.status, 'annulled')
    assert.equal('results' in publicAfterAnnul, false)
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.annulled' } }), 1)
    await assert.rejects(service.declareOfficialResult(round.id, { optionIds: [round.options[1]!.id] }), /Cierra la papeleta/)

    // The mesa repeats the vote; the annulled ballot remains the one where the result is declared.
    const repeat = await service.repeatRound(round.id, { optionIds: [round.options[0]!.id, round.options[1]!.id], title: 'Presidencia (repetición)' })
    await service.openRound(repeat.id)
    await service.castVote(voters[0]!, repeat.id, repeat.options[1]!.id)
    await service.castVote(voters[1]!, repeat.id, repeat.options[1]!.id)
    await service.castVote(voters[2]!, repeat.id, repeat.options.find((option) => option.isNullVote)!.id)
    await service.closeRound(repeat.id)
    const results = (await service.publishRound(repeat.id)).results
    assert.deepEqual(results.map((option) => [option.label, option.count]), [['María López', 2], ['Juan Peres', 0], ['Voto nulo', 1]])

    await assert.rejects(service.declareOfficialResult(round.id, { optionIds: [round.options[2]!.id] }), /no se puede declarar/)
    await service.declareOfficialResult(round.id, { optionIds: [round.options[1]!.id], note: 'Electa en la repetición' })
    await service.publishOfficialResult(round.id)
    assert.deepEqual((await service.publicState(created.joinCode)).officialResult?.elected.map((item) => item.label), ['María López'])
    assert.equal((await service.annulRound(round.id, 'otra vez')).status, 'annulled', 'annulling again is a no-op')

    // Review of PR #28: a standing declaration cannot be undermined by annulling or repeating its votes.
    await assert.rejects(service.annulRound(repeat.id, 'después de declarar'), /retíralo antes de anularla/)
    await assert.rejects(service.repeatRound(repeat.id, { optionIds: [repeat.options[0]!.id] }), /retíralo antes de repetir/)
    await assert.rejects(service.repeatRound(round.id, { optionIds: [round.options[1]!.id] }), /retíralo antes de repetir/)
    assert.equal((await service.publicState(created.joinCode)).officialResult?.elected[0]?.label, 'María López', 'the published declaration still matches counted votes')
    await service.withdrawOfficialResult(round.id)
    assert.equal('officialResult' in await service.publicState(created.joinCode), false, 'a withdrawn declaration disappears from public screens')
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.official_result.withdrawn' } }), 1)
    // A repetition prepared before a new declaration cannot open while that declaration stands, but can be discarded.
    const second = await service.repeatRound(round.id, { optionIds: [round.options[1]!.id] })
    await service.declareOfficialResult(round.id, { optionIds: [round.options[1]!.id] })
    await assert.rejects(service.openRound(second.id), /retíralo antes de abrir/)
    assert.equal((await service.annulRound(second.id, 'Ya no hace falta')).status, 'annulled')
    await assert.rejects(service.annulRound(repeat.id, 'después de declarar'), /retíralo antes de anularla/)

    const secretary = await service.createRound(assemblyId, {
      title: 'Secretaría', format: 'single_choice', options: [{ label: 'Rosa' }, { label: 'Pedro' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(secretary.id)
    await service.closeRound(secretary.id)
    await service.declareOfficialResult(secretary.id, { optionIds: [secretary.options[0]!.id] })
    await assert.rejects(service.annulRound(secretary.id, 'tarde'), /resultado oficial registrado/)
    assert.equal((await service.completeAssembly(assemblyId, true)).status, 'completed')
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})
