import type { PrismaService } from '../../src/prisma/prisma.service.js'
import type { RealtimeGateway } from '../../src/realtime/realtime.gateway.js'
import { OperatorLogService } from '../../src/voting/operator-log.service.js'
import { PresentationService } from '../../src/voting/presentation.service.js'
import { RoomService } from '../../src/voting/room.service.js'
import { VotingService } from '../../src/voting/voting.service.js'
import { gatewayStub } from './gateway.js'

export function buildProviders(prisma: object, gateway: object = gatewayStub().gateway) {
  const database = prisma as PrismaService
  const realtime = gateway as RealtimeGateway
  const voting = new VotingService(database, realtime)
  return {
    voting,
    room: new RoomService(database, realtime, voting),
    presentation: new PresentationService(database, realtime),
    operatorLog: new OperatorLogService(database),
  }
}
