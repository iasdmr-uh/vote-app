import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { ModeratorController, ParticipantController, ParticipantLeaveController, PublicAssemblyController } from './voting.controller.js'
import { VotingService } from './voting.service.js'
import { PresentationService } from './presentation.service.js'
import { ConnectionCountService } from './connection-count.service.js'
import { OperatorLogService } from './operator-log.service.js'

@Module({
  imports: [PrismaModule, AuthModule, RealtimeModule],
  controllers: [
    ModeratorController,
    ParticipantController,
    ParticipantLeaveController,
    PublicAssemblyController,
  ],
  providers: [
    ConnectionCountService,
    OperatorLogService,
    PresentationService,
    VotingService,
  ],
})
export class VotingModule {}
