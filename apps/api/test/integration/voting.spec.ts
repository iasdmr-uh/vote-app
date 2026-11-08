import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test, type TestContext } from 'node:test'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { removeOrganization } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

async function openBallot(t: TestContext) {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const { voting: service, room } = buildProviders(prisma, gateway)
  const organizationId = randomUUID()
  t.after(async () => {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  })
  const joinCode = newOpaqueCredential()
  await prisma.organization.create({ data: { id: organizationId, name: `voting-${organizationId}`, type: 'union' } })
  const { id: assemblyId } = await prisma.assembly.create({ data: { organizationId, name: 'Asamblea de delegados', status: 'in_progress', joinCodeHash: hashCredential(joinCode) } })
  const { id: delegate } = await prisma.participantSession.create({ data: { assemblyId, firstName: 'Delegado', lastName: '01', tokenHash: hashCredential(newOpaqueCredential()) } })
  const round = await prisma.round.create({
    data: {
      assemblyId,
      title: 'Presidencia',
      countingRule: { kind: 'count_only' },
      status: 'open',
      openedAt: new Date(),
      options: { create: [{ label: 'Samuel', order: 0 }, { label: 'Natán', order: 1 }] },
    },
    include: { options: true },
  })
  const [samuel, natan] = round.options.map((option) => option.id) as [string, string]
  return { prisma, service, room, events, joinCode, assemblyId, delegate, roundId: round.id, samuel, natan }
}

async function publishedBallot(t: TestContext) {
  const ballot = await openBallot(t)
  await ballot.service.castVote(ballot.delegate, ballot.roundId, ballot.samuel)
  await ballot.service.closeRound(ballot.roundId)
  const published = await ballot.service.publishRound(ballot.roundId)
  return { ...ballot, published }
}

const totalOf = (results: Array<{ count: number }> | undefined) => results?.reduce((sum, option) => sum + option.count, 0)

