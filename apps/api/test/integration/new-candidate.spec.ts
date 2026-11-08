import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { connectDatabase } from '../support/database.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

test('the mesa cannot add a candidate to the first runoff, can add and remove one from the 3rd vote on, and the new candidate can be elected', async () => {
  const prisma = await connectDatabase()
  const { voting: service, room } = buildProviders(prisma)
  const delegates = ['Ana', 'Luis', 'Marta', 'Pedro', 'Sofía']
  const seeded = await seedAssembly(prisma, room, { label: 'new-candidate-test', delegates })
  const { assemblyId } = seeded
  const people = delegates.map((name) => seeded.people[name]!.id)

  try {
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
    await seeded.cleanup()
    await prisma.$disconnect()
  }
})

test('in a committee runoff from the 3rd vote on, a new candidate can fill one of the open seats', async () => {
  const prisma = await connectDatabase()
  const { voting: service, room } = buildProviders(prisma)
  const delegates = ['Ana', 'Luis', 'Marta']
  const seeded = await seedAssembly(prisma, room, { label: 'new-candidate-committee', delegates })
  const { assemblyId } = seeded
  const people = delegates.map((name) => seeded.people[name]!.id)

  try {
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
    await seeded.cleanup()
    await prisma.$disconnect()
  }
})

test('an annulled vote does not count: the repeated first runoff is still the 2nd vote and takes no new candidate; a decision never takes one', async () => {
  const prisma = await connectDatabase()
  const { voting: service, room } = buildProviders(prisma)
  const delegates = ['Ana', 'Luis', 'Marta', 'Pedro', 'Sofía']
  const seeded = await seedAssembly(prisma, room, { label: 'new-candidate-annulled', delegates })
  const { assemblyId } = seeded
  const people = delegates.map((name) => seeded.people[name]!.id)

  try {
    const vote = async (roundId: string, ballot: Array<{ id: string; label: string }>, labels: string[]) => {
      for (const [index, label] of labels.entries()) await service.castVote(people[index]!, roundId, ballot.find((option) => option.label === label)!.id)
    }
    const roundIn = async (roundId: string) => (await service.moderatorAssembly(assemblyId!)).rounds.find((round) => round.id === roundId)!
    const draftAfter = async (sourceRoundId: string) => (await service.moderatorAssembly(assemblyId!)).rounds.find((round) => round.runoffSourceRoundId === sourceRoundId && round.status === 'draft')!

    // 1st vote: base 5, majority 3. María and Carlos go to the runoff.
    const first = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'María López' }, { label: 'Carlos Gómez' }, { label: 'Juan Mora' }],
    })
    await service.openRound(first.id)
    await vote(first.id, first.options, ['María López', 'María López', 'Carlos Gómez', 'Carlos Gómez', 'Juan Mora'])
    await service.closeRound(first.id)
    const runoff = await draftAfter(first.id)

    // The first runoff is opened, annulled and prepared again: it is still the 2nd vote and still a runoff.
    await service.openRound(runoff.id)
    await service.annulRound(runoff.id, 'Se abrió por error')
    assert.equal((await roundIn(runoff.id)).voteNumber, 2, 'the annulled vote keeps its own number')
    const again = await service.repeatRound(runoff.id, { optionIds: runoff.options.map((option) => option.id) })
    const repeated = await roundIn(again.id)
    assert.equal(repeated.voteNumber, 2, 'the annulled vote is not counted')
    assert.equal(repeated.runoff, true)
    await assert.rejects(service.addCandidate(again.id, 'Rosa Díaz'), /a partir de la 3\.ª votación/)
    assert.equal(await prisma.ballotOption.count({ where: { roundId: again.id } }), 2)
    await service.openRound(again.id)
    const phone = await service.participantState(people[0]!)
    assert.deepEqual([phone.openRound?.voteNumber, phone.openRound?.runoff], [2, true], 'the phone labels it DESEMPATE · 2.ª VOTACIÓN')

    // Tied again: the next runoff is the 3rd vote and takes a new candidate.
    await vote(again.id, again.options, ['María López', 'María López', 'Carlos Gómez', 'Carlos Gómez'])
    await service.closeRound(again.id)
    const third = await draftAfter(again.id)
    assert.equal(third.voteNumber, 3)
    assert.equal((await service.addCandidate(third.id, 'Rosa Díaz')).option.isNew, true)

    // A decision with options repeats between its own options, even from its 3rd vote on.
    const venue = await service.createRound(assemblyId, { title: 'Sede 2027', format: 'single_choice', category: 'decision', decisionFormat: 'options', options: ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba'].map((label) => ({ label })) })
    await service.openRound(venue.id)
    await vote(venue.id, venue.options, ['Tegucigalpa', 'Tegucigalpa', 'San Pedro Sula', 'San Pedro Sula', 'La Ceiba'])
    await service.closeRound(venue.id)
    const venue2 = await draftAfter(venue.id)
    await service.openRound(venue2.id)
    await vote(venue2.id, venue2.options, ['Tegucigalpa', 'Tegucigalpa', 'San Pedro Sula', 'San Pedro Sula'])
    await service.closeRound(venue2.id)
    const venue3 = await draftAfter(venue2.id)
    assert.deepEqual([venue3.category, venue3.voteNumber, venue3.runoff], ['decision', 3, true])
    await assert.rejects(service.addCandidate(venue3.id, 'Choluteca'), /cargo o una comisión/)
    assert.equal(await prisma.ballotOption.count({ where: { roundId: venue3.id } }), 2)
  } finally {
    await seeded.cleanup()
    await prisma.$disconnect()
  }
})
