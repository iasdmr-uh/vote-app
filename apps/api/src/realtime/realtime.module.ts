import { Module } from '@nestjs/common'
import { RealtimeGateway } from './realtime.gateway.js'
import { AuthModule } from '../auth/auth.module.js'
import { RealtimeAuthService } from '../auth/auth.service.js'
import { REALTIME_AUTHORIZER } from './realtime.types.js'
import { ConnectionPresence, scheduleWithTimers } from './connection-presence.js'

@Module({
  imports: [AuthModule],
  providers: [
    RealtimeGateway,
    { provide: REALTIME_AUTHORIZER, useExisting: RealtimeAuthService },
    { provide: ConnectionPresence, useFactory: () => new ConnectionPresence(scheduleWithTimers) },
  ],
  exports: [RealtimeGateway, ConnectionPresence],
})
export class RealtimeModule {}
