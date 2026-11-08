import assert from 'node:assert/strict'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { connectDatabase } from '../support/database.js'
import { seedAssembly } from '../support/seed.js'
import { buildProviders } from '../support/providers.js'

const room28 = Array.from({ length: 28 }, (_, index) => `Delegado ${index + 1}`)

test('a 2/3 decision with 28 in the room needs 19, and abstentions count in the base', async () => {
  const prisma = await connectDatabase()
  const { voting, room } = buildProviders(prisma)
  const { assemblyId, joinCode, people, cleanup } = await seedAssembly(prisma, room, { label: 'two-thirds', delegates: room28 })
  try {
    const amendment = await voting.createRound(assemblyId, { title: 'Reforma de Estatutos', format: 'single_choice', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds' })
    assert.equal(amendment.approvalRule, 'two_thirds')
    await voting.openRound(amendment.id)

    const [favor] = amendment.options
    for (const name of room28.slice(0, 18)) await voting.castVote(people[name]!.id, amendment.id, favor!.id)
    await voting.closeRound(amendment.id)
    const closed = (await voting.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === amendment.id)!
    assert.deepEqual(closed.outcome, { seats: 1, base: 28, threshold: 19, elected: [], runoff: [], openSeats: 0, rule: 'two_thirds', approved: false })

    const projector = await voting.publicState(joinCode)
    assert.equal(projector.round?.approvalRule, 'two_thirds')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})

test('2/3 applies only to decisions, and the database accepts only known rules', async () => {
  const prisma = await connectDatabase()
  const { voting, room } = buildProviders(prisma)
  const { assemblyId, cleanup } = await seedAssembly(prisma, room, { label: 'two-thirds-rules', delegates: ['Delegado 1'] })
  try {
    await assert.rejects(
      voting.createRound(assemblyId, { title: 'Presidencia', format: 'single_choice', approvalRule: 'two_thirds', options: [{ label: 'Isaías' }, { label: 'Jeremías' }] }),
      (error: unknown) => error instanceof UnprocessableEntityException && /solo aplican a decisiones/.test(error.message),
    )
    const decision = await voting.createRound(assemblyId, { title: 'Sede', format: 'single_choice', category: 'decision', decisionFormat: 'boolean' })
    await assert.rejects(prisma.round.update({ where: { id: decision.id }, data: { approvalRule: 'two_fifths' } }), /approval_rule/)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
})
