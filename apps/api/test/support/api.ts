import { createApp } from '../../src/create-app.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { RoomService } from '../../src/voting/room.service.js'
import { testDatabaseUrl } from './database.js'
import { setEnv } from './env.js'

export const moderatorToken = 'moderator-token-for-http-tests-0123456789'

export type ApiRequest = { token?: string; body?: unknown; headers?: Record<string, string> }

export async function startApi() {
  const restoreEnv = setEnv({
    DATABASE_URL: testDatabaseUrl!,
    MODERATOR_ACCESS_TOKEN: moderatorToken,
    WEB_ORIGIN: 'http://localhost:5173',
    PUBLIC_APP_URL: 'http://localhost:5173',
  })
  try {
    const app = await createApp({ logger: false })
    await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl()
    const request = (method: string, path: string, { token, body, headers = {} }: ApiRequest = {}) =>
      fetch(`${origin}/api/v1${path}`, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    return {
      app,
      prisma: app.get(PrismaService),
      room: app.get(RoomService),
      request,
      stop: async () => {
        await app.close()
        restoreEnv()
      },
    }
  } catch (error) {
    restoreEnv()
    throw error
  }
}

export type Api = Awaited<ReturnType<typeof startApi>>
