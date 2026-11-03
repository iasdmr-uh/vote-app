import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { PresentationService } from '../src/voting/presentation.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('«Presentar oficiales»: the mesa moves the slide, it is audited, broadcast and read by the projector and the mesa', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const events: Array<{ name: string; target: unknown; payload: unknown }> = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => {
    events.push({ name, target: args[0], payload: args[1] })
  } }) as RealtimeGateway
  const voting = new VotingService(prisma, realtime)
  const presentation = new PresentationService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined

  try {
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `presentation-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'IV Asamblea Reorganizativa 2026', status: 'completed', completedAt: new Date(), joinCodeHash: hashCredential(joinCode) } })).id

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
    if (assemblyId) {
      await prisma.auditEvent.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})

test('POST /moderator/presentation only accepts on/off and slides 0, 1 and 2', async () => {
  const { plainToInstance } = await import('class-transformer')
  const { validate } = await import('class-validator')
  const { PresentationDto } = await import('../src/voting/dtos.js')
  const errors = async (body: unknown) => (await validate(plainToInstance(PresentationDto, body))).map((error) => error.property)
  assert.deepEqual(await errors({ active: true, slide: 1 }), [])
  assert.deepEqual(await errors({ active: false, slide: 0, assemblyId: randomUUID() }), [])
  assert.deepEqual(await errors({ active: true, slide: 3 }), ['slide'])
  assert.deepEqual(await errors({ active: 'yes', slide: 1.5 }), ['active', 'slide'])
  assert.deepEqual(await errors({ active: true, slide: 0, assemblyId: 'x' }), ['assemblyId'])
})
