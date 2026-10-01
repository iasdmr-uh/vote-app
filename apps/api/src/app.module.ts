import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthModule } from './auth/auth.module.js'
import { RateLimitGuard } from './auth/auth.guards.js'
import { HealthController } from './health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { RealtimeModule } from './realtime/realtime.module.js'
import { VotingModule } from './voting/voting.module.js'

@Module({
  imports: [PrismaModule, AuthModule, VotingModule, RealtimeModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
