import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import type { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'

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
    // One delegate of one voted: a majority, so closing elected that option and publishing shows it.
    const winner = published.results.find((option) => option.count === 1)!
    assert.deepEqual(visible.officialResult?.elected, [{ optionId: winner.optionId, label: winner.label }])
    assert.deepEqual(visible.outcome, { seats: 1, base: 1, threshold: 1, elected: [winner.optionId], runoff: [], openSeats: 0 })
    assert.equal('officialResult' in hidden, false, 'a closed, unpublished result stays with the mesa')
    const moderatorView = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(moderatorView.rounds[0]?.officialResult?.elected.map((person) => person.label), [winner.label])
    assert.equal(moderatorView.rounds[0]?.officialResult?.declaredBy, 'results_engine')
    assert.equal(moderatorView.rounds.length, 1, 'every seat is filled: no runoff is prepared')
    assert.equal(await prisma.auditEvent.count({ where: { roundId: round.id, action: 'round.result_computed' } }), 1)

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

test('database committee flow: the mesa sees who voted, closing elects by majority and chains two runoffs until the committee is complete', {
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
    const delegates: Array<{ id: string }> = []
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
    assert.equal(phone.openRound?.electionSeats, 3, 'the phone knows how many names it must mark')
    await assert.rejects(service.castVote(delegates[0]!.id, round.id, round.options.slice(0, 4).map((option) => option.id)), /exactamente 3 nombres/)
    const [ana, luis, rosa, jose, carlos] = round.options
    await assert.rejects(service.castVote(delegates[0]!.id, round.id, [ana!.id, luis!.id]), /exactamente 3 nombres/, 'fewer than the open seats is rejected too')
    const vote = (index: number, roundId: string, options: Array<{ id: string } | undefined>) => service.castVote(delegates[index]!.id, roundId, options.map((option) => option!.id))
    await vote(0, round.id, [ana, luis, rosa])
    await vote(1, round.id, [ana, luis, rosa])
    await vote(2, round.id, [ana, luis, jose])
    await vote(3, round.id, [ana, rosa, jose])
    await vote(4, round.id, [ana, carlos, jose])
    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 15)
    assert.equal('participantSessionId' in ((await prisma.anonymousVote.findFirst({ where: { roundId: round.id } })) ?? {}), false)

    const whileOpen = await service.moderatorAssembly(activeAssemblyId)
    assert.deepEqual(whileOpen.participants.map((person) => person.voted), [true, true, true, true, true, false])
    assert.deepEqual(whileOpen.attendanceRound, { roundId: round.id, status: 'open', votedCount: 5, eligibleCount: 6 })
    assert.equal(JSON.stringify(whileOpen.participants).includes(ana!.id), false, 'the list says who voted, never for whom')

    // Ana 5, Luis 3, Rosa 3, José 3, Carlos 1 over 6 enabled: majority is 4. Ana is elected; Luis, Rosa
    // and José tie at the cut, so all three go to a runoff for the 2 open seats.
    await service.closeRound(round.id)
    const closed = await service.moderatorAssembly(activeAssemblyId)
    assert.deepEqual(closed.participants.map((person) => person.voted), [true, true, true, true, true, false], 'dots stay after closing')
    const first = closed.rounds.find((item) => item.id === round.id)!
    assert.deepEqual(first.outcome, { seats: 3, base: 6, threshold: 4, elected: [ana!.id], runoff: [luis!.id, rosa!.id, jose!.id], openSeats: 2 })
    assert.deepEqual(first.officialResult?.elected.map((person) => person.label), ['Ana Reyes'])
    const runoff1 = closed.rounds.find((item) => item.runoffSourceRoundId === round.id)!
    assert.equal(runoff1.status, 'draft')
    assert.equal(runoff1.committeeRootRoundId, round.id)
    assert.equal(runoff1.title, 'Comisión de Finanzas')
    assert.equal(runoff1.electionSeats, 2)
    assert.equal(runoff1.voteNumber, 2)
    assert.equal(runoff1.runoff, true)
    assert.deepEqual(runoff1.options.map((option) => option.label), ['Luis Mejía', 'Rosa Paz', 'José Díaz'], 'only the candidates that pass, in ballot order')
    assert.equal(closed.currentRound?.id, round.id, 'the mesa keeps the closed vote in front until it opens the runoff')
    assert.equal('results' in await service.publicState(joinCode), false)
    assert.equal('officialResult' in await service.publicState(joinCode), false, 'nothing is public before publishing')

    const ranked = (await service.publishRound(round.id)).results
    assert.deepEqual(ranked.map((option) => [option.label, option.count]), [['Ana Reyes', 5], ['Luis Mejía', 3], ['Rosa Paz', 3], ['José Díaz', 3], ['Carlos Ruiz', 1]], 'every candidate, most voted first')
    const projector = await service.publicState(joinCode)
    assert.deepEqual(projector.results?.map((option) => option.label), ranked.map((option) => option.label), 'the projector shows the same ranking')
    assert.deepEqual(projector.outcome?.elected, [ana!.id])
    assert.deepEqual(projector.outcome?.runoff, [luis!.id, rosa!.id, jose!.id])
    assert.deepEqual(projector.officialResult?.elected.map((person) => person.label), ['Ana Reyes'])

    // 2nd vote, for 2 seats: Luis 4 is elected; Rosa and José tie at 3 and go to a 3rd vote for 1 seat.
    await service.openRound(runoff1.id)
    assert.deepEqual((await service.moderatorAssembly(activeAssemblyId)).participants.map((person) => person.voted), [false, false, false, false, false, false], 'opening the next ballot resets the dots')
    const runoffPhone = await service.participantState(delegates[0]!.id)
    assert.equal(runoffPhone.openRound?.electionSeats, 2)
    assert.equal(runoffPhone.openRound?.voteNumber, 2)
    assert.equal(runoffPhone.openRound?.runoff, true)
    const [luis2, rosa2, jose2] = runoff1.options
    await assert.rejects(vote(0, runoff1.id, [luis2]), /exactamente 2 nombres/, 'a runoff takes exactly its open seats')
    await assert.rejects(vote(0, runoff1.id, [luis2, rosa2, jose2]), /exactamente 2 nombres/)
    await vote(0, runoff1.id, [luis2, rosa2])
    await vote(1, runoff1.id, [luis2, rosa2])
    await vote(2, runoff1.id, [luis2, jose2])
    await vote(3, runoff1.id, [luis2, jose2])
    await vote(4, runoff1.id, [rosa2, jose2])
    await service.closeRound(runoff1.id)
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((person) => person.label), ['Ana Reyes'], 'Luis appears once the 2nd vote is published')
    await service.publishRound(runoff1.id)
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((person) => person.label), ['Ana Reyes', 'Luis Mejía'])
    const afterSecond = await service.moderatorAssembly(activeAssemblyId)
    const runoff2 = afterSecond.rounds.find((item) => item.runoffSourceRoundId === runoff1.id)!
    assert.equal(runoff2.committeeRootRoundId, round.id, 'every runoff hangs from the first vote')
    assert.equal(runoff2.electionSeats, 1)
    assert.equal(runoff2.voteNumber, 3)
    assert.deepEqual(runoff2.options.map((option) => option.label), ['Rosa Paz', 'José Díaz'])

    // 3rd vote: Rosa 4 of 6 completes the committee; no further runoff is prepared.
    await service.openRound(runoff2.id)
    const [rosa3, jose3] = runoff2.options
    await assert.rejects(vote(0, runoff2.id, [rosa3, jose3]), /exactamente 1 nombre/)
    for (const index of [0, 1, 2, 3]) await vote(index, runoff2.id, [rosa3])
    await vote(4, runoff2.id, [jose3])
    await service.closeRound(runoff2.id)
    await service.publishRound(runoff2.id)
    const final = await service.moderatorAssembly(activeAssemblyId)
    assert.equal(final.rounds.length, 3)
    assert.deepEqual(final.rounds.find((item) => item.id === round.id)?.officialResult?.elected.map((person) => person.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((person) => person.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    assert.equal(await prisma.auditEvent.count({ where: { round: { OR: [{ id: round.id }, { committeeRootRoundId: round.id }] }, action: 'round.result_computed' } }), 3)
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
