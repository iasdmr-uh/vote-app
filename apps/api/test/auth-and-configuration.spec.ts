import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpException, type ExecutionContext } from '@nestjs/common'
import { hashCredential, matchesSecret, newOpaqueCredential } from '../src/auth/credentials.js'
import { ModeratorGuard } from '../src/auth/auth.guards.js'
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
  const auth = { verifyModeratorToken: (token?: string) => token === 'valid-moderator-token' } as AuthService
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
})
