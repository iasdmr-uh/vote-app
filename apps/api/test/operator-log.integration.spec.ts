import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import { OperatorLogService } from '../src/voting/operator-log.service.js'
import { PresentationService } from '../src/voting/presentation.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const skip = !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false

async function setup() {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  const realtime = new Proxy({}, { get: () => () => undefined }) as RealtimeGateway
  const voting = new VotingService(prisma, realtime)
  const log = new OperatorLogService(prisma)
  const presentation = new PresentationService(prisma, realtime)
  const organization = await prisma.organization.create({ data: { id: randomUUID(), name: `log-test-${randomUUID()}`, type: 'union' } })
  const joinCode = newOpaqueCredential()
  const assemblyId = (await prisma.assembly.create({
    data: { organizationId: organization.id, name: 'Asamblea de prueba', status: 'lobby_open', joinCodeHash: hashCredential(joinCode) },
  })).id
  const join = async (number: number) => {
    const joined = await voting.joinAssembly(joinCode, 'Delegado', String(number))
    return (await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })).id
  }
  const cleanup = async () => {
    await prisma.round.deleteMany({ where: { assemblyId } })
    await prisma.participantSession.deleteMany({ where: { assemblyId } })
    await prisma.auditEvent.deleteMany({ where: { assemblyId } })
    await prisma.assembly.deleteMany({ where: { id: assemblyId } })
    await prisma.organization.deleteMany({ where: { id: organization.id } })
    await prisma.$disconnect()
  }
  return { prisma, voting, log, presentation, assemblyId, join, cleanup }
}

