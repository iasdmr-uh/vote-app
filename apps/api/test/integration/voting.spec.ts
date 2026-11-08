import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test, type TestContext } from 'node:test'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { removeOrganization } from '../support/seed.js'

async function openBallot(t: TestContext) {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const service = new VotingService(prisma, gateway)
  const organizationId = randomUUID()
  t.after(async () => {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  })
  const joinCode = newOpaqueCredential()
  await prisma.organization.create({ data: { id: organizationId, name: `voting-${organizationId}`, type: 'union' } })
  const { id: assemblyId } = await prisma.assembly.create({ data: { organizationId, name: 'Asamblea de delegados', status: 'in_progress', joinCodeHash: hashCredential(joinCode) } })
  const { id: delegate } = await prisma.participantSession.create({ data: { assemblyId, firstName: 'Ana', lastName: 'Reyes', tokenHash: hashCredential(newOpaqueCredential()) } })
  const round = await prisma.round.create({
    data: {
      assemblyId,
      title: 'Presidencia',
      countingRule: { kind: 'count_only' },
      status: 'open',
      openedAt: new Date(),
      options: { create: [{ label: 'María López', order: 0 }, { label: 'Juan Pérez', order: 1 }] },
    },
    include: { options: true },
  })
  const [maria, juan] = round.options.map((option) => option.id) as [string, string]
  return { prisma, service, events, joinCode, assemblyId, delegate, roundId: round.id, maria, juan }
}

async function publishedBallot(t: TestContext) {
  const ballot = await openBallot(t)
  await ballot.service.castVote(ballot.delegate, ballot.roundId, ballot.maria)
  await ballot.service.closeRound(ballot.roundId)
  const published = await ballot.service.publishRound(ballot.roundId)
  return { ...ballot, published }
}

const totalOf = (results: Array<{ count: number }> | undefined) => results?.reduce((sum, option) => sum + option.count, 0)

describe('a single-choice ballot', () => {
  test('castVote: two votes sent at once by one delegate record exactly one', async (t) => {
    const { prisma, service, delegate, roundId, maria, juan } = await openBallot(t)

    const attempts = await Promise.allSettled([service.castVote(delegate, roundId, maria), service.castVote(delegate, roundId, juan)])

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ConflictException)
    assert.equal(await prisma.participation.count({ where: { roundId } }), 1)
    assert.equal(await prisma.anonymousVote.count({ where: { roundId } }), 1)
  })

  test('participantState: after voting, the phone shows the vote as recorded without the choice', async (t) => {
    const { service, delegate, roundId, maria } = await openBallot(t)
    await service.castVote(delegate, roundId, maria)

    const phone = await service.participantState(delegate)

    assert.equal(phone.openRound?.roundId, roundId)
    assert.equal(phone.participationStatus, 'recorded')
    assert.equal('optionId' in (phone.openRound ?? {}), false)
  })

  test('closeRound: a closed ballot keeps the recorded vote and rejects new votes', async (t) => {
    const { service, delegate, roundId, maria } = await openBallot(t)
    await service.castVote(delegate, roundId, maria)

    await service.closeRound(roundId)

    const phone = await service.participantState(delegate)
    assert.equal(phone.openRound?.status, 'closed')
    assert.equal(phone.participationStatus, 'recorded')
    await assert.rejects(service.castVote(delegate, roundId, maria), ConflictException)
  })

  test('closeRound: the counts stay with the mesa until it publishes them', async (t) => {
    const { service, joinCode, assemblyId, delegate, roundId, maria } = await openBallot(t)
    await service.castVote(delegate, roundId, maria)

    await service.closeRound(roundId)

    const projector = await service.publicState(joinCode)
    assert.equal('results' in projector, false)
    assert.equal('officialResult' in projector, false)
    assert.equal('results' in await service.participantState(delegate), false)
    const mesaRound = (await service.moderatorAssembly(assemblyId)).rounds[0]
    assert.equal(totalOf(mesaRound?.privateResults), 1)
    assert.equal('results' in (mesaRound ?? {}), false)
  })

  test('publishRound: delegates and the projector see the counts and the elected option', async (t) => {
    const { service, joinCode, delegate, roundId, maria } = await openBallot(t)
    await service.castVote(delegate, roundId, maria)
    await service.closeRound(roundId)

    const published = await service.publishRound(roundId)

    assert.equal(published.status, 'published')
    assert.equal(totalOf(published.results), 1)
    const phone = await service.participantState(delegate)
    assert.equal(phone.openRound?.status, 'published')
    assert.equal(totalOf(phone.results), 1)
    const projector = await service.publicState(joinCode)
    assert.equal('results' in projector, true)
    assert.deepEqual(projector.officialResult?.elected, [{ optionId: maria, label: 'María López' }])
    assert.deepEqual(projector.outcome, { seats: 1, base: 1, threshold: 1, elected: [maria], runoff: [], openSeats: 0 })
  })

  test('publishRound: a filled seat keeps the result computed by the engine and prepares no runoff', async (t) => {
    const { prisma, service, assemblyId, roundId } = await publishedBallot(t)

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.deepEqual(mesa.rounds[0]?.officialResult?.elected.map((person) => person.label), ['María López'])
    assert.equal(mesa.rounds[0]?.officialResult?.declaredBy, 'results_engine')
    assert.equal(mesa.rounds.length, 1)
    assert.equal(await prisma.auditEvent.count({ where: { roundId, action: 'round.result_computed' } }), 1)
  })
})

