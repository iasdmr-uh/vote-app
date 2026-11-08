import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('the published count gives "no votaron" as the majority base minus votes cast, inhabilitados included', {
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
    const organization = await prisma.organization.create({ data: { id: organizationId, name: `not-voted-test-${organizationId}`, type: 'union' } })
    const joinCode = newOpaqueCredential()
    assemblyId = (await prisma.assembly.create({ data: { organizationId: organization.id, name: 'Not voted test', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: Record<string, string> = {}
    for (const name of ['Ana', 'Luis', 'Marta', 'Pedro', 'Rosa']) {
      const joined = await service.joinAssembly(joinCode, name, 'Delegado')
      people[name] = (await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    const round = await service.createRound(assemblyId, {
      title: 'Presidencia', format: 'single_choice', countingRule: { kind: 'count_only' },
      options: [{ label: 'Opción A' }, { label: 'Opción B' }],
    })
    await service.openRound(round.id)
    await service.castVote(people.Ana!, round.id, round.options[0]!.id)
    await service.castVote(people.Marta!, round.id, round.options[0]!.id)
    // Luis is inhabilitado without voting and Pedro just does not vote: both count as "no votaron".
    await service.setVotingDisabled(people.Luis!, true)
    // Rosa votes and is inhabilitada afterwards: her vote is kept, so she is not among them.
    await service.castVote(people.Rosa!, round.id, round.options[1]!.id)
    await service.setVotingDisabled(people.Rosa!, true)
    await service.closeRound(round.id)
    await service.publishRound(round.id)

    const mesa = (await service.moderatorAssembly(assemblyId)).rounds.find((item) => item.id === round.id)!
    assert.equal(mesa.eligibleCount, 5)
    assert.equal(mesa.participationCount, 3)
    assert.equal(mesa.outcome?.base, mesa.eligibleCount, 'same base as the majority')
    assert.equal(mesa.eligibleCount - mesa.participationCount, 2)

    const projector = await service.publicState(joinCode)
    assert.equal(projector.recordedCount, 3)
    assert.equal(projector.eligibleCount, 5)
    assert.equal(projector.outcome?.base, projector.eligibleCount)

    const phone = await service.participantState(people.Marta!)
    assert.equal(phone.recordedCount, 3)
    assert.equal(phone.eligibleCount, 5)

    await service.takeOutOfRoom(people.Pedro!)
    assert.equal((await service.publicState(joinCode)).eligibleCount, 5)
  } finally {
    if (assemblyId) {
      await prisma.round.deleteMany({ where: { assemblyId } })
      await prisma.assembly.delete({ where: { id: assemblyId } }).catch(() => undefined)
    }
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
})
