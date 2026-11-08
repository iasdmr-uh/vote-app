import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Logger } from '@nestjs/common'
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants.js'
import { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'
import { ConnectionPresence } from '../../src/realtime/connection-presence.js'
import { CONNECTION_GRACE_MS, HEARTBEAT_MS } from '../../src/realtime/connection-timing.js'
import type { RealtimeAuthorizer, RealtimeIdentity } from '../../src/realtime/realtime.types.js'

function socket(auth: unknown) {
  return {
    handshake: { auth, headers: {} },
    data: {} as Record<string, unknown>,
    async join() {},
    disconnect() {},
  }
}

function setup(identity: RealtimeIdentity | Error) {
  const pending: Array<() => void> = []
  const presence = new ConnectionPresence((run) => { pending.push(run); return () => { pending.splice(pending.indexOf(run), 1) } })
  const authorizer: RealtimeAuthorizer = {
    async authenticate() { if (identity instanceof Error) throw identity; return identity },
  }
  return { gateway: new RealtimeGateway(authorizer, presence), presence, runTimers: () => pending.splice(0).forEach((run) => run()) }
}

const participant = { audience: 'participant', participantSessionToken: 'opaque-token' }

test('a participant socket counts as connected until it disconnects', async () => {
  const { gateway, presence, runTimers } = setup({ audience: 'participant', assemblyId: 'assembly-7', sessionId: 'session-3' })
  const client = socket(participant)

  await gateway.handleConnection(client as never)
  assert.deepEqual(presence.online('assembly-7'), ['session-3'])

  gateway.handleDisconnect(client as never)
  runTimers()
  assert.deepEqual(presence.online('assembly-7'), [])
})

test('public and moderator sockets are not counted as phones', async () => {
  const { gateway, presence } = setup({ audience: 'public', assemblyId: 'assembly-7' })
  await gateway.handleConnection(socket({ audience: 'public', assemblyCode: 'code' }) as never)
  assert.deepEqual(presence.online('assembly-7'), [])
})

test('a rejected socket is not counted and its disconnect changes nothing', async () => {
  const { gateway, presence, runTimers } = setup(new Error('invalid'))
  const client = socket(participant)
  await gateway.handleConnection(client as never)
  gateway.handleDisconnect(client as never)
  runTimers()
  assert.deepEqual(presence.online('assembly-7'), [])
})

test('connecting and disconnecting phones log nothing about the participant', async () => {
  const lines: string[] = []
  const methods = ['log', 'warn', 'error', 'debug', 'verbose'] as const
  const originals = methods.map((name) => Logger.prototype[name])
  for (const name of methods) Logger.prototype[name] = function (...args: unknown[]) { lines.push(JSON.stringify(args)) } as never
  try {
    const { gateway, runTimers } = setup({ audience: 'participant', assemblyId: 'assembly-7', sessionId: 'session-3' })
    const client = socket(participant)
    await gateway.handleConnection(client as never)
    gateway.handleDisconnect(client as never)
    runTimers()
  } finally {
    methods.forEach((name, i) => { Logger.prototype[name] = originals[i] as never })
  }
  assert.equal(lines.some((line) => line.includes('session-3')), false)
})

test('the gateway checks each connection on the shortened heartbeat', () => {
  const options = Reflect.getMetadata(GATEWAY_OPTIONS, RealtimeGateway) as { pingInterval?: number; pingTimeout?: number }
  assert.equal(options.pingInterval, HEARTBEAT_MS)
  assert.equal(options.pingTimeout, HEARTBEAT_MS)
  assert.ok(CONNECTION_GRACE_MS > 0)
})

test('a socket that closed while it was being authenticated is not counted', async () => {
  const { gateway, presence } = setup({ audience: 'participant', assemblyId: 'assembly-7', sessionId: 'session-3' })
  const client = { ...socket(participant), disconnected: true }
  await gateway.handleConnection(client as never)
  assert.deepEqual(presence.online('assembly-7'), [])
})
