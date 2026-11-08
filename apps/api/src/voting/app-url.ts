export function appUrl(params: Record<string, string>) {
  const url = new URL(process.env.PUBLIC_APP_URL!)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}
