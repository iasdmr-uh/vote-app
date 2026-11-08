import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConnectionPresence } from '../realtime/connection-presence.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'
import { connectedInBase } from './connected-in-base.js'
import { VotingService } from './voting.service.js'

@Injectable()
export class ConnectionCountService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionCountService.name)
  private readonly announced = new Map<string, string>()

  constructor(
    private readonly voting: VotingService,
    private readonly presence: ConnectionPresence,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.presence.onChange((assemblyId) => {
      this.announce(assemblyId).catch(() => this.logger.warn('Could not update the connected count'))
    })
  }

  async current(assemblyId: string) {
    const base = await this.voting.openRoundBase(assemblyId)
    if (!base) return null
    return { roundId: base.roundId, ...connectedInBase(base.participantIds, this.presence.online(assemblyId)) }
  }

  private async announce(assemblyId: string): Promise<void> {
    const count = await this.current(assemblyId)
    if (!count) {
      this.announced.delete(assemblyId)
      return
    }
    const key = `${count.roundId}:${count.connected}:${count.base}`
    if (this.announced.get(assemblyId) === key) return
    this.announced.set(assemblyId, key)
    this.realtime.connectionCount(assemblyId, count)
  }
}
