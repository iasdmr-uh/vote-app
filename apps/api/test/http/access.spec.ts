import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { type Api, moderatorToken, startApi } from '../support/api.js'
import { seedAssembly } from '../support/seed.js'

let api: Api
let seeded: Awaited<ReturnType<typeof seedAssembly>>

before(async () => {
  api = await startApi()
  seeded = await seedAssembly(api.prisma, api.room, { label: 'http-access', delegates: ['Delegado 1'] })
})

after(async () => {
  await seeded?.cleanup()
  await api?.stop()
})

describe('public routes', () => {
  test('GET /assemblies/:code/public-state: without a token, answers 200 with the assembly', async () => {
    const response = await api.request('GET', `/assemblies/${seeded.joinCode}/public-state`)

    assert.equal(response.status, 200)
    assert.equal((await response.json()).assembly.id, seeded.assemblyId)
  })
})

describe('participant routes', () => {
  test('GET /participant/me: with the delegate session token, answers 200', async () => {
    const response = await api.request('GET', '/participant/me', { token: seeded.people['Delegado 1']!.token })

    assert.equal(response.status, 200)
  })

  test('GET /participant/me: without a token, answers 401', async () => {
    const response = await api.request('GET', '/participant/me')

    assert.equal(response.status, 401)
  })

  test('GET /participant/me: with an unknown session token, answers 401', async () => {
    const response = await api.request('GET', '/participant/me', { token: 'unknown-session-token-0123456789' })

    assert.equal(response.status, 401)
  })
})

describe('moderator routes', () => {
  test('GET /moderator/session: with the moderator token, answers 200', async () => {
    const response = await api.request('GET', '/moderator/session', { token: moderatorToken })

    assert.equal(response.status, 200)
  })

  test('GET /moderator/session: without a token, answers 401', async () => {
    const response = await api.request('GET', '/moderator/session')

    assert.equal(response.status, 401)
  })

  test('GET /moderator/session: with a delegate session token, answers 401', async () => {
    const response = await api.request('GET', '/moderator/session', { token: seeded.people['Delegado 1']!.token })

    assert.equal(response.status, 401)
  })
})