describe('a single-choice ballot', () => {
  test('castVote: two votes sent at once by one delegate record exactly one', async (t) => {
    const { prisma, service, delegate, roundId, samuel, natan } = await openBallot(t)

    const attempts = await Promise.allSettled([service.castVote(delegate, roundId, samuel), service.castVote(delegate, roundId, natan)])

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ConflictException)
    assert.equal(await prisma.participation.count({ where: { roundId } }), 1)
    assert.equal(await prisma.anonymousVote.count({ where: { roundId } }), 1)
  })

  test('participantState: after voting, the phone shows the vote as recorded without the choice', async (t) => {
    const { service, delegate, roundId, samuel } = await openBallot(t)
    await service.castVote(delegate, roundId, samuel)

    const phone = await service.participantState(delegate)

    assert.equal(phone.openRound?.roundId, roundId)
    assert.equal(phone.participationStatus, 'recorded')
    assert.equal('optionId' in (phone.openRound ?? {}), false)
  })

  test('closeRound: a closed ballot keeps the recorded vote and rejects new votes', async (t) => {
    const { service, delegate, roundId, samuel } = await openBallot(t)
    await service.castVote(delegate, roundId, samuel)

    await service.closeRound(roundId)

    const phone = await service.participantState(delegate)
    assert.equal(phone.openRound?.status, 'closed')
    assert.equal(phone.participationStatus, 'recorded')
    await assert.rejects(service.castVote(delegate, roundId, samuel), ConflictException)
  })

  test('closeRound: the counts stay with the mesa until it publishes them', async (t) => {
    const { service, joinCode, assemblyId, delegate, roundId, samuel } = await openBallot(t)
    await service.castVote(delegate, roundId, samuel)

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
    const { service, joinCode, delegate, roundId, samuel } = await openBallot(t)
    await service.castVote(delegate, roundId, samuel)
    await service.closeRound(roundId)

    const published = await service.publishRound(roundId)

    assert.equal(published.status, 'published')
    assert.equal(totalOf(published.results), 1)
    const phone = await service.participantState(delegate)
    assert.equal(phone.openRound?.status, 'published')
    assert.equal(totalOf(phone.results), 1)
    const projector = await service.publicState(joinCode)
    assert.equal('results' in projector, true)
    assert.deepEqual(projector.officialResult?.elected, [{ optionId: samuel, label: 'Samuel' }])
    assert.deepEqual(projector.outcome, { seats: 1, base: 1, threshold: 1, elected: [samuel], runoff: [], openSeats: 0 })
  })

  test('publishRound: a filled seat keeps the result computed by the engine and prepares no runoff', async (t) => {
    const { prisma, service, assemblyId, roundId } = await publishedBallot(t)

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.deepEqual(mesa.rounds[0]?.officialResult?.elected.map((person) => person.label), ['Samuel'])
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
    const { service, room, joinCode, assemblyId, delegate, roundId, samuel } = await publishedBallot(t)

    await service.completeAssembly(assemblyId, true)

    await assert.rejects(room.joinAssembly(joinCode, 'Delegado', '02'), ConflictException)
    await assert.rejects(service.createRound(assemblyId, {
      title: 'Vocalía', format: 'single_choice', options: [{ label: 'Oseas' }, { label: 'Joel' }], countingRule: { kind: 'count_only' },
    }), ConflictException)
    await assert.rejects(service.castVote(delegate, roundId, samuel), ConflictException)
    await assert.rejects(room.changeLobby(assemblyId, 'lobby_closed'), ConflictException)
    await assert.rejects(room.patchParticipant(delegate, { firstName: 'Delegada' }), ConflictException)
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

const candidates = ['Elías', 'Eliseo', 'Isaías', 'Jeremías', 'Daniel']

const firstVote = [
  ['Elías', 'Eliseo', 'Isaías'],
  ['Elías', 'Eliseo', 'Isaías'],
  ['Elías', 'Eliseo', 'Jeremías'],
  ['Elías', 'Isaías', 'Jeremías'],
  ['Elías', 'Daniel', 'Jeremías'],
]

const secondVote = [
  ['Eliseo', 'Isaías'],
  ['Eliseo', 'Isaías'],
  ['Eliseo', 'Jeremías'],
  ['Eliseo', 'Jeremías'],
  ['Isaías', 'Jeremías'],
]

const thirdVote = [['Isaías'], ['Isaías'], ['Isaías'], ['Isaías'], ['Jeremías']]

type Ballot = { id: string; options: Array<{ id: string; label: string }> }

async function committeeElection(t: TestContext) {
  const prisma = await connectDatabase()
  const { voting: service } = buildProviders(prisma)
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
      assemblyId, firstName: 'Delegado', lastName: String(index + 1).padStart(2, '0'), tokenHash: hashCredential(newOpaqueCredential()), joinedAt: new Date(Date.now() + index),
    } })
    delegates.push(session.id)
  }
  const round = await service.createRound(assemblyId, {
    title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 3, countingRule: { kind: 'count_only' },
    options: candidates.map((label) => ({ label })),
  })

  const idOf = (ballot: Ballot, label: string) => ballot.options.find((option) => option.label === label)!.id
  const markOn = (ballot: Ballot) => (delegate: number, labels: string[]) =>
    service.castVote(delegates[delegate]!, ballot.id, labels.map((label) => idOf(ballot, label)))
  const castAll = async (ballot: Ballot, ballots: string[][]) => {
    const mark = markOn(ballot)
    for (const [delegate, labels] of ballots.entries()) await mark(delegate, labels)
  }
  const runoffAfter = async (ballot: Ballot) => (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.runoffSourceRoundId === ballot.id)!
  const runBallot = async (ballot: Ballot, ballots: string[][]) => {
    await service.openRound(ballot.id)
    await castAll(ballot, ballots)
    await service.closeRound(ballot.id)
    await service.publishRound(ballot.id)
    return runoffAfter(ballot)
  }

  return { prisma, service, joinCode, assemblyId, delegates, round, idOf, markOn, castAll, runoffAfter, runBallot }
}

const electedOn = async (service: VotingService, joinCode: string) => (await service.publicState(joinCode)).officialResult?.elected.map((person) => person.label)
const dotsOn = async (service: VotingService, assemblyId: string) => (await service.moderatorAssembly(assemblyId)).participants.map((person) => person.voted)

