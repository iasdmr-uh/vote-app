import { ConflictException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { MODERATOR_ACTOR } from '../auth/actors.js'

export async function lockAssembly(tx: Prisma.TransactionClient, assemblyId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
  `
  return rows[0]
}

export function assertNotCompleted(status: string) {
  if (status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
}

export function recordAudit(tx: Prisma.TransactionClient, data: Omit<Prisma.AuditEventUncheckedCreateInput, 'actorRef'> & { actorRef?: string }) {
  return tx.auditEvent.create({ data: { actorRef: MODERATOR_ACTOR, ...data } })
}
