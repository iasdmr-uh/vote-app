import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { MODERATOR_CHANNEL_HEADER } from '../../src/config/moderator-channel.js'
import { type Api, moderatorToken, startApi } from '../support/api.js'
import { setEnv } from '../support/env.js'

let api: Api

before(async () => {
  api = await startApi()
})

after(async () => {
  await api?.stop()
})

describe('GET /moderator/session with MODERATOR_LOCAL_ONLY=true and the moderator token', () => {
  let restoreEnv: () => void

  beforeEach(() => {
    restoreEnv = setEnv({ MODERATOR_LOCAL_ONLY: 'true' })
  })

  afterEach(() => {
    restoreEnv()
  })

  test('without the channel header, answers 401', async () => {
    const response = await api.request('GET', '/moderator/session', { token: moderatorToken })

    assert.equal(response.status, 401)
  })

  for (const channel of ['public', 'LOCAL']) {
    test(`with the channel ${channel}, answers 401`, async () => {
      const response = await api.request('GET', '/moderator/session', { token: moderatorToken, headers: { [MODERATOR_CHANNEL_HEADER]: channel } })

      assert.equal(response.status, 401)
    })
  }

  test('with the channel local, answers 200', async () => {
    const response = await api.request('GET', '/moderator/session', { token: moderatorToken, headers: { [MODERATOR_CHANNEL_HEADER]: 'local' } })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { authenticated: true })
  })
})
