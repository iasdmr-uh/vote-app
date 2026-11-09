import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { type Api, startApi } from '../support/api.js'
import { seedAssembly } from '../support/seed.js'

let api: Api
let seeded: Awaited<ReturnType<typeof seedAssembly>>

before(async () => {
  api = await startApi()
  seeded = await seedAssembly(api.prisma, api.room, { label: 'http-validation' })
  await api.room.changeLobby(seeded.assemblyId, 'lobby_open')
})

after(async () => {
  await seeded?.cleanup()
  await api?.stop()
})

function sessionCount() {
  return api.prisma.participantSession.count({ where: { assemblyId: seeded.assemblyId } })
}

function join(body: unknown) {
  return api.request('POST', `/assemblies/${seeded.joinCode}/join`, { body })
}

describe('POST /assemblies/:code/join', () => {
  test('with a valid body, answers 201 and stores the session', async () => {
    const before = await sessionCount()

    const response = await join({ firstName: 'Delegado', lastName: '1' })

    assert.equal(response.status, 201)
    assert.equal(await sessionCount(), before + 1)
  })

  test('with a missing field, answers 400 and stores nothing', async () => {
    const before = await sessionCount()

    const response = await join({ firstName: 'Delegado' })

    assert.equal(response.status, 400)
    assert.equal(await sessionCount(), before)
  })

  test('with a wrong type, answers 400 and stores nothing', async () => {
    const before = await sessionCount()

    const response = await join({ firstName: 'Delegado', lastName: 2 })

    assert.equal(response.status, 400)
    assert.equal(await sessionCount(), before)
  })

  test('with an unknown field, answers 400 and stores nothing', async () => {
    const before = await sessionCount()

    const response = await join({ firstName: 'Delegado', lastName: '3', role: 'moderator' })

    assert.equal(response.status, 400)
    assert.equal(await sessionCount(), before)
  })

  test('with a body over 16 kB, answers 413 and stores nothing', async () => {
    const before = await sessionCount()

    const response = await join({ firstName: 'Delegado', lastName: '4', padding: 'x'.repeat(16 * 1024) })

    assert.equal(response.status, 413)
    assert.equal(await sessionCount(), before)
  })
})
