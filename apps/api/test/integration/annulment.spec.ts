import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

test('the mesa can annul a ballot, repeat it, and annulling takes back what it computed', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service } = buildProviders(prisma, gateway)
  const roundStates = () => events.filter((event) => event.name === 'roundState').map((event) => (event.payload as { status: string }).status)
  const { assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, service, { label: 'annulment-test', delegates: ['Ana', 'Luis', 'Marta'] })
  const voters = ['Ana', 'Luis', 'Marta'].map((name) => people[name]!.id)

  try {
    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', options: [{ label: 'Juan Peres' }, { label: 'María López' }], countingRule: { kind: 'count_only' },
    })
    assert.deepEqual(round.options.map((option) => option.label), ['Juan Peres', 'María López'], 'no null-vote option is added')
    await service.openRound(round.id)
    await service.castVote(voters[0]!, round.id, round.options[0]!.id)

    // A misspelled name is noticed while the ballot is open.
    const annulled = await service.annulRound(round.id, 'Nombre mal escrito: Juan Pérez')
    assert.equal(annulled.status, 'annulled')
    assert.equal(roundStates().at(-1), 'annulled', 'phones and projector are told the ballot was annulled')
    const stored = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    assert.equal(stored.annulReason, 'Nombre mal escrito: Juan Pérez')
    assert.ok(stored.votesUnlinkedAt, 'the deleted votes went through the secrecy cleanup')
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 0, 'annulled votes can never be counted')
    assert.equal(await prisma.participation.count({ where: { roundId: round.id } }), 1, 'the participation receipt stays as a record')
    await assert.rejects(service.castVote(voters[1]!, round.id, round.options[0]!.id), ConflictException)
    await assert.rejects(service.publishRound(round.id), ConflictException)
    const publicAfterAnnul = await service.publicState(joinCode)
    assert.equal(publicAfterAnnul.round?.status, 'annulled')
    assert.equal('results' in publicAfterAnnul, false)
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.annulled' } }), 1)
    // The mesa repeats the annulled vote; the repetition joins the same election and is counted automatically.
    const repeat = await service.repeatRound(round.id, { optionIds: [round.options[0]!.id, round.options[1]!.id] })
    assert.equal(repeat.committeeRootRoundId, round.id)
    assert.equal(repeat.title, 'Presidencia')
    await assert.rejects(service.repeatRound(round.id, { optionIds: [round.options[1]!.id] }), /votación posterior/, 'one repetition per annulled vote')
    await service.openRound(repeat.id)
    await service.castVote(voters[0]!, repeat.id, repeat.options[1]!.id)
    await service.castVote(voters[1]!, repeat.id, repeat.options[1]!.id)
    await service.castVote(voters[2]!, repeat.id, repeat.options[0]!.id)
    await service.closeRound(repeat.id)
    assert.equal('officialResult' in await service.publicState(joinCode), false, 'the result stays with the mesa until published')
    const results = (await service.publishRound(repeat.id)).results
    assert.deepEqual(results.map((option) => [option.label, option.count]), [['María López', 2], ['Juan Peres', 1]])
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((item) => item.label), ['María López'], '2 of 3 is a majority')
    assert.equal((await service.annulRound(round.id, 'otra vez')).status, 'annulled', 'annulling again is a no-op')
    await assert.rejects(service.repeatRound(repeat.id, { optionIds: [repeat.options[0]!.id] }), /anulada/, 'a counted vote is never repeated by hand')

    // Annulling a counted vote takes its elected out of the official result.
    await service.annulRound(repeat.id, 'Se contó con un error')
    assert.equal(await prisma.officialResult.count({ where: { roundId: round.id } }), 0)
    assert.equal('officialResult' in await service.publicState(joinCode), false)

    // Annulling a vote that prepared a runoff discards the runoff draft too; an earlier vote waits for the later one.
    const secretary = await service.createRound(assemblyId, {
      title: 'Secretaría', format: 'single_choice', options: [{ label: 'Rosa' }, { label: 'Pedro' }, { label: 'Elena' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(secretary.id)
    await service.castVote(voters[0]!, secretary.id, secretary.options[0]!.id)
    await service.castVote(voters[1]!, secretary.id, secretary.options[1]!.id)
    await service.closeRound(secretary.id)
    const runoff = await prisma.round.findFirstOrThrow({ where: { committeeRootRoundId: secretary.id }, include: { options: true } })
    assert.equal(runoff.status, 'draft')
    assert.deepEqual(runoff.options.map((option) => option.label).sort(), ['Pedro', 'Rosa'])
    await service.openRound(runoff.id)
    await assert.rejects(service.annulRound(secretary.id, 'tarde'), /votación posterior/)
    await service.annulRound(runoff.id, 'Se abrió por error')
    assert.equal((await service.annulRound(secretary.id, 'Faltó una candidata')).status, 'annulled')
    assert.equal(await prisma.round.count({ where: { committeeRootRoundId: secretary.id, status: 'draft' } }), 0)
    assert.equal(await prisma.auditEvent.count({ where: { roundId: secretary.id, action: 'round.runoff_discarded' } }), 0, 'the opened runoff was annulled, not discarded')
    const third = await service.createRound(assemblyId, {
      title: 'Tesorería', format: 'single_choice', options: [{ label: 'Iris' }, { label: 'Raúl' }], countingRule: { kind: 'count_only' },
    })
    await service.openRound(third.id)
    await service.closeRound(third.id)
    assert.equal(await prisma.round.count({ where: { committeeRootRoundId: third.id, status: 'draft' } }), 1, 'nobody voted: everyone goes to the runoff')
    await service.annulRound(third.id, 'No había quórum')
    assert.equal(await prisma.round.count({ where: { committeeRootRoundId: third.id } }), 0, 'its runoff draft is discarded')
    assert.equal(await prisma.auditEvent.count({ where: { roundId: third.id, action: 'round.runoff_discarded' } }), 1)
    assert.equal((await service.completeAssembly(assemblyId, true)).status, 'completed')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})
