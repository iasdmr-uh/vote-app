import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthService, RealtimeAuthService } from './auth.service.js'
import { ModeratorGuard, ParticipantGuard, ParticipantSessionGuard } from './auth.guards.js'

@Module({
  imports: [PrismaModule],
  providers: [AuthService, RealtimeAuthService, ModeratorGuard, ParticipantGuard, ParticipantSessionGuard],
  exports: [AuthService, RealtimeAuthService, ModeratorGuard, ParticipantGuard, ParticipantSessionGuard],
})
export class AuthModule {}