describe('a committee election for 3 seats with 6 enabled delegates', () => {
  test('createRound: typed candidates keep ballot order', async (t) => {
    const { round } = await committeeElection(t)

    assert.deepEqual(round.options.map((option) => option.label), candidates)
  })

  test('moderatorAssembly: a prepared ballot shows no attendance yet', async (t) => {
    const { service, assemblyId } = await committeeElection(t)

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.equal(mesa.attendanceRound, null)
  })

  test('participantState: the phone knows it must mark 3 names', async (t) => {
    const { service, delegates, round } = await committeeElection(t)
    await service.openRound(round.id)

    const phone = await service.participantState(delegates[0]!)

    assert.equal(phone.openRound?.electionSeats, 3)
  })

  test('castVote: a delegate must mark exactly as many names as open seats', async (t) => {
    const { service, round, markOn } = await committeeElection(t)
    await service.openRound(round.id)
    const mark = markOn(round)

    await assert.rejects(mark(0, ['Elías', 'Eliseo', 'Isaías', 'Jeremías']), /exactamente 3 nombres/)
    await assert.rejects(mark(0, ['Elías', 'Eliseo']), /exactamente 3 nombres/)
  })

  test('castVote: each marked name is stored as a vote with no link to the delegate', async (t) => {
    const { prisma, service, round, castAll } = await committeeElection(t)
    await service.openRound(round.id)

    await castAll(round, firstVote)

    assert.equal(await prisma.anonymousVote.count({ where: { roundId: round.id } }), 15)
    assert.equal('participantSessionId' in ((await prisma.anonymousVote.findFirst({ where: { roundId: round.id } })) ?? {}), false)
  })

  test('moderatorAssembly: while the ballot is open the mesa sees who voted, never for whom', async (t) => {
    const { service, assemblyId, round, idOf, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    const mesa = await service.moderatorAssembly(assemblyId)

    assert.deepEqual(mesa.participants.map((person) => person.voted), [true, true, true, true, true, false])
    assert.deepEqual(mesa.attendanceRound, { roundId: round.id, status: 'open', votedCount: 5, eligibleCount: 6 })
    assert.equal(JSON.stringify(mesa.participants).includes(idOf(round, 'Elías')), false)
  })

  test('closeRound: a majority of 4 elects Elías, and Eliseo, Isaías and Jeremías tied at the cut go to a runoff', async (t) => {
    const { service, assemblyId, round, idOf, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    await service.closeRound(round.id)

    const first = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === round.id)!
    assert.deepEqual(first.outcome, {
      seats: 3, base: 6, threshold: 4,
      elected: [idOf(round, 'Elías')],
      runoff: ['Eliseo', 'Isaías', 'Jeremías'].map((label) => idOf(round, label)),
      openSeats: 2,
    })
    assert.deepEqual(first.officialResult?.elected.map((person) => person.label), ['Elías'])
  })

  test('closeRound: the mesa keeps the dots of who voted', async (t) => {
    const { service, assemblyId, round, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    await service.closeRound(round.id)

    assert.deepEqual(await dotsOn(service, assemblyId), [true, true, true, true, true, false])
  })

  test('closeRound: the runoff is prepared as a draft for 2 seats with only the tied candidates', async (t) => {
    const { service, round, castAll, runoffAfter } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    await service.closeRound(round.id)

    const runoff = await runoffAfter(round)
    assert.equal(runoff.status, 'draft')
    assert.equal(runoff.committeeRootRoundId, round.id)
    assert.equal(runoff.title, 'Comisión de Finanzas')
    assert.equal(runoff.electionSeats, 2)
    assert.equal(runoff.voteNumber, 2)
    assert.equal(runoff.runoff, true)
    assert.deepEqual(runoff.options.map((option) => option.label), ['Eliseo', 'Isaías', 'Jeremías'])
  })

  test('closeRound: the mesa keeps the closed vote in front until it opens the runoff', async (t) => {
    const { service, assemblyId, round, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    await service.closeRound(round.id)

    assert.equal((await service.moderatorAssembly(assemblyId)).currentRound?.id, round.id)
  })

  test('closeRound: nothing reaches the projector before publishing', async (t) => {
    const { service, joinCode, round, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)

    await service.closeRound(round.id)

    const projector = await service.publicState(joinCode)
    assert.equal('results' in projector, false)
    assert.equal('officialResult' in projector, false)
  })

  test('publishRound: every candidate is ranked by votes and the projector shows the same ranking', async (t) => {
    const { service, joinCode, round, idOf, castAll } = await committeeElection(t)
    await service.openRound(round.id)
    await castAll(round, firstVote)
    await service.closeRound(round.id)

    const { results } = await service.publishRound(round.id)

    assert.deepEqual(results.map((option) => [option.label, option.count]), [['Elías', 5], ['Eliseo', 3], ['Isaías', 3], ['Jeremías', 3], ['Daniel', 1]])
    const projector = await service.publicState(joinCode)
    assert.deepEqual(projector.results?.map((option) => option.label), results.map((option) => option.label))
    assert.deepEqual(projector.outcome?.elected, [idOf(round, 'Elías')])
    assert.deepEqual(projector.outcome?.runoff, ['Eliseo', 'Isaías', 'Jeremías'].map((label) => idOf(round, label)))
    assert.deepEqual(projector.officialResult?.elected.map((person) => person.label), ['Elías'])
  })

  test('openRound: opening the second vote resets the dots', async (t) => {
    const { service, assemblyId, round, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)

    await service.openRound(second.id)

    assert.deepEqual(await dotsOn(service, assemblyId), [false, false, false, false, false, false])
  })

  test('participantState: the phone shows the second vote as a runoff for 2 seats', async (t) => {
    const { service, delegates, round, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)
    await service.openRound(second.id)

    const phone = await service.participantState(delegates[0]!)

    assert.equal(phone.openRound?.electionSeats, 2)
    assert.equal(phone.openRound?.voteNumber, 2)
    assert.equal(phone.openRound?.runoff, true)
  })

  test('castVote: the second vote takes exactly 2 names', async (t) => {
    const { service, round, markOn, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)
    await service.openRound(second.id)
    const mark = markOn(second)

    await assert.rejects(mark(0, ['Eliseo']), /exactamente 2 nombres/)
    await assert.rejects(mark(0, ['Eliseo', 'Isaías', 'Jeremías']), /exactamente 2 nombres/)
  })

  test('closeRound: closing the second vote elects nobody new on the projector', async (t) => {
    const { service, joinCode, round, castAll, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)
    await service.openRound(second.id)
    await castAll(second, secondVote)

    await service.closeRound(second.id)

    assert.deepEqual(await electedOn(service, joinCode), ['Elías'])
  })

  test('publishRound: publishing the second vote elects Eliseo', async (t) => {
    const { service, joinCode, round, castAll, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)
    await service.openRound(second.id)
    await castAll(second, secondVote)
    await service.closeRound(second.id)

    await service.publishRound(second.id)

    assert.deepEqual(await electedOn(service, joinCode), ['Elías', 'Eliseo'])
  })

  test('closeRound: the second vote sends Isaías and Jeremías, tied at 3, to a third vote for 1 seat', async (t) => {
    const { service, round, castAll, runoffAfter, runBallot } = await committeeElection(t)
    const second = await runBallot(round, firstVote)
    await service.openRound(second.id)
    await castAll(second, secondVote)

    await service.closeRound(second.id)

    const third = await runoffAfter(second)
    assert.equal(third.committeeRootRoundId, round.id)
    assert.equal(third.electionSeats, 1)
    assert.equal(third.voteNumber, 3)
    assert.deepEqual(third.options.map((option) => option.label), ['Isaías', 'Jeremías'])
  })

  test('castVote: the third vote takes exactly 1 name', async (t) => {
    const { service, round, markOn, runBallot } = await committeeElection(t)
    const third = await runBallot(await runBallot(round, firstVote), secondVote)
    await service.openRound(third.id)

    await assert.rejects(markOn(third)(0, ['Isaías', 'Jeremías']), /exactamente 1 nombre/)
  })

  test('publishRound: Isaías with 4 of 6 completes the committee and no further runoff is prepared', async (t) => {
    const { prisma, service, joinCode, assemblyId, round, castAll, runBallot } = await committeeElection(t)
    const third = await runBallot(await runBallot(round, firstVote), secondVote)
    await service.openRound(third.id)
    await castAll(third, thirdVote)
    await service.closeRound(third.id)

    await service.publishRound(third.id)

    const mesa = await service.moderatorAssembly(assemblyId)
    assert.equal(mesa.rounds.length, 3)
    assert.deepEqual(mesa.rounds.find((item) => item.id === round.id)?.officialResult?.elected.map((person) => person.label), ['Elías', 'Eliseo', 'Isaías'])
    assert.deepEqual(await electedOn(service, joinCode), ['Elías', 'Eliseo', 'Isaías'])
    assert.equal(await prisma.auditEvent.count({ where: { round: { OR: [{ id: round.id }, { committeeRootRoundId: round.id }] }, action: 'round.result_computed' } }), 3)
  })
})
