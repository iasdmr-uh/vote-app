import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpException, type ExecutionContext } from '@nestjs/common'
import { hashCredential, matchesSecret, newOpaqueCredential } from '../src/auth/credentials.js'
import { ModeratorGuard, RateLimitGuard } from '../src/auth/auth.guards.js'
import type { AuthService } from '../src/auth/auth.service.js'
import { validateEnvironment } from '../src/config/environment.js'

function httpContext(authorization?: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext
}

test('opaque credentials are random-looking and are never their stored digest', () => {
  const token = newOpaqueCredential()
  assert.ok(token.length >= 40)
  assert.notEqual(hashCredential(token), token)
  assert.notEqual(newOpaqueCredential(), token)
})

test('moderator credentials compare by digest and reject missing or incorrect values', () => {
  assert.equal(matchesSecret('a sufficiently long local secret', 'a sufficiently long local secret'), true)
  assert.equal(matchesSecret('wrong secret', 'a sufficiently long local secret'), false)
  assert.equal(matchesSecret('anything', undefined), false)
})

test('moderator guard rejects missing credentials and accepts a valid credential', () => {
  const auth = { verifyModeratorToken: (token?: string) => token === 'valid-moderator-token' } as unknown as AuthService
  const guard = new ModeratorGuard(auth)

  assert.throws(() => guard.canActivate(httpContext()), (error: unknown) => {
    assert.ok(error instanceof HttpException)
    assert.equal(error.getStatus(), 401)
    return true
  })
  assert.equal(guard.canActivate(httpContext('Bearer valid-moderator-token')), true)
})

test('startup configuration validates required URLs, database and moderator secret length', () => {
  const valid = {
    DATABASE_URL: 'postgresql://voter:local@localhost:5432/votes',
    MODERATOR_ACCESS_TOKEN: 'a sufficiently long local secret',
    WEB_ORIGIN: 'http://localhost:5173',
    PUBLIC_APP_URL: 'http://localhost:5173',
    API_PORT: '3000',
  }
  assert.doesNotThrow(() => validateEnvironment(valid))
  assert.doesNotThrow(() => validateEnvironment({ ...valid, WEB_ORIGIN: 'http://localhost:5173, http://192.168.2.6:5173' }))
  assert.throws(() => validateEnvironment({ ...valid, MODERATOR_ACCESS_TOKEN: 'too-short' }), /at least 32/)
  assert.throws(() => validateEnvironment({ ...valid, DATABASE_URL: 'file:local' }), /PostgreSQL/)
  assert.throws(() => validateEnvironment({ ...valid, WEB_ORIGIN: 'not-a-url' }), /absolute URL/)
  assert.doesNotThrow(() => validateEnvironment({ ...valid, TRUST_PROXY_HOPS: '1' }))
  assert.throws(() => validateEnvironment({ ...valid, TRUST_PROXY_HOPS: 'yes' }), /TRUST_PROXY_HOPS/)
  assert.doesNotThrow(() => validateEnvironment({ ...valid, ALLOW_START_WITH_PENDING_VOTE_CLEANUP: 'true' }))
  assert.throws(() => validateEnvironment({ ...valid, ALLOW_START_WITH_PENDING_VOTE_CLEANUP: 'yes' }), /ALLOW_START_WITH_PENDING_VOTE_CLEANUP/)
})

function rateLimitContext(ip: string, authorization?: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ ip, headers: { authorization } }) }),
  } as unknown as ExecutionContext
}

function requestsUntilLimited(guard: RateLimitGuard, context: () => ExecutionContext, attempts: number): number {
  for (let index = 1; index <= attempts; index += 1) {
    try { guard.canActivate(context()) } catch (error) {
      assert.ok(error instanceof HttpException && error.getStatus() === 429)
      return index
    }
  }
  return 0
}

test('rate limit gives each session its own budget so a shared venue IP does not throttle the room', () => {
  const guard = new RateLimitGuard()
  const venueIp = '203.0.113.10'
  for (let delegate = 0; delegate < 5; delegate += 1) {
    assert.equal(requestsUntilLimited(guard, () => rateLimitContext(venueIp, `Bearer delegate-${delegate}`), 1000), 0)
  }
  assert.equal(requestsUntilLimited(guard, () => rateLimitContext(venueIp), 1000), 0, 'the projector keeps its own anonymous budget')
  assert.equal(requestsUntilLimited(guard, () => rateLimitContext(venueIp, 'Bearer delegate-0'), 1), 1, 'one session still has a ceiling')
})

test('rate limit caps an IP that rotates random tokens', () => {
  const guard = new RateLimitGuard()
  let counter = 0
  const limitedAt = requestsUntilLimited(guard, () => rateLimitContext('198.51.100.7', `Bearer random-${counter++}`), 7000)
  assert.equal(limitedAt, 6001)
})