describe('completing the assembly', () => {
  test('completeAssembly: an open ballot blocks completion', async (t) => {
    const { service, assemblyId } = await openBallot(t)

    await assert.rejects(service.completeAssembly(assemblyId, true), (error: unknown) =>
      error instanceof ConflictException && error.message.includes('Cierra la papeleta abierta'),
    )
  })

  test('completeAssembly: completion needs an explicit confirmation', async (t) => {
    const { service, assemblyId } = await publishedBallot(t)

    await assert.rejects(service.completeAssembly(assemblyId, false as true), UnprocessableEntityException)
  })

  test('completeAssembly: completing twice returns the same result and audits and notifies once', async (t) => {
    const { prisma, service, events, assemblyId } = await publishedBallot(t)

    const completed = await service.completeAssembly(assemblyId, true)
    const repeated = await service.completeAssembly(assemblyId, true)

    assert.deepEqual(repeated, completed)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'assembly.completed' } }), 1)
    const notices = events.filter((event) => event.name === 'assemblyState')
    assert.equal(notices.length, 1)
    assert.deepEqual(notices[0]?.payload, { status: 'completed', completedAt: completed.completedAt })
  })

  test('completeAssembly: a completed assembly rejects joins, ballots, votes, lobby changes and edits', async (t) => {
    const { service, joinCode, assemblyId, delegate, roundId, maria } = await publishedBallot(t)

    await service.completeAssembly(assemblyId, true)

    await assert.rejects(service.joinAssembly(joinCode, 'Luis', 'Mejía'), ConflictException)
    await assert.rejects(service.createRound(assemblyId, {
      title: 'Vocalía', format: 'single_choice', options: [{ label: 'Rosa Paz' }, { label: 'José Díaz' }], countingRule: { kind: 'count_only' },
    }), ConflictException)
    await assert.rejects(service.castVote(delegate, roundId, maria), ConflictException)
    await assert.rejects(service.changeLobby(assemblyId, 'lobby_closed'), ConflictException)
    await assert.rejects(service.patchParticipant(delegate, { firstName: 'Anabel' }), ConflictException)
  })

  test('completeAssembly: every view reports the completion and keeps the published results', async (t) => {
    const { service, joinCode, assemblyId, delegate, published } = await publishedBallot(t)

    const { completedAt } = await service.completeAssembly(assemblyId, true)

    const phone = await service.participantState(delegate)
    assert.equal(phone.assemblyStatus, 'completed')
    assert.equal(phone.assemblyCompletedAt, completedAt)
    const projector = await service.publicState(joinCode)
    assert.equal(projector.assembly.status, 'completed')
    assert.equal(projector.assembly.completedAt, completedAt)
    assert.deepEqual(projector.results, published.results)
    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.status, 'completed')
    assert.equal(mesa.completedAt, completedAt)
  })
})

