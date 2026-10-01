const required = ['DATABASE_URL', 'MODERATOR_ACCESS_TOKEN', 'WEB_ORIGIN', 'PUBLIC_APP_URL'] as const

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`)
  }
  if ((env.MODERATOR_ACCESS_TOKEN ?? '').length < 32) {
    throw new Error('MODERATOR_ACCESS_TOKEN must contain at least 32 characters')
  }
  for (const key of ['WEB_ORIGIN', 'PUBLIC_APP_URL'] as const) {
    try {
      new URL(env[key]!)
    } catch {
      throw new Error(`${key} must be an absolute URL`)
    }
  }
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL!)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL')
  }
  const port = Number(env.API_PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer from 1 to 65535')
  }
}
