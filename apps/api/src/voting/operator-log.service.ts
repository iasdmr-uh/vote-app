import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { MODERATOR_ACTOR } from '../auth/auth.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { LOGGED_ACTIONS, LOG_DOWNLOADED, canEraseWithLog, operatorLogCsv, type LogPurpose } from './operator-log.js'

const loggedWhere = (assemblyId: string) => ({ assemblyId, action: { in: [...LOGGED_ACTIONS] } })

function fileSlug(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asamblea'
}

export async function requireLogDownloadedForDeletion(tx: Prisma.TransactionClient, assemblyId: string) {
  const newest = await tx.auditEvent.findFirst({
    where: loggedWhere(assemblyId), orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }], select: { action: true, metadata: true },
  })
  const recorded = await tx.auditEvent.count({ where: loggedWhere(assemblyId) })
  if (!canEraseWithLog(newest, recorded)) {
    throw new ConflictException('Descarga el registro para «Borrar datos» antes de borrar los datos')
  }
}

export async function keepRoundTitlesInLog(tx: Prisma.TransactionClient, roundIds: string[]) {
  const events = await tx.auditEvent.findMany({
    where: { roundId: { in: roundIds }, action: { in: [...LOGGED_ACTIONS] } }, select: { id: true, metadata: true, round: { select: { title: true } } },
  })
  for (const event of events) {
    const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {}
    await tx.auditEvent.update({ where: { id: event.id }, data: { metadata: { ...metadata, roundTitle: event.round?.title ?? null } } })
  }
}

@Injectable()
export class OperatorLogService {
  constructor(private readonly prisma: PrismaService) {}

  async download(assemblyId: string, purpose: LogPurpose) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ name: string }>>`SELECT name FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE`
      if (!rows[0]) throw new NotFoundException('Asamblea no encontrada')
      const entryCount = await tx.auditEvent.count({ where: loggedWhere(assemblyId) }) + 1
      const [{ at }] = await tx.$queryRaw<Array<{ at: Date }>>`SELECT GREATEST(clock_timestamp() AT TIME ZONE 'UTC', (SELECT max(occurred_at) FROM audit_events WHERE assembly_id = ${assemblyId}::uuid)) AS at`
      await tx.auditEvent.create({ data: { assemblyId, actorRef: MODERATOR_ACTOR, action: LOG_DOWNLOADED, occurredAt: at, metadata: { purpose, entryCount } } })
      const events = await tx.auditEvent.findMany({
        where: loggedWhere(assemblyId),
        select: { action: true, occurredAt: true, sequence: true, metadata: true, round: { select: { title: true } } },
      })
      const csv = operatorLogCsv(events.map((event) => ({ ...event, roundTitle: event.round?.title ?? null })))
      return { fileName: `registro-${fileSlug(rows[0].name)}.csv`, csv }
    })
  }
}
