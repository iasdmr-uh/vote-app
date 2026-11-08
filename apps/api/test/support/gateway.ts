import type { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'

export type GatewayEvent = { name: string; target: unknown; payload: unknown }

export function gatewayStub() {
  const events: GatewayEvent[] = []
  const gateway = new Proxy({}, {
    get: (_target, name: string) => (...args: unknown[]) => {
      events.push({ name, target: args[0], payload: args[1] })
    },
  }) as RealtimeGateway
  return { gateway, events }
}