const actionsOf = (csv: string) => csv.slice(1).trimEnd().split('\r\n').slice(1).map((line) => line.split('","')[2]!.replace(/"$/, ''))

test('entries about a person name them as they were when the action happened', { skip }, async () => {
  const { voting, log, assemblyId, join, cleanup } = await setup()
  try {
    const twelve = await join(12)
    const seven = await join(7)
    await voting.takeOutOfRoom(twelve)
    await voting.returnToRoom(twelve)
    await voting.setVotingDisabled(twelve, true)
    await voting.setVotingDisabled(twelve, false)
    await voting.patchParticipant(twelve, { lastName: '21' })
    await voting.patchParticipant(seven, { status: 'removed' })
    await voting.changeLobby(assemblyId, 'lobby_closed')
    await voting.issueResumeCode(twelve)

    const { csv } = await log.download(assemblyId, 'review')
    assert.deepEqual(actionsOf(csv), [
      'Delegado 12 retirado de la sala',
      'Delegado 12 readmitido en la sala',
      'Delegado 12 inhabilitado para votar',
      'Delegado 12 habilitado para votar',
      'Nombre de Delegado 12 corregido a Delegado 21',
      'Delegado 7 quitado de la lista',
      'Sala cerrada',
      'Código para reconectar el dispositivo de Delegado 21',
      'Registro descargado',
    ])
  } finally {
    await cleanup()
  }
})

test('the download is the last entry of its own file, and the file keeps votes secret', { skip }, async () => {
  const { prisma, voting, log, assemblyId, join, cleanup } = await setup()
  try {
    const voters = [await join(1), await join(2), await join(3)]
    await voting.changeLobby(assemblyId, 'lobby_closed')
    const round = await voting.createRound(assemblyId, {
      title: 'Presidente', format: 'single_choice', options: [{ label: 'Isaías' }, { label: 'Jeremías' }], countingRule: { kind: 'count_only' },
    })
    await voting.openRound(round.id)
    await voting.castVote(voters[0]!, round.id, round.options[0]!.id)
    await voting.castVote(voters[1]!, round.id, round.options[1]!.id)
    await voting.closeRound(round.id)
    await voting.annulRound(round.id, 'Error en la papeleta')

    const { csv, fileName } = await log.download(assemblyId, 'delete')
    assert.equal(fileName, 'registro-asamblea-de-prueba.csv')
    const actions = actionsOf(csv)
    assert.equal(actions.at(-1), 'Registro descargado para «Borrar datos»')
    assert.ok(actions.includes('Votación anulada: Presidente. Motivo: Error en la papeleta'))
    for (const id of voters) assert.ok(!csv.includes(id), 'no participant id')
    assert.ok(!/Delegado [123]/.test(csv), 'no entry names a voter')
    assert.ok(!/vot[óo] por|Isaías|Jeremías/.test(csv), 'no choice')

    const download = await prisma.auditEvent.findFirstOrThrow({ where: { assemblyId, action: 'log.downloaded' } })
    assert.deepEqual(download.metadata, { purpose: 'delete', entryCount: actions.length })
  } finally {
    await cleanup()
  }
})

test('the download sorts last even after an entry stamped later than the download began', { skip }, async () => {
  const { prisma, log, assemblyId, cleanup } = await setup()
  try {
    await prisma.auditEvent.create({ data: { assemblyId, actorRef: 'test', action: 'lobby.closed', occurredAt: new Date(Date.now() + 60_000), metadata: {} } })
    const { csv } = await log.download(assemblyId, 'delete')
    assert.deepEqual(actionsOf(csv), ['Sala cerrada', 'Registro descargado para «Borrar datos»'])
  } finally {
    await cleanup()
  }
})

test('a refused action is not logged', { skip }, async () => {
  const { prisma, voting, assemblyId, cleanup } = await setup()
  try {
    await voting.changeLobby(assemblyId, 'lobby_closed')
    await voting.completeAssembly(assemblyId, true)
    const before = await prisma.auditEvent.count({ where: { assemblyId } })
    await assert.rejects(voting.changeLobby(assemblyId, 'lobby_open'))
    assert.equal(await prisma.auditEvent.count({ where: { assemblyId } }), before)
  } finally {
    await cleanup()
  }
})

test('a delegate joining is not logged', { skip }, async () => {
  const { voting, log, assemblyId, join, cleanup } = await setup()
  try {
    await join(1)
    await join(2)
    const { csv } = await log.download(assemblyId, 'review')
    assert.deepEqual(actionsOf(csv), ['Registro descargado'])
  } finally {
    await cleanup()
  }
})

test('a «Reconectar dispositivo» redemption is left out of the file', { skip }, async () => {
  const { voting, log, assemblyId, join, cleanup } = await setup()
  try {
    const twelve = await join(12)
    await voting.changeLobby(assemblyId, 'lobby_closed')
    const issued = await voting.issueResumeCode(twelve)
    await voting.redeemResumeCode(new URL(issued.resumeUrl).searchParams.get('resume')!)
    const { csv } = await log.download(assemblyId, 'review')
    assert.deepEqual(actionsOf(csv), ['Sala cerrada', 'Código para reconectar el dispositivo de Delegado 12', 'Registro descargado'])
  } finally {
    await cleanup()
  }
})

test('«Borrar datos» needs a download for it with every entry recorded so far', { skip }, async () => {
  const { voting, log, presentation, assemblyId, join, cleanup } = await setup()
  try {
    await join(1)
    await voting.changeLobby(assemblyId, 'lobby_closed')
    await voting.completeAssembly(assemblyId, true)

    await assert.rejects(voting.deleteAssemblyData(assemblyId, true), /Descarga el registro/)
    await log.download(assemblyId, 'review')
    await assert.rejects(voting.deleteAssemblyData(assemblyId, true), /Descarga el registro/, 'a plain download does not count')

    await log.download(assemblyId, 'delete')
    await presentation.setPresentation({ assemblyId, active: true, slide: 0 })
    await assert.rejects(voting.deleteAssemblyData(assemblyId, true), /Descarga el registro/, 'an action after the download')

    await log.download(assemblyId, 'delete')
    assert.equal((await voting.deleteAssemblyData(assemblyId, true)).deleted, true)
  } finally {
    await cleanup()
  }
})

test('the gate catches an entry that sorts before the download but is missing from its file', { skip }, async () => {
  const { prisma, voting, log, assemblyId, cleanup } = await setup()
  try {
    await voting.changeLobby(assemblyId, 'lobby_closed')
    await voting.completeAssembly(assemblyId, true)
    await log.download(assemblyId, 'delete')
    await prisma.auditEvent.create({ data: { assemblyId, actorRef: 'test', action: 'presentation.changed', occurredAt: new Date(0), metadata: { active: false } } })
    await assert.rejects(voting.deleteAssemblyData(assemblyId, true), /Descarga el registro/)
  } finally {
    await cleanup()
  }
})

test('the log of an unknown assembly is not found', { skip }, async () => {
  const { log, cleanup } = await setup()
  try {
    await assert.rejects(log.download(randomUUID(), 'review'), /no encontrada/)
  } finally {
    await cleanup()
  }
})