const candidates = ['Ana Reyes', 'Luis Mejía', 'Rosa Paz', 'José Díaz', 'Carlos Ruiz']

async function committeeElection(t: TestContext) {
  const prisma = await connectDatabase()
  const service = new VotingService(prisma, gatewayStub().gateway)
  const organizationId = randomUUID()
  t.after(async () => {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  })
  const joinCode = newOpaqueCredential()
  await prisma.organization.create({ data: { id: organizationId, name: `committee-${organizationId}`, type: 'union' } })
  const { id: assemblyId } = await prisma.assembly.create({ data: { organizationId, name: 'Asamblea de delegados', status: 'lobby_closed', joinCodeHash: hashCredential(joinCode) } })
  const delegates: string[] = []
  for (let index = 0; index < 6; index += 1) {
    const session = await prisma.participantSession.create({ data: {
      assemblyId, firstName: `Delegado${index}`, lastName: 'Sánchez', tokenHash: hashCredential(newOpaqueCredential()), joinedAt: new Date(Date.now() + index),
    } })
    delegates.push(session.id)
  }
  const round = await service.createRound(assemblyId, {
    title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 3, countingRule: { kind: 'count_only' },
    options: candidates.map((label) => ({ label })),
  })
  const id = (options: Array<{ id: string; label: string }>, label: string) => options.find((option) => option.label === label)!.id
  const vote = (delegate: number, roundId: string, options: Array<{ id: string; label: string }>, labels: string[]) =>
    service.castVote(delegates[delegate]!, roundId, labels.map((label) => id(options, label)))
  const runoffAfter = async (roundId: string) => (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.runoffSourceRoundId === roundId)!

  const castFirstVote = async () => {
    await service.openRound(round.id)
    await vote(0, round.id, round.options, ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    await vote(1, round.id, round.options, ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    await vote(2, round.id, round.options, ['Ana Reyes', 'Luis Mejía', 'José Díaz'])
    await vote(3, round.id, round.options, ['Ana Reyes', 'Rosa Paz', 'José Díaz'])
    await vote(4, round.id, round.options, ['Ana Reyes', 'Carlos Ruiz', 'José Díaz'])
  }
  const openSecondVote = async () => {
    await castFirstVote()
    await service.closeRound(round.id)
    await service.publishRound(round.id)
    const runoff = await runoffAfter(round.id)
    await service.openRound(runoff.id)
    return runoff
  }
  const castSecondVote = async () => {
    const runoff = await openSecondVote()
    await vote(0, runoff.id, runoff.options, ['Luis Mejía', 'Rosa Paz'])
    await vote(1, runoff.id, runoff.options, ['Luis Mejía', 'Rosa Paz'])
    await vote(2, runoff.id, runoff.options, ['Luis Mejía', 'José Díaz'])
    await vote(3, runoff.id, runoff.options, ['Luis Mejía', 'José Díaz'])
    await vote(4, runoff.id, runoff.options, ['Rosa Paz', 'José Díaz'])
    await service.closeRound(runoff.id)
    return runoff
  }
  const openThirdVote = async () => {
    const second = await castSecondVote()
    await service.publishRound(second.id)
    const runoff = await runoffAfter(second.id)
    await service.openRound(runoff.id)
    return runoff
  }

  return { prisma, service, joinCode, assemblyId, delegates, round, id, vote, runoffAfter, castFirstVote, openSecondVote, castSecondVote, openThirdVote }
}

const electedOn = async (service: VotingService, joinCode: string) => (await service.publicState(joinCode)).officialResult?.elected.map((person) => person.label)

describe('a committee election for 3 seats with 6 enabled delegates', () => {
  test('createRound: typed candidates keep ballot order and the mesa shows no attendance yet', async (t) => {
    const { service, assemblyId, round } = await committeeElection(t)

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.deepEqual(round.options.map((option) => option.label), candidates)
    assert.equal(mesa.attendanceRound, null)
  })

  test('castVote: a delegate must mark exactly as many names as open seats', async (t) => {
    const { service, delegates, round, vote } = await committeeElection(t)
    await service.openRound(round.id)

    const phone = await service.participantState(delegates[0]!)

    assert.equal(phone.openRound?.electionSeats, 3)
    await assert.rejects(vote(0, round.id, round.options, ['Ana Reyes', 'Luis Mejía', 'Rosa Paz', 'José Díaz']), /exactamente 3 nombres/)
    await assert.rejects(vote(0, round.id, round.options, ['Ana Reyes', 'Luis Mejía']), /exactamente 3 nombres/)
  })

  test('castVote: each marked name is stored as a vote with no link to the delegate', async (t) => {
    const { prisma, round, castFirstVote } = await committeeElection(t)

    await castFirstVote()

    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 15)
    assert.equal('participantSessionId' in ((await prisma.anonymousVote.findFirst({ where: { roundId: round.id } })) ?? {}), false)
  })

  test('moderatorAssembly: while the ballot is open the mesa sees who voted, never for whom', async (t) => {
    const { service, assemblyId, round, id, castFirstVote } = await committeeElection(t)
    await castFirstVote()

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.deepEqual(mesa.participants.map((person) => person.voted), [true, true, true, true, true, false])
    assert.deepEqual(mesa.attendanceRound, { roundId: round.id, status: 'open', votedCount: 5, eligibleCount: 6 })
    assert.equal(JSON.stringify(mesa.participants).includes(id(round.options, 'Ana Reyes')), false)
  })

  test('closeRound: a majority of 4 elects Ana, and Luis, Rosa and José tied at the cut go to a runoff', async (t) => {
    const { service, assemblyId, round, id, castFirstVote } = await committeeElection(t)
    await castFirstVote()

    await service.closeRound(round.id)

    const mesa = await service.moderatorAssembly(assemblyId)
    const first = mesa.rounds.find((item) => item.id === round.id)!
    assert.deepEqual(first.outcome, {
      seats: 3, base: 6, threshold: 4,
      elected: [id(round.options, 'Ana Reyes')],
      runoff: ['Luis Mejía', 'Rosa Paz', 'José Díaz'].map((label) => id(round.options, label)),
      openSeats: 2,
    })
    assert.deepEqual(first.officialResult?.elected.map((person) => person.label), ['Ana Reyes'])
    assert.deepEqual(mesa.participants.map((person) => person.voted), [true, true, true, true, true, false])
  })

  test('closeRound: the runoff is prepared as a draft for 2 seats with only the tied candidates', async (t) => {
    const { service, joinCode, assemblyId, round, runoffAfter, castFirstVote } = await committeeElection(t)
    await castFirstVote()

    await service.closeRound(round.id)

    const runoff = await runoffAfter(round.id)
    assert.equal(runoff.status, 'draft')
    assert.equal(runoff.committeeRootRoundId, round.id)
    assert.equal(runoff.title, 'Comisión de Finanzas')
    assert.equal(runoff.electionSeats, 2)
    assert.equal(runoff.voteNumber, 2)
    assert.equal(runoff.runoff, true)
    assert.deepEqual(runoff.options.map((option) => option.label), ['Luis Mejía', 'Rosa Paz', 'José Díaz'])
    assert.equal((await service.moderatorAssembly(assemblyId)).currentRound?.id, round.id)
    const projector = await service.publicState(joinCode)
    assert.equal('results' in projector, false)
    assert.equal('officialResult' in projector, false)
  })

  test('publishRound: every candidate is ranked by votes and the projector shows the same ranking', async (t) => {
    const { service, joinCode, round, id, castFirstVote } = await committeeElection(t)
    await castFirstVote()
    await service.closeRound(round.id)

    const { results } = await service.publishRound(round.id)

    assert.deepEqual(results.map((option) => [option.label, option.count]), [['Ana Reyes', 5], ['Luis Mejía', 3], ['Rosa Paz', 3], ['José Díaz', 3], ['Carlos Ruiz', 1]])
    const projector = await service.publicState(joinCode)
    assert.deepEqual(projector.results?.map((option) => option.label), results.map((option) => option.label))
    assert.deepEqual(projector.outcome?.elected, [id(round.options, 'Ana Reyes')])
    assert.deepEqual(projector.outcome?.runoff, ['Luis Mejía', 'Rosa Paz', 'José Díaz'].map((label) => id(round.options, label)))
    assert.deepEqual(projector.officialResult?.elected.map((person) => person.label), ['Ana Reyes'])
  })

  test('openRound: opening the second vote resets the dots and asks for 2 names', async (t) => {
    const { service, assemblyId, delegates, vote, openSecondVote } = await committeeElection(t)

    const runoff = await openSecondVote()

    assert.deepEqual((await service.moderatorAssembly(assemblyId)).participants.map((person) => person.voted), [false, false, false, false, false, false])
    const phone = await service.participantState(delegates[0]!)
    assert.equal(phone.openRound?.electionSeats, 2)
    assert.equal(phone.openRound?.voteNumber, 2)
    assert.equal(phone.openRound?.runoff, true)
    await assert.rejects(vote(0, runoff.id, runoff.options, ['Luis Mejía']), /exactamente 2 nombres/)
    await assert.rejects(vote(0, runoff.id, runoff.options, ['Luis Mejía', 'Rosa Paz', 'José Díaz']), /exactamente 2 nombres/)
  })

  test('publishRound: the second vote elects Luis only once it is published', async (t) => {
    const { service, joinCode, castSecondVote } = await committeeElection(t)
    const runoff = await castSecondVote()
    assert.deepEqual(await electedOn(service, joinCode), ['Ana Reyes'])

    await service.publishRound(runoff.id)

    assert.deepEqual(await electedOn(service, joinCode), ['Ana Reyes', 'Luis Mejía'])
  })

  test('closeRound: the second vote sends Rosa and José, tied at 3, to a third vote for 1 seat', async (t) => {
    const { round, runoffAfter, castSecondVote } = await committeeElection(t)

    const second = await castSecondVote()

    const third = await runoffAfter(second.id)
    assert.equal(third.committeeRootRoundId, round.id)
    assert.equal(third.electionSeats, 1)
    assert.equal(third.voteNumber, 3)
    assert.deepEqual(third.options.map((option) => option.label), ['Rosa Paz', 'José Díaz'])
  })

  test('castVote: the third vote takes exactly 1 name', async (t) => {
    const { vote, openThirdVote } = await committeeElection(t)

    const runoff = await openThirdVote()

    await assert.rejects(vote(0, runoff.id, runoff.options, ['Rosa Paz', 'José Díaz']), /exactamente 1 nombre/)
  })

  test('publishRound: Rosa with 4 of 6 completes the committee and no further runoff is prepared', async (t) => {
    const { prisma, service, joinCode, assemblyId, round, vote, openThirdVote } = await committeeElection(t)
    const runoff = await openThirdVote()
    for (const delegate of [0, 1, 2, 3]) await vote(delegate, runoff.id, runoff.options, ['Rosa Paz'])
    await vote(4, runoff.id, runoff.options, ['José Díaz'])
    await service.closeRound(runoff.id)

    await service.publishRound(runoff.id)

    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.rounds.length, 3)
    assert.deepEqual(mesa.rounds.find((item) => item.id === round.id)?.officialResult?.elected.map((person) => person.label), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    assert.deepEqual(await electedOn(service, joinCode), ['Ana Reyes', 'Luis Mejía', 'Rosa Paz'])
    assert.equal(await prisma.auditEvent.count({ where: { round: { OR: [{ id: round.id }, { committeeRootRoundId: round.id }] }, action: 'round.result_computed' } }), 3)
  })
})
