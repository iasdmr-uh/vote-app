import { Module } from '@nestjs/common'
import { RealtimeGateway } from './realtime.gateway.js'
import { AuthModule } from '../auth/auth.module.js'
import { RealtimeAuthService } from '../auth/auth.service.js'
import { REALTIME_AUTHORIZER } from './realtime.types.js'

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, { provide: REALTIME_AUTHORIZER, useExisting: RealtimeAuthService }],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
