import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function hashCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function newOpaqueCredential(): string {
  return randomBytes(32).toString('base64url')
}

export function matchesSecret(provided: string, configured: string | undefined): boolean {
  if (!configured) return false
  const providedHash = Buffer.from(hashCredential(provided), 'hex')
  const configuredHash = Buffer.from(hashCredential(configured), 'hex')
  return timingSafeEqual(providedHash, configuredHash)
}
