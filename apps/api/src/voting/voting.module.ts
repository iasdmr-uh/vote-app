import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { ModeratorController, ParticipantController, ParticipantLeaveController, PublicAssemblyController } from './voting.controller.js'
import { VotingService } from './voting.service.js'

@Module({
  imports: [PrismaModule, AuthModule, RealtimeModule],
  controllers: [PublicAssemblyController, ParticipantController, ParticipantLeaveController, ModeratorController],
  providers: [VotingService],
})
export class VotingModule {}
