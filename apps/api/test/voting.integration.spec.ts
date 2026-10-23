import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('database voting flow: unique concurrent cast, close gate, then explicit publish', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const organizationId = randomUUID()
  const joinCode = newOpaqueCredential()
  const token = newOpaqueCredential()
  const noOp = () => undefined
  const realtimeEvents: Array<{ name: string; payload: unknown }> = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    if (name === 'assemblyState') realtimeEvents.push({ name: String(name), payload: args[1] })
    return noOp()
  } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `test-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({
      data: {
        organizationId: organization.id,
        name: 'Integration test',
        status: 'in_progress',
        joinCodeHash: hashCredential(joinCode),
      },
    })
    assemblyId = assembly.id
    const participant = await prisma.participantSession.create({
      data: { assemblyId, firstName: 'Test', lastName: 'Participant', tokenHash: hashCredential(token) },
    })
    const round = await prisma.round.create({
      data: {
        assemblyId,
        title: 'Integration test ballot',
        countingRule: { kind: 'count_only' },
        status: 'open',
        openedAt: new Date(),
        options: { create: [{ label: 'Option A', order: 0 }, { label: 'Option B', order: 1 }] },
      },
      include: { options: true },
    })

    await assert.rejects(service.completeAssembly(assemblyId, true), (error: unknown) =>
      error instanceof ConflictException && error.message.includes('Cierra la papeleta abierta'),
    )

    const duplicateAttempts = await Promise.allSettled([
      service.castVote(participant.id, round.id, round.options[0].id),
      service.castVote(participant.id, round.id, round.options[1].id),
    ])
    assert.equal(duplicateAttempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
    const rejected = duplicateAttempts.find((attempt) => attempt.status === 'rejected')
    assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ConflictException)
    assert.equal(await prisma.participation.count({ where: { roundId: round.id } }), 1)
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 1)

    const snapshot = await service.participantState(participant.id)
    assert.equal(snapshot.openRound?.roundId, round.id)
    assert.equal(snapshot.participationStatus, 'recorded')
    assert.equal('optionId' in (snapshot.openRound ?? {}), false)

    await service.closeRound(round.id)
    const closedSnapshot = await service.participantState(participant.id)
    assert.equal(closedSnapshot.openRound?.status, 'closed')
    assert.equal(closedSnapshot.participationStatus, 'recorded')
    await assert.rejects(service.castVote(participant.id, round.id, round.options[0].id), ConflictException)
    const hidden = await service.publicState(joinCode)
    assert.equal('results' in hidden, false)
    assert.equal('results' in closedSnapshot, false, 'delegates do not see counts before publication')
    const closedModeratorRound = (await service.moderatorAssembly(assemblyId)).rounds[0]
    assert.equal(closedModeratorRound?.privateResults?.reduce((sum, option) => sum + option.count, 0), 1, 'the mesa reviews the counts before publishing')
    assert.equal('results' in (closedModeratorRound ?? {}), false)

    const published = await service.publishRound(round.id)
    assert.equal(published.status, 'published')
    assert.equal(published.results.reduce((sum, option) => sum + option.count, 0), 1)
    const publishedSnapshot = await service.participantState(participant.id)
    assert.equal(publishedSnapshot.openRound?.status, 'published')
    assert.equal(publishedSnapshot.results?.reduce((sum, option) => sum + option.count, 0), 1)
    const visible = await service.publicState(joinCode)
    assert.equal('results' in visible, true)
    assert.equal('officialResult' in visible, false, 'publishing vote counts must not declare a winner')

    const declared = await service.declareOfficialResult(round.id, { optionIds: [round.options[0].id], note: 'Decisión de la mesa' })
    assert.deepEqual(declared.elected, [{ optionId: round.options[0].id, label: 'Option A' }])
    assert.equal(declared.publishedAt, null)
    assert.equal('officialResult' in await service.publicState(joinCode), false, 'an unpublished declaration stays private')
    const moderatorView = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(moderatorView.rounds[0]?.officialResult?.elected, declared.elected)
    assert.equal(moderatorView.rounds[0]?.officialResult?.declaredBy, 'shared_moderator_credential')
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.official_result.declared' } }), 1)

    await service.publishOfficialResult(round.id)
    const publiclyDeclared = await service.publicState(joinCode)
    assert.deepEqual(publiclyDeclared.officialResult?.elected, declared.elected)

    const corrected = await service.declareOfficialResult(round.id, { optionIds: [round.options[1].id], note: 'Corrección de acta' })
    assert.equal(corrected.publishedAt, null, 'a correction requires a fresh explicit publication')
    assert.equal('officialResult' in await service.publicState(joinCode), false)
    await service.publishOfficialResult(round.id)
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected, [{ optionId: round.options[1].id, label: 'Option B' }])
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.official_result.corrected' } }), 1)
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.official_result.published' } }), 2)

    await assert.rejects(service.completeAssembly(assemblyId, false as true), (error: unknown) =>
      error instanceof UnprocessableEntityException,
    )
    const completed = await service.completeAssembly(assemblyId, true)
    const repeatedCompletion = await service.completeAssembly(assemblyId, true)
    assert.deepEqual(repeatedCompletion, completed)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'assembly.completed' } }), 1)
    assert.equal(realtimeEvents.length, 1)
    assert.deepEqual(realtimeEvents[0]?.payload, { status: 'completed', completedAt: completed.completedAt })

    await assert.rejects(service.joinAssembly(joinCode, 'Late', 'Join'), ConflictException)
    await assert.rejects(service.createRound(assemblyId, {
      title: 'Late ballot', format: 'single_choice', options: [{ label: 'A' }, { label: 'B' }], countingRule: { kind: 'count_only' },
    }), ConflictException)
    await assert.rejects(service.castVote(participant.id, round.id, round.options[0].id), ConflictException)
    await assert.rejects(service.changeLobby(assemblyId, 'lobby_closed'), ConflictException)
    await assert.rejects(service.patchParticipant(participant.id, { firstName: 'Changed' }), ConflictException)

    const completedParticipantState = await service.participantState(participant.id)
    assert.equal(completedParticipantState.assemblyStatus, 'completed')
    assert.equal(completedParticipantState.assemblyCompletedAt, completed.completedAt)
    const completedPublicState = await service.publicState(joinCode)
    assert.equal(completedPublicState.assembly.status, 'completed')
    assert.equal(completedPublicState.assembly.completedAt, completed.completedAt)
    assert.deepEqual(completedPublicState.results, published.results)
    const completedModeratorState = await service.moderatorAssembly(assemblyId)
    assert.equal(completedModeratorState.status, 'completed')
    assert.equal(completedModeratorState.completedAt, completed.completedAt)

    const postCompletionCorrection = await service.declareOfficialResult(round.id, {
      optionIds: [round.options[0].id, round.options[1].id], note: 'La mesa confirma dos personas electas',
    })
    assert.equal(postCompletionCorrection.publishedAt, null)
    assert.equal('officialResult' in await service.publicState(joinCode), false)
    await service.publishOfficialResult(round.id)
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((item) => item.label), ['Option A', 'Option B'])
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.official_result.corrected' } }), 2)
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

test('database committee flow: delegates mark 1..N typed names, the mesa sees who voted, ranks without electing anyone, repeats and declares', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const organizationId = randomUUID()
  const joinCode = newOpaqueCredential()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  let assemblyId: string | undefined
  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `committee-test-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Committee integration', status: 'lobby_closed', joinCodeHash: hashCredential(joinCode) } })
    const activeAssemblyId = assembly.id
    assemblyId = activeAssemblyId
    // One by one, so the mesa's list (ordered by arrival) matches this array.
    const delegates = []
    for (let index = 0; index < 6; index += 1) delegates.push(await prisma.participantSession.create({ data: {
      assemblyId: activeAssemblyId, firstName: `Delegate${index}`, lastName: 'Person', tokenHash: hashCredential(newOpaqueCredential()), joinedAt: new Date(Date.now() + index),
    } }))
    // Candidates are typed names, as for an office; they need not be in the room.
    const round = await service.createRound(activeAssemblyId, {
      title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 3, countingRule: { kind: 'count_only' },
      options: ['Ana Reyes', 'Luis Mejía', 'Rosa Paz', 'José Díaz', 'Carlos Ruiz'].map((label) => ({ label })),
    })
    assert.deepEqual(round.options.map((option) => option.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz', 'José Díaz', 'Carlos Ruiz'])
    assert.equal((await service.moderatorAssembly(activeAssemblyId)).attendanceRound, null, 'a prepared ballot shows no dots yet')
    await service.openRound(round.id)
    const phone = await service.participantState(delegates[0]!.id)
    assert.equal(phone.openRound?.electionSeats, 3, 'the phone knows how many names it may mark')
    await assert.rejects(service.castVote(delegates[0]!.id, round.id, round.options.slice(0, 4).map((option) => option.id)), /como máximo 3 nombres/)
    const [ana, luis, rosa, jose] = round.options
    await service.castVote(delegates[0]!.id, round.id, [ana!.id, luis!.id, rosa!.id])
    await service.castVote(delegates[1]!.id, round.id, [ana!.id, luis!.id])
    await service.castVote(delegates[2]!.id, round.id, [ana!.id])
    await service.castVote(delegates[3]!.id, round.id, [jose!.id, rosa!.id])
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 8)
    assert.equal('participantSessionId' in ((await prisma.anonymousVote.findFirst({ where: { roundId: round.id } })) ?? {}), false)

    const whileOpen = await service.moderatorAssembly(activeAssemblyId)
    assert.deepEqual(whileOpen.participants.map((person) => person.voted), [true, true, true, true, false, false])
    assert.deepEqual(whileOpen.attendanceRound, { roundId: round.id, status: 'open', votedCount: 4 })
    assert.equal(JSON.stringify(whileOpen.participants).includes(ana!.id), false, 'the list says who voted, never for whom')

    await service.closeRound(round.id)
    assert.deepEqual((await service.moderatorAssembly(activeAssemblyId)).participants.map((person) => person.voted), [true, true, true, true, false, false], 'dots stay after closing')
    assert.equal('results' in await service.publicState(joinCode), false)
    const ranked = (await service.publishRound(round.id)).results
    assert.deepEqual(ranked.map((option) => [option.label, option.count]), [['Ana Reyes', 3], ['Luis Mejía', 2], ['Rosa Paz', 2], ['José Díaz', 1], ['Carlos Ruiz', 0]], 'every candidate, most voted first')
    assert.deepEqual((await service.publicState(joinCode)).results?.map((option) => option.label), ranked.map((option) => option.label), 'the projector shows the same ranking')
    assert.equal('officialResult' in await service.publicState(joinCode), false, 'closing and publishing elect no one')

    // Luis and Rosa tie for the last seat; the mesa repeats the vote between them for one seat.
    const repeat = await service.repeatRound(round.id, { optionIds: [luis!.id, rosa!.id], seats: 1 })
    assert.equal(repeat.committeeRootRoundId, round.id)
    assert.deepEqual(repeat.options.map((option) => option.label), ['Luis Mejía', 'Rosa Paz'], 'nothing is added to the repeated ballot')
    await service.openRound(repeat.id)
    assert.deepEqual((await service.moderatorAssembly(activeAssemblyId)).participants.map((person) => person.voted), [false, false, false, false, false, false], 'opening the next ballot resets the dots')
    await assert.rejects(service.castVote(delegates[0]!.id, repeat.id, [repeat.options[0]!.id, repeat.options[1]!.id]), /como máximo 1 nombre/)
    await service.castVote(delegates[0]!.id, repeat.id, [repeat.options[0]!.id])
    await service.castVote(delegates[1]!.id, repeat.id, [repeat.options[0]!.id])
    await service.castVote(delegates[2]!.id, repeat.id, [repeat.options[1]!.id])
    await assert.rejects(service.declareOfficialResult(round.id, { optionIds: [ana!.id, luis!.id, rosa!.id] }), /Cierra la votación abierta/)
    await service.closeRound(repeat.id)
    const repeatResults = (await service.publishRound(repeat.id)).results
    assert.deepEqual(repeatResults.map((option) => [option.label, option.count]), [['Luis Mejía', 2], ['Rosa Paz', 1]])
    await assert.rejects(service.declareOfficialResult(repeat.id, { optionIds: [repeat.options[0]!.id] }), /papeleta original/)
    await assert.rejects(service.declareOfficialResult(round.id, { optionIds: [ana!.id, luis!.id] }), /exactamente 3 integrantes/)

    const declared = await service.declareOfficialResult(round.id, { optionIds: [ana!.id, luis!.id, jose!.id], note: 'Composición aprobada por la mesa' })
    assert.equal(declared.publishedAt, null)
    assert.equal('officialResult' in await service.publicState(joinCode), false)
    await service.publishOfficialResult(round.id)
    assert.equal((await service.publicState(joinCode)).officialResult?.elected.length, 3, 'the declaration on the original ballot is shown with the repeated vote')
    assert.equal(await prisma.auditEvent.count({ where: { roundId: repeat.id, action: 'round.repeated' } }), 1)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.participantSession.deleteMany({ where: { assembly: { organizationId } } })
    await prisma.assembly.deleteMany({ where: { organizationId } })
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})
