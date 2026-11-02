import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('the mesa cannot add a candidate to the first runoff, can add and remove one from the 3rd vote on, and the new candidate can be elected', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `new-candidate-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'New candidate test', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: string[] = []
    for (const name of ['Ana', 'Luis', 'Marta', 'Pedro', 'Sofía']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      people.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    const first = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'María López' }, { label: 'Carlos Gómez' }, { label: 'Juan Mora' }],
    })
    const runoffOf = async (sourceRoundId: string) => {
      const mesa = await service.moderatorAssembly(assemblyId!)
      const runoff = mesa.rounds.find((round) => round.runoffSourceRoundId === sourceRoundId && round.status === 'draft')
      assert.ok(runoff, `closing ${sourceRoundId} prepares a runoff draft`)
      return runoff
    }
    const labelOf = (round: { options: Array<{ id: string; label: string }> }, id: string) => round.options.find((option) => option.id === id)!.label
    const vote = async (roundId: string, ballot: Array<{ id: string; label: string }>, labels: string[]) => {
      for (const [index, label] of labels.entries()) await service.castVote(people[index]!, roundId, ballot.find((option) => option.label === label)!.id)
    }

    // 1st vote: base 5, majority 3. Nobody reaches it, so María and Carlos go to the runoff.
    await service.openRound(first.id)
    await vote(first.id, first.options, ['María López', 'María López', 'Carlos Gómez', 'Carlos Gómez', 'Juan Mora'])
    await service.closeRound(first.id)
    const second = await runoffOf(first.id)
    assert.equal(second.voteNumber, 2)
    assert.deepEqual(second.options.map((option) => option.label), ['María López', 'Carlos Gómez'])
    assert.ok(second.options.every((option) => option.isNew === false))

    // The first runoff never takes a new candidate.
    await assert.rejects(service.addCandidate(second.id, 'Rosa Díaz'), ConflictException)
    assert.equal(await prisma.ballotOption.count({ where: { roundId: second.id } }), 2)

    // 2nd vote: tied again, so the 3rd vote is prepared with the same two.
    await service.openRound(second.id)
    await vote(second.id, second.options, ['María López', 'María López', 'Carlos Gómez', 'Carlos Gómez'])
    await service.closeRound(second.id)
    const third = await runoffOf(second.id)
    assert.equal(third.voteNumber, 3)
    assert.equal(third.runoff, true)

    // From the 3rd vote on the mesa may add a candidate; it is marked as new and audited.
    const added = await service.addCandidate(third.id, '  Rosa Díaz ')
    assert.deepEqual({ label: added.option.label, isNew: added.option.isNew, order: added.option.order }, { label: 'Rosa Díaz', isNew: true, order: 2 })
    await assert.rejects(service.addCandidate(third.id, 'rosa díaz'), UnprocessableEntityException, 'no duplicates')
    await assert.rejects(service.addCandidate(third.id, 'María López'), UnprocessableEntityException)
    await assert.rejects(service.addCandidate(third.id, '   '), UnprocessableEntityException)

    // Only an added candidate can be taken back.
    const kept = third.options[0]!
    await assert.rejects(service.removeCandidate(third.id, kept.id), ConflictException)
    await assert.rejects(service.removeCandidate(third.id, randomUUID()), NotFoundException)
    const extra = await service.addCandidate(third.id, 'Elena Castro')
    assert.deepEqual(await service.removeCandidate(third.id, extra.option.id), { roundId: third.id, optionId: extra.option.id, removed: true })
    const audit = await prisma.auditEvent.findMany({ where: { roundId: third.id, action: { in: ['round.candidate_added', 'round.candidate_removed'] } }, orderBy: { occurredAt: 'asc' } })
    assert.deepEqual(audit.map((event) => [event.action, (event.metadata as { label: string }).label, (event.metadata as { voteNumber: number }).voteNumber]), [
      ['round.candidate_added', 'Rosa Díaz', 3],
      ['round.candidate_added', 'Elena Castro', 3],
      ['round.candidate_removed', 'Elena Castro', 3],
    ])

    let mesa = await service.moderatorAssembly(assemblyId)
    const draft = mesa.rounds.find((round) => round.id === third.id)!
    assert.deepEqual(draft.options.map((option) => [option.label, option.isNew]), [['María López', false], ['Carlos Gómez', false], ['Rosa Díaz', true]])

    // 3rd vote: the new candidate gets the majority and is elected.
    await service.openRound(third.id)
    const phone = await service.participantState(people[0]!)
    assert.deepEqual(phone.openRound?.options.map((option) => option.label), ['María López', 'Carlos Gómez', 'Rosa Díaz'])
    await vote(third.id, draft.options, ['Rosa Díaz', 'Rosa Díaz', 'Rosa Díaz', 'María López'])
    await service.closeRound(third.id)
    mesa = await service.moderatorAssembly(assemblyId)
    const settled = mesa.rounds.find((round) => round.id === third.id)!
    assert.deepEqual(settled.outcome?.elected.map((id) => labelOf(settled, id)), ['Rosa Díaz'])
    assert.deepEqual(mesa.rounds.find((round) => round.id === first.id)!.officialResult?.elected, [{ optionId: added.option.id, label: 'Rosa Díaz', roundId: third.id }])
    assert.equal(mesa.rounds.some((round) => round.status === 'draft'), false, 'no further runoff')

    // Once opened, the candidates are fixed.
    await assert.rejects(service.addCandidate(third.id, 'Luis Pérez'), ConflictException)
    await assert.rejects(service.removeCandidate(third.id, added.option.id), ConflictException)
    // A round that is not a runoff never takes one either.
    await assert.rejects(service.addCandidate(first.id, 'Luis Pérez'), ConflictException)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})

test('in a committee runoff from the 3rd vote on, a new candidate can fill one of the open seats', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `new-candidate-committee-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Committee new candidate', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: string[] = []
    for (const name of ['Ana', 'Luis', 'Marta']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      people.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    const first = await service.createRound(assemblyId, {
      title: 'Comisión de Finanzas', category: 'committee', memberCount: 2, format: 'multiple_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'Ana Ruiz' }, { label: 'Juan Mora' }, { label: 'Elena Castro' }],
    })
    const idsOf = (ballot: Array<{ id: string; label: string }>, labels: string[]) => labels.map((label) => ballot.find((option) => option.label === label)!.id)
    const draftAfter = async (sourceRoundId: string) => (await service.moderatorAssembly(assemblyId!)).rounds.find((round) => round.runoffSourceRoundId === sourceRoundId && round.status === 'draft')!

    // 1st vote (base 3, majority 2): Ana is elected; Juan and Elena tie for the last seat.
    await service.openRound(first.id)
    await service.castVote(people[0]!, first.id, idsOf(first.options, ['Ana Ruiz', 'Juan Mora']))
    await service.castVote(people[1]!, first.id, idsOf(first.options, ['Ana Ruiz', 'Elena Castro']))
    await service.closeRound(first.id)
    const second = await draftAfter(first.id)
    assert.equal(second.electionSeats, 1)
    await assert.rejects(service.addCandidate(second.id, 'Ana Ruiz'), ConflictException)

    // 2nd vote: tied again.
    await service.openRound(second.id)
    await service.castVote(people[0]!, second.id, idsOf(second.options, ['Juan Mora']))
    await service.castVote(people[1]!, second.id, idsOf(second.options, ['Elena Castro']))
    await service.closeRound(second.id)
    const third = await draftAfter(second.id)
    assert.equal(third.voteNumber, 3)

    // Someone already elected in this election cannot be added again.
    await assert.rejects(service.addCandidate(third.id, 'ana ruiz'), UnprocessableEntityException)
    const added = await service.addCandidate(third.id, 'Sofía Méndez')
    await service.openRound(third.id)
    for (const person of people) await service.castVote(person, third.id, [added.option.id])
    await service.closeRound(third.id)
    const mesa = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(mesa.rounds.find((round) => round.id === first.id)!.officialResult?.elected.map((person) => person.label), ['Ana Ruiz', 'Sofía Méndez'])
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})
