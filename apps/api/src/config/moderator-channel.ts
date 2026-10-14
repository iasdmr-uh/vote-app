import type { IncomingHttpHeaders } from 'node:http'

/** Set by the LAN proxy on every request: `local` on the listener bound to the laptop, `public` on the Wi-Fi one. */
export const MODERATOR_CHANNEL_HEADER = 'x-asdmr-channel'

/**
 * In LAN mode the mesa works only from the server laptop. The proxy overwrites this header on both
 * listeners and the API is not reachable without the proxy, so a phone on the Wi-Fi cannot claim `local`.
 */
export function isModeratorChannelAllowed(headers: IncomingHttpHeaders | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MODERATOR_LOCAL_ONLY !== 'true') return true
  return headers?.[MODERATOR_CHANNEL_HEADER] === 'local'
}
