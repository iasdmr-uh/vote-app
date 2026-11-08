import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import { OfficialRosterService } from '../../src/voting/official-roster.service.js'
import { PresentationService } from '../../src/voting/presentation.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { connectDatabase } from '../support/database.js'
import { gatewayStub } from '../support/gateway.js'
import { removeOrganization } from '../support/seed.js'

test('«Presentar oficiales»: the mesa moves the slide, it is audited, broadcast and read by the projector and the mesa', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const voting = new VotingService(prisma, gateway)
  const presentation = new PresentationService(prisma, gateway)
  const organizationId = randomUUID()

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `presentation-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    const assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'IV Asamblea Reorganizativa 2026', status: 'completed', completedAt: new Date(), joinCodeHash: hashCredential(joinCode) } })).id

    // Off on the cover until the mesa turns it on.
    assert.deepEqual((await voting.publicState(joinCode)).presentation, { active: false, slide: 0 })
    assert.deepEqual((await voting.moderatorAssembly(assemblyId)).presentation, { active: false, slide: 0 })

    // Display only: it also works after the assembly is completed.
    assert.deepEqual(await presentation.setPresentation({ assemblyId, active: true, slide: 0 }), { assemblyId, presentation: { active: true, slide: 0 } })
    assert.deepEqual(events, [{ name: 'presentationState', target: assemblyId, payload: { active: true, slide: 0 } }])
    await presentation.setPresentation({ assemblyId, active: true, slide: 2 })
    assert.deepEqual((await voting.publicState(joinCode)).presentation, { active: true, slide: 2 })
    assert.deepEqual((await voting.moderatorAssembly(assemblyId)).presentation, { active: true, slide: 2 })

    // Repeating the same state changes nothing and records nothing.
    events.length = 0
    await presentation.setPresentation({ assemblyId, active: true, slide: 2 })
    assert.equal(events.length, 0)

    await presentation.setPresentation({ assemblyId, active: false, slide: 2 })
    assert.deepEqual((await voting.publicState(joinCode)).presentation, { active: false, slide: 2 })
    const audit = await prisma.auditEvent.findMany({ where: { assemblyId, action: 'presentation.changed' }, orderBy: { occurredAt: 'asc' } })
    assert.deepEqual(audit.map((event) => event.metadata), [{ active: true, slide: 0 }, { active: true, slide: 2 }, { active: false, slide: 2 }])

    // The column rejects a slide that does not exist.
    await assert.rejects(prisma.assembly.update({ where: { id: assemblyId }, data: { presentationSlide: 3 } }))
    await assert.rejects(presentation.setPresentation({ assemblyId: randomUUID(), active: true, slide: 1 }), NotFoundException)
  } finally {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  }
})

test('opening a vote ends «Presentar oficiales», audits it and tells the projector', async () => {
  const prisma = await connectDatabase()
  const { gateway, events } = gatewayStub()
  const voting = new VotingService(prisma, gateway)
  const presentation = new PresentationService(prisma, gateway)
  const roster = new OfficialRosterService(prisma, gateway)
  const organizationId = randomUUID()

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `presentation-open-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    const assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Asamblea de prueba', status: 'lobby_closed', joinCodeHash: hashCredential(joinCode) } })).id
    const budget = await voting.createRound(assemblyId, { title: 'Presupuesto 2027', format: 'multiple_choice', category: 'decision', decisionFormat: 'boolean' })
    await presentation.setPresentation({ assemblyId, active: true, slide: 1 })
    events.length = 0

    await voting.openRound(budget.id)
    assert.deepEqual((await voting.publicState(joinCode)).presentation, { active: false, slide: 1 }, 'the slide is kept for when the mesa turns it on again')
    assert.deepEqual((await voting.moderatorAssembly(assemblyId)).presentation, { active: false, slide: 1 })
    assert.deepEqual(events.filter((event) => event.name === 'presentationState'), [{ name: 'presentationState', target: assemblyId, payload: { active: false, slide: 1 } }])
    const audit = await prisma.auditEvent.findMany({ where: { assemblyId, action: 'presentation.changed' }, orderBy: { occurredAt: 'asc' } })
    assert.deepEqual(audit.map((event) => event.metadata), [{ active: true, slide: 1 }, { active: false, slide: 1, reason: 'round.opened' }])

    // With the presentation already off, opening the next vote records nothing more.
    await voting.closeRound(budget.id)
    await roster.register(budget.id)
    const next = await voting.createRound(assemblyId, { title: 'Reforma', format: 'multiple_choice', category: 'decision', decisionFormat: 'boolean' })
    events.length = 0
    await voting.openRound(next.id)
    assert.equal(events.some((event) => event.name === 'presentationState'), false)
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId, action: 'presentation.changed' } }), 2)
  } finally {
    await removeOrganization(prisma, organizationId)
    await prisma.$disconnect()
  }
})

test('POST /moderator/presentation only accepts on/off and slides 0, 1 and 2', async () => {
  const { plainToInstance } = await import('class-transformer')
  const { validate } = await import('class-validator')
  const { PresentationDto } = await import('../../src/voting/dtos.js')
  const errors = async (body: unknown) => (await validate(plainToInstance(PresentationDto, body))).map((error) => error.property)
  assert.deepEqual(await errors({ active: true, slide: 1 }), [])
  assert.deepEqual(await errors({ active: false, slide: 0, assemblyId: randomUUID() }), [])
  assert.deepEqual(await errors({ active: true, slide: 3 }), ['slide'])
  assert.deepEqual(await errors({ active: 'yes', slide: 1.5 }), ['active', 'slide'])
  assert.deepEqual(await errors({ active: true, slide: 0, assemblyId: 'x' }), ['assemblyId'])
})
