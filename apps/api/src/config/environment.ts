const required = ['DATABASE_URL', 'MODERATOR_ACCESS_TOKEN', 'WEB_ORIGIN', 'PUBLIC_APP_URL'] as const

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`)
  }
  if ((env.MODERATOR_ACCESS_TOKEN ?? '').length < 32) {
    throw new Error('MODERATOR_ACCESS_TOKEN must contain at least 32 characters')
  }
  const allowedOrigins = (env.WEB_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (allowedOrigins.length === 0) throw new Error('WEB_ORIGIN must contain at least one absolute URL')
  for (const origin of allowedOrigins) {
    try {
      new URL(origin)
    } catch {
      throw new Error('WEB_ORIGIN must contain only absolute URLs')
    }
  }
  try {
    new URL(env.PUBLIC_APP_URL!)
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute URL')
  }
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL!)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL')
  }
  const port = Number(env.API_PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer from 1 to 65535')
  }
}
