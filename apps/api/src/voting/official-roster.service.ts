import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'
import { lockAssembly, recordAudit } from './assembly-tx.js'

@Injectable()
export class OfficialRosterService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeGateway) {}

  async register(rootRoundId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ assembly_id: string }>>`SELECT assembly_id FROM rounds WHERE id = ${rootRoundId}::uuid FOR UPDATE`
      const root = rows[0]
      if (!root) throw new NotFoundException('Elección no encontrada')
      const assembly = await lockAssembly(tx, root.assembly_id)
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus resultados')
      const result = await tx.officialResult.findUnique({ where: { roundId: rootRoundId }, select: { registeredAt: true, settledRound: { select: { status: true } } } })
      if (!result?.settledRound) throw new ConflictException('Esta elección no tiene resultado final')
      if (result.settledRound.status !== 'published') throw new ConflictException('El resultado todavía se está preparando')
      if (result.registeredAt) return { assemblyId: root.assembly_id, changed: false }
      await tx.officialResult.update({ where: { roundId: rootRoundId }, data: { registeredAt: new Date() } })
      await recordAudit(tx, { assemblyId: root.assembly_id, roundId: rootRoundId, action: 'results.registered' })
      return { assemblyId: root.assembly_id, changed: true }
    })
    if (outcome.changed) this.realtime.resultsRegistered(outcome.assemblyId, { roundId: rootRoundId })
    return this.entryOf(rootRoundId)
  }

  private async entryOf(rootRoundId: string) {
    const result = await this.prisma.officialResult.findUniqueOrThrow({
      where: { roundId: rootRoundId },
      select: { approved: true, registeredAt: true, options: { orderBy: { seatOrder: 'asc' }, select: { optionId: true, option: { select: { label: true } } } } },
    })
    return {
      roundId: rootRoundId,
      elected: result.options.map(({ optionId, option }) => ({ optionId, label: option.label })),
      approved: result.approved,
      registeredAt: result.registeredAt!.toISOString(),
    }
  }
}
