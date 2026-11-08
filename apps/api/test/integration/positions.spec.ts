import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { hashCredential } from '../../src/auth/credentials.js'
import type { PrismaService } from '../../src/prisma/prisma.service.js'
import { RoomService } from '../../src/voting/room.service.js'
import { DEFAULT_BOARD_POSITIONS, DEFAULT_DEPARTMENT_POSITIONS, VotingService } from '../../src/voting/voting.service.js'
import { OfficialRosterService } from '../../src/voting/official-roster.service.js'
import { connectDatabase } from '../support/database.js'
import { buildProviders } from '../support/providers.js'

/** A real Asamblea created by the mesa (so its puestos are seeded), with `count` delegates. */
async function withAssembly(count: number, body: (ctx: { service: VotingService; room: RoomService; roster: OfficialRosterService; prisma: PrismaService; assemblyId: string; joinCode: string; people: string[] }) => Promise<void>) {
  const prisma = await connectDatabase()
  const { voting: service, room, roster } = buildProviders(prisma)
  let assemblyId: string | undefined
  try {
    const created = await service.createAssembly('IV Asamblea Reorganizativa 2026', ' 2027–2029 ')
    assemblyId = created.assemblyId
    assert.equal(created.period, '2027–2029')
    const people: string[] = []
    for (let index = 0; index < count; index += 1) {
      const joined = await room.joinAssembly(created.joinCode, `Delegado ${index + 1}`, 'Prueba')
      people.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await body({ service, room, roster, prisma, assemblyId, joinCode: created.joinCode, people })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.$disconnect()
  }
}

test('creating an Asamblea seeds the junta directiva and the 14 departamentos in order, with its period', async () => {
  await withAssembly(0, async ({ service, assemblyId, joinCode }) => {
    const state = await service.moderatorAssembly(assemblyId)
    assert.equal(state.period, '2027–2029')
    assert.deepEqual(state.positions.filter((item) => item.group === 'board').map((item) => item.label), [...DEFAULT_BOARD_POSITIONS])
    assert.deepEqual(state.positions.filter((item) => item.group === 'department').map((item) => item.label), [...DEFAULT_DEPARTMENT_POSITIONS])
    assert.equal(state.positions.length, 21)
    assert.ok(state.positions.every((item) => item.elected === null && item.custom === false))
    const projector = await service.publicState(joinCode)
    assert.equal(projector.assemblyName, 'IV Asamblea Reorganizativa 2026')
    assert.equal(projector.period, '2027–2029')
    assert.equal(projector.positions.length, 21)
  })
})

test('the mesa adds a departamento: audited and last; duplicate or empty is 422, a completed Asamblea is 409', async () => {
  await withAssembly(1, async ({ service, room, prisma, assemblyId }) => {
    const added = await service.addPosition(assemblyId, '  Comunicación ')
    assert.deepEqual({ group: added.group, label: added.label, custom: added.custom, elected: added.elected }, { group: 'department', label: 'Comunicación', custom: true, elected: null })
    const departments = (await service.moderatorAssembly(assemblyId)).positions.filter((item) => item.group === 'department')
    assert.equal(departments.at(-1)?.label, 'Comunicación')
    assert.equal(departments.at(-1)?.sortOrder, DEFAULT_DEPARTMENT_POSITIONS.length)
    const audit = await prisma.auditEvent.findMany({ where: { assemblyId, action: 'position.added' } })
    assert.equal(audit.length, 1)
    assert.deepEqual(audit[0]!.metadata, { positionId: added.id, label: 'Comunicación' })

    await assert.rejects(service.addPosition(assemblyId, 'salud'), UnprocessableEntityException, 'a default puesto, any case')
    await assert.rejects(service.addPosition(assemblyId, 'COMUNICACIÓN'), UnprocessableEntityException, 'a custom puesto, any case')
    await assert.rejects(service.addPosition(assemblyId, 'presidente'), UnprocessableEntityException, 'a junta directiva puesto')
    await assert.rejects(service.addPosition(assemblyId, '   '), UnprocessableEntityException)

    await room.changeLobby(assemblyId, 'lobby_closed')
    await service.completeAssembly(assemblyId, true)
    await assert.rejects(service.addPosition(assemblyId, 'Educación'), ConflictException)
    assert.equal(await prisma.position.count({ where: { assemblyId } }), 22)
  })
})

test('a cargo with a puesto takes its name; only a cargo has a puesto and an elected puesto cannot be voted again', async () => {
  await withAssembly(3, async ({ service, room, roster, prisma, assemblyId, people }) => {
    await room.changeLobby(assemblyId, 'lobby_closed')
    const treasurer = (await prisma.position.findFirstOrThrow({ where: { assemblyId, label: 'Tesorero' } })).id
    await assert.rejects(service.createRound(assemblyId, { title: 'Comisión', category: 'committee', memberCount: 1, format: 'multiple_choice', positionId: treasurer, options: [{ label: 'A' }] }), UnprocessableEntityException)
    await assert.rejects(service.createRound(assemblyId, { category: 'office', format: 'single_choice', options: [{ label: 'A' }, { label: 'B' }] }), UnprocessableEntityException, 'without a puesto the title is required')
    const round = await service.createRound(assemblyId, { category: 'office', format: 'single_choice', positionId: treasurer, options: [{ label: 'Ana Ruiz' }, { label: 'Juan Mora' }] })
    assert.equal(round.title, 'Tesorero')
    assert.equal(round.positionId, treasurer)
    await assert.rejects(service.createRound(assemblyId, { category: 'office', format: 'single_choice', positionId: '00000000-0000-4000-8000-0000000000ff', options: [{ label: 'A' }, { label: 'B' }] }), UnprocessableEntityException, 'a puesto of another Asamblea')

    await service.openRound(round.id)
    for (const person of people) await service.castVote(person, round.id, round.options[0]!.id)
    await service.closeRound(round.id)
    assert.equal((await service.moderatorAssembly(assemblyId)).positions.find((item) => item.id === treasurer)?.elected, null, 'not on the roster yet')
    await roster.register(round.id)
    const state = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(state.positions.find((item) => item.id === treasurer)?.elected, { label: 'Ana Ruiz', roundId: round.id })
    assert.equal(state.rounds.find((item) => item.id === round.id)?.positionId, treasurer)
    await assert.rejects(service.createRound(assemblyId, { category: 'office', format: 'single_choice', positionId: treasurer, options: [{ label: 'A' }, { label: 'B' }] }), ConflictException)
  })
})

test('a runoff elects into its root\'s puesto; phones, projector and mesa see it once on the roster', async () => {
  await withAssembly(4, async ({ service, room, roster, prisma, assemblyId, joinCode, people }) => {
    await room.changeLobby(assemblyId, 'lobby_closed')
    const president = (await prisma.position.findFirstOrThrow({ where: { assemblyId, label: 'Presidente' } })).id
    const first = await service.createRound(assemblyId, { category: 'office', format: 'single_choice', positionId: president, options: [{ label: 'Ana Ruiz' }, { label: 'Juan Mora' }, { label: 'Elena Castro' }] })
    await service.openRound(first.id)
    // Ana 2, Juan 1, Elena 1 over 4: no majority → runoff.
    const picks = ['Ana Ruiz', 'Ana Ruiz', 'Juan Mora', 'Elena Castro']
    for (const [index, person] of people.entries()) await service.castVote(person, first.id, first.options.find((option) => option.label === picks[index])!.id)
    await service.closeRound(first.id)
    let state = await service.moderatorAssembly(assemblyId)
    const runoff = state.rounds.find((item) => item.committeeRootRoundId === first.id && item.status === 'draft')!
    assert.ok(runoff, 'the runoff draft was prepared')
    assert.equal(runoff.positionId, president, 'the runoff reports its root\'s puesto')
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: runoff.id } })).positionId, null, 'it is stored only on the root')
    assert.equal(state.positions.find((item) => item.id === president)?.elected, null)

    await service.openRound(runoff.id)
    const ana = runoff.options.find((option) => option.label === 'Ana Ruiz')!.id
    for (const person of people) await service.castVote(person, runoff.id, ana)
    await service.closeRound(runoff.id)
    assert.equal((await service.moderatorAssembly(assemblyId)).positions.find((item) => item.id === president)?.elected, null, 'shown but not on the roster')
    assert.equal((await service.publicState(joinCode)).positions.find((item) => item.id === president)?.elected, null)
    await roster.register(first.id)
    state = await service.moderatorAssembly(assemblyId)
    assert.deepEqual(state.positions.find((item) => item.id === president)?.elected, { label: 'Ana Ruiz', roundId: runoff.id })
    const projector = await service.publicState(joinCode)
    assert.equal(projector.round?.positionId, president)
    assert.deepEqual(projector.positions.find((item) => item.id === president)?.elected, { label: 'Ana Ruiz', roundId: runoff.id })
    assert.equal(projector.positions.filter((item) => item.elected).length, 1)
  })
})
