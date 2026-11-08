import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { ConflictException } from '@nestjs/common'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import { OfficialRosterService } from '../src/voting/official-roster.service.js'
import { OperatorLogService } from '../src/voting/operator-log.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'
import { delegateName } from './fixtures/session-tools.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

type Emitted = { name: string; args: unknown[] }
type Context = { prisma: PrismaService; service: VotingService; roster: OfficialRosterService; emitted: Emitted[]; assemblyId: string; voters: string[] }

async function withAssembly(delegates: number, body: (context: Context) => Promise<void>) {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const emitted: Emitted[] = []
  const realtime = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => { emitted.push({ name, args }) } }) as RealtimeGateway
  const service = new VotingService(prisma, realtime)
  const roster = new OfficialRosterService(prisma, realtime)
  const organizationId = randomUUID()
  let assemblyId: string | undefined
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `official-roster-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId, name: 'Official roster', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const voters: string[] = []
    for (let number = 1; number <= delegates; number += 1) {
      const joined = await service.joinAssembly(joinCode, delegateName(number), 'Asamblea')
      voters.push((await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id)
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    emitted.length = 0
    await body({ prisma, service, roster, emitted, assemblyId, voters })
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.auditEvent.deleteMany({ where: { assemblyId } })
      await prisma.participantSession.deleteMany({ where: { assemblyId } })
      await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    }
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
}

const idOf = (options: Array<{ id: string; label: string }>, label: string) => options.find((option) => option.label === label)!.id

async function committeeAfterFirstVote({ service, assemblyId, voters }: Context) {
  const first = await service.createRound(assemblyId, { title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, format: 'multiple_choice', options: ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas'].map((label) => ({ label })) })
  await service.openRound(first.id)
  const ballots = [['Isaías', 'Jeremías', 'Ezequiel'], ['Isaías', 'Daniel', 'Oseas'], ['Isaías', 'Jeremías', 'Daniel'], ['Isaías', 'Ezequiel', 'Oseas']]
  for (const [index, voter] of voters.entries()) await service.castVote(voter, first.id, ballots[index]!.map((label) => idOf(first.options, label)))
  await service.closeRound(first.id)
  const runoff = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.runoffSourceRoundId === first.id)!
  return { first, runoff }
}

async function settleRunoff({ service, voters }: Context, runoff: { id: string; options: Array<{ id: string; label: string }> }) {
  await service.openRound(runoff.id)
  for (const voter of voters) await service.castVote(voter, runoff.id, [idOf(runoff.options, 'Jeremías'), idOf(runoff.options, 'Ezequiel')])
  await service.closeRound(runoff.id)
}

test('the operator adds a committee to the roster in one action, with everyone elected across its votes', { skip }, async () => {
  await withAssembly(4, async (context) => {
    const { prisma, service, roster, emitted, assemblyId } = context
    const { first, runoff } = await committeeAfterFirstVote(context)
    await assert.rejects(roster.register(first.id), ConflictException, 'a vote that sends candidates to a runoff is not final')

    await settleRunoff(context, runoff)
    emitted.length = 0
    const registered = await roster.register(first.id)

    assert.deepEqual(registered.elected.map((item) => item.label), ['Isaías', 'Jeremías', 'Ezequiel'])
    const row = await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id } })
    assert.ok(row.registeredAt)
    assert.equal((await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === first.id)!.officialResult?.registeredAt, row.registeredAt.toISOString())
    assert.deepEqual(emitted.map((item) => item.name), ['resultsRegistered'])

    emitted.length = 0
    const again = await roster.register(first.id)
    assert.equal(again.registeredAt, row.registeredAt.toISOString(), 'adding twice leaves the roster unchanged')
    assert.equal((await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id } })).registeredAt?.getTime(), row.registeredAt.getTime())
    assert.deepEqual(emitted, [])
  })
})

test('the operator adds a decision to the roster as not approved', { skip }, async () => {
  await withAssembly(3, async ({ prisma, service, roster, assemblyId, voters }) => {
    const statute = await service.createRound(assemblyId, { title: 'Reforma de estatutos', format: 'single_choice', category: 'decision', decisionFormat: 'boolean' })
    await service.openRound(statute.id)
    for (const voter of voters) await service.castVote(voter, statute.id, statute.options[1]!.id)
    await service.closeRound(statute.id)

    const registered = await roster.register(statute.id)

    assert.equal(registered.approved, false)
    assert.deepEqual(registered.elected, [])
    assert.ok((await prisma.officialResult.findUniqueOrThrow({ where: { roundId: statute.id } })).registeredAt)
  })
})

test('the roster refuses a result still being prepared and an annulled one', { skip }, async () => {
  await withAssembly(2, async ({ prisma, service, roster, assemblyId, voters }) => {
    const president = await service.createRound(assemblyId, { title: 'Presidente', format: 'single_choice', options: [{ label: 'Isaías' }, { label: 'Jeremías' }], countingRule: { kind: 'count_only' } })
    await service.openRound(president.id)
    for (const voter of voters) await service.castVote(voter, president.id, president.options[0]!.id)
    Object.assign(service, { vacuumAnonymousVotes: async () => { throw new Error('simulated VACUUM failure') } })
    await service.closeRound(president.id)

    await assert.rejects(roster.register(president.id), ConflictException, 'the result is still being prepared')

    delete (service as unknown as Record<string, unknown>).vacuumAnonymousVotes
    await service.retrySecrecyCleanup(assemblyId)
    await service.annulRound(president.id, 'Nombre mal escrito')
    await assert.rejects(roster.register(president.id), ConflictException, 'an annulled vote never goes on the roster')
    assert.equal((await prisma.officialResult.findUnique({ where: { roundId: president.id } }))?.registeredAt ?? null, null)
  })
})

test('the database refuses to change a roster entry, and «Borrar datos» still deletes everything', { skip }, async () => {
  await withAssembly(4, async (context) => {
    const { prisma, service, roster, assemblyId } = context
    const { first, runoff } = await committeeAfterFirstVote(context)
    await settleRunoff(context, runoff)
    await roster.register(first.id)
    const result = await prisma.officialResult.findUniqueOrThrow({ where: { roundId: first.id }, include: { options: true } })
    const refused = /registrado como oficial/

    await assert.rejects(prisma.$executeRaw`UPDATE official_results SET registered_at = NULL WHERE id = ${result.id}::uuid`, refused)
    await assert.rejects(prisma.$executeRaw`UPDATE official_results SET registered_at = now() + interval '1 day' WHERE id = ${result.id}::uuid`, refused)
    await assert.rejects(prisma.$executeRaw`UPDATE official_results SET approved = true WHERE id = ${result.id}::uuid`, refused)
    await assert.rejects(prisma.$executeRaw`DELETE FROM official_result_options WHERE official_result_id = ${result.id}::uuid`, refused)
    const daniel = runoff.options.find((option) => option.label === 'Daniel')!.id
    await assert.rejects(prisma.$executeRaw`INSERT INTO official_result_options (official_result_id, option_id, seat_order) VALUES (${result.id}::uuid, ${daniel}::uuid, 9)`, refused)
    await assert.rejects(prisma.$executeRaw`UPDATE rounds SET status = 'annulled' WHERE id = ${runoff.id}::uuid`, refused)
    await assert.rejects(prisma.$executeRaw`DELETE FROM official_results WHERE id = ${result.id}::uuid`, refused)
    assert.equal((await prisma.officialResultOption.count({ where: { officialResultId: result.id } })), 3)

    await service.completeAssembly(assemblyId, true)
    await new OperatorLogService(prisma).download(assemblyId, 'delete')
    const deleted = await service.deleteAssemblyData(assemblyId, true)
    assert.equal(deleted.deleted, true)
    assert.equal(await prisma.officialResult.count({ where: { id: result.id } }), 0)
    assert.equal(await prisma.round.count({ where: { assemblyId } }), 0)
  })
})

async function singleVote({ service, assemblyId }: Context, title: string) {
  return service.createRound(assemblyId, { title, format: 'single_choice', category: 'office', options: [{ label: 'Isaías' }, { label: 'Jeremías' }, { label: 'Ezequiel' }] })
}

test('another election waits while an election has a runoff pending or a final result off the roster', { skip }, async () => {
  await withAssembly(4, async (context) => {
    const { service, roster, voters } = context
    const { first, runoff } = await committeeAfterFirstVote(context)
    const secretary = await singleVote(context, 'Secretario')

    await assert.rejects(service.openRound(secretary.id), ConflictException, 'a runoff is pending')
    await settleRunoff(context, runoff)
    await assert.rejects(service.openRound(secretary.id), ConflictException, 'the final result is not on the roster')

    await roster.register(first.id)
    await service.openRound(secretary.id)
    for (const voter of voters) await service.castVote(voter, secretary.id, secretary.options[0]!.id)
    await service.closeRound(secretary.id)
  })
})

test('the runoff of the same election opens, and an annulled vote frees the next election', { skip }, async () => {
  await withAssembly(4, async (context) => {
    const { service, voters } = context
    const president = await singleVote(context, 'Presidente')
    await service.openRound(president.id)
    const picks = ['Isaías', 'Isaías', 'Jeremías', 'Ezequiel']
    for (const [index, voter] of voters.entries()) await service.castVote(voter, president.id, idOf(president.options, picks[index]!))
    await service.closeRound(president.id)
    const runoff = (await service.moderatorAssembly(context.assemblyId)).rounds.find((item) => item.runoffSourceRoundId === president.id)!
    const secretary = await singleVote(context, 'Secretario')

    await service.openRound(runoff.id)
    for (const voter of voters) await service.castVote(voter, runoff.id, idOf(runoff.options, 'Isaías'))
    await service.closeRound(runoff.id)
    await assert.rejects(service.openRound(secretary.id), ConflictException)

    await service.annulRound(runoff.id, 'Papeleta mal impresa')
    await service.openRound(secretary.id)
  })
})

test('annulment is refused once the election is on the roster', { skip }, async () => {
  await withAssembly(3, async (context) => {
    const { prisma, service, roster, voters } = context
    const president = await singleVote(context, 'Presidente')
    await service.openRound(president.id)
    for (const voter of voters) await service.castVote(voter, president.id, president.options[0]!.id)
    await service.closeRound(president.id)
    await roster.register(president.id)

    await assert.rejects(service.annulRound(president.id, 'Nombre mal escrito'), ConflictException)
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: president.id } })).status, 'published')
  })
})
