import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('decisions: A favor / En contra with 3/4 or mayoría simple, and options that repeat between the top 2 until one reaches the rule', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const organizationId = randomUUID()
  const joinCode = newOpaqueCredential()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `decision-test-${organizationId}`, type: 'union' } })
    const activeAssemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Decision integration', status: 'lobby_closed', joinCodeHash: hashCredential(joinCode) } })).id
    assemblyId = activeAssemblyId
    const delegates: Array<{ id: string }> = []
    for (let index = 0; index < 8; index += 1) delegates.push(await prisma.participantSession.create({ data: {
      assemblyId: activeAssemblyId, firstName: `Delegate${index}`, lastName: 'Person', tokenHash: hashCredential(newOpaqueCredential()), joinedAt: new Date(Date.now() + index),
    } }))
    const vote = (index: number, roundId: string, option: { id: string } | undefined) => service.castVote(delegates[index]!.id, roundId, option!.id)

    // The server validates the form: format required, options only for the 'options' format, rule only for decisions.
    const unprocessable = (pattern: RegExp) => (error: unknown) => error instanceof UnprocessableEntityException && pattern.test(error.message)
    await assert.rejects(service.createRound(activeAssemblyId, { title: 'Presupuesto', format: 'single_choice', category: 'decision' }), unprocessable(/formato de la decisión/))
    await assert.rejects(service.createRound(activeAssemblyId, { title: 'Presupuesto', format: 'single_choice', category: 'decision', decisionFormat: 'boolean', options: [{ label: 'Sí' }, { label: 'No' }] }), unprocessable(/no lleva opciones/))
    await assert.rejects(service.createRound(activeAssemblyId, { title: 'Sede', format: 'single_choice', category: 'decision', decisionFormat: 'options', options: [{ label: 'Tegucigalpa' }] }), unprocessable(/dos opciones/))
    await assert.rejects(service.createRound(activeAssemblyId, { title: 'Sede', format: 'single_choice', category: 'decision', decisionFormat: 'options', memberCount: 2, options: [{ label: 'A' }, { label: 'B' }] }), unprocessable(/integrantes solo aplica/))
    await assert.rejects(service.createRound(activeAssemblyId, { title: 'Presidencia', format: 'single_choice', approvalRule: 'three_quarters', options: [{ label: 'A' }, { label: 'B' }] }), unprocessable(/solo aplican a decisiones/))

    // 1 · A favor / En contra with 3/4 over 8 habilitados: 6 votes needed. Delegate 7 is inhabilitado and still counts.
    const budget = await service.createRound(activeAssemblyId, { title: 'Presupuesto 2027', format: 'multiple_choice', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters' })
    assert.deepEqual(budget.options.map((option) => option.label), ['A favor', 'En contra'], 'the server writes the two options, A favor first')
    assert.equal(budget.format, 'single_choice', 'a decision is single choice whatever the client sends')
    assert.equal(budget.approvalRule, 'three_quarters')
    assert.equal(budget.memberCount, null)
    await service.openRound(budget.id)
    const phone = await service.participantState(delegates[0]!.id)
    assert.equal(phone.openRound?.category, 'decision')
    assert.equal(phone.openRound?.decisionFormat, 'boolean')
    assert.equal(phone.openRound?.electionSeats, null, 'no exact-N count on a decision ballot')
    const [favor, contra] = budget.options
    await assert.rejects(service.castVote(delegates[0]!.id, budget.id, [favor!.id, contra!.id]), unprocessable(/una sola opción/), 'no marking both')
    await service.setVotingDisabled(delegates[7]!.id, true)
    await assert.rejects(vote(7, budget.id, favor), ForbiddenException)
    for (const index of [0, 1, 2, 3, 4, 5]) await vote(index, budget.id, favor)
    await vote(6, budget.id, contra)
    await service.closeRound(budget.id)
    const closedBudget = (await service.moderatorAssembly(activeAssemblyId)).rounds.find((item) => item.id === budget.id)!
    assert.deepEqual(closedBudget.outcome, { seats: 1, base: 8, threshold: 6, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved: true })
    assert.equal(closedBudget.officialResult, null, 'nobody is elected in a boolean decision')
    assert.equal((await service.moderatorAssembly(activeAssemblyId)).rounds.length, 1, 'a boolean decision never repeats')
    await service.publishRound(budget.id)
    const projector = await service.publicState(joinCode)
    assert.equal(projector.round?.approvalRule, 'three_quarters')
    assert.equal(projector.outcome && 'approved' in projector.outcome && projector.outcome.approved, true)
    assert.deepEqual(projector.results?.map((option) => [option.label, option.count]), [['A favor', 6], ['En contra', 1]])
    assert.equal(projector.eligibleCount, 8, 'percentages are over the habilitados, the inhabilitado included')
    await service.setVotingDisabled(delegates[7]!.id, false)

    // 2 · Mayoría simple over 8: 5 needed. A 4-4 tie is not approved.
    const statute = await service.createRound(activeAssemblyId, { title: 'Reforma de estatutos', format: 'single_choice', category: 'decision', decisionFormat: 'boolean' })
    assert.equal(statute.approvalRule, 'simple', 'mayoría simple by default')
    await service.openRound(statute.id)
    for (const index of [0, 1, 2, 3]) await vote(index, statute.id, statute.options[0])
    for (const index of [4, 5, 6, 7]) await vote(index, statute.id, statute.options[1])
    await service.closeRound(statute.id)
    const closedStatute = (await service.moderatorAssembly(activeAssemblyId)).rounds.find((item) => item.id === statute.id)!
    assert.equal(closedStatute.outcome && 'approved' in closedStatute.outcome && closedStatute.outcome.approved, false)
    assert.equal(closedStatute.outcome?.threshold, 5)
    await service.publishRound(statute.id)

    // 3 · Options with mayoría simple: Tegucigalpa 3, San Pedro Sula 3, La Ceiba 1, Choluteca 1 → nobody has 5,
    // so a draft repeats between the two tied first, as a runoff of the same decision and rule.
    const venue = await service.createRound(activeAssemblyId, { title: 'Sede de la Asamblea 2027', format: 'single_choice', category: 'decision', decisionFormat: 'options', options: ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba', 'Choluteca'].map((label) => ({ label })) })
    await service.openRound(venue.id)
    const [tegus, sps, ceiba, choluteca] = venue.options
    for (const index of [0, 1, 2]) await vote(index, venue.id, tegus)
    for (const index of [3, 4, 5]) await vote(index, venue.id, sps)
    await vote(6, venue.id, ceiba)
    await vote(7, venue.id, choluteca)
    await service.closeRound(venue.id)
    const afterFirst = await service.moderatorAssembly(activeAssemblyId)
    const firstVote = afterFirst.rounds.find((item) => item.id === venue.id)!
    assert.deepEqual(firstVote.outcome, { seats: 1, base: 8, threshold: 5, elected: [], runoff: [tegus!.id, sps!.id], openSeats: 1, rule: 'simple', approved: false })
    const repeat = afterFirst.rounds.find((item) => item.runoffSourceRoundId === venue.id)!
    assert.equal(repeat.status, 'draft')
    assert.equal(repeat.category, 'decision')
    assert.equal(repeat.decisionFormat, 'options')
    assert.equal(repeat.approvalRule, 'simple')
    assert.equal(repeat.electionSeats, null)
    assert.equal(repeat.voteNumber, 2)
    assert.equal(repeat.runoff, true)
    assert.deepEqual(repeat.options.map((option) => option.label), ['Tegucigalpa', 'San Pedro Sula'])
    await service.publishRound(venue.id)

    // 2nd vote: San Pedro Sula 5 of 8 wins; no further vote is prepared.
    await service.openRound(repeat.id)
    for (const index of [0, 1, 2]) await vote(index, repeat.id, repeat.options[0])
    for (const index of [3, 4, 5, 6, 7]) await vote(index, repeat.id, repeat.options[1])
    await service.closeRound(repeat.id)
    await service.publishRound(repeat.id)
    const final = await service.moderatorAssembly(activeAssemblyId)
    const second = final.rounds.find((item) => item.id === repeat.id)!
    assert.deepEqual(second.outcome?.elected, [repeat.options[1]!.id])
    assert.equal(second.outcome && 'approved' in second.outcome && second.outcome.approved, true)
    assert.equal(final.rounds.some((item) => item.runoffSourceRoundId === repeat.id), false)
    assert.deepEqual(final.rounds.find((item) => item.id === venue.id)?.officialResult?.elected.map((option) => option.label), ['San Pedro Sula'])
    assert.deepEqual((await service.publicState(joinCode)).officialResult?.elected.map((option) => option.label), ['San Pedro Sula'])
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})
