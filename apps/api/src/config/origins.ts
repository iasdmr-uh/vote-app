export function allowedWebOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function isAllowedWebOrigin(origin?: string): boolean {
  return origin === undefined || allowedWebOrigins().includes(origin)
}
