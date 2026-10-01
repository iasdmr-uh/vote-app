import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthService, RealtimeAuthService } from './auth.service.js'
import { ModeratorGuard, ParticipantGuard } from './auth.guards.js'

@Module({
  imports: [PrismaModule],
  providers: [AuthService, RealtimeAuthService, ModeratorGuard, ParticipantGuard],
  exports: [AuthService, RealtimeAuthService, ModeratorGuard, ParticipantGuard],
})
export class AuthModule {}
