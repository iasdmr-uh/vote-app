import { Injectable, NotFoundException } from '@nestjs/common'
import { MODERATOR_ACTOR } from '../auth/auth.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'

export type PresentationSlide = 0 | 1 | 2
export type PresentationState = { active: boolean; slide: PresentationSlide }

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001'

/** The presentation as the projector and the mesa read it. */
export function presentationOf(assembly: { presentationActive: boolean; presentationSlide: number }): PresentationState {
  return { active: assembly.presentationActive, slide: Math.min(2, Math.max(0, assembly.presentationSlide)) as PresentationSlide }
}

/**
 * «Presentar oficiales» (#48): the mesa turns it on and moves between the cover, the Junta directiva
 * and the Departamentos; the projector follows. Display only, so it also works once the assembly is completed.
 */
@Injectable()
export class PresentationService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeGateway) {}

  async setPresentation(input: { active: boolean; slide: PresentationSlide; assemblyId?: string }) {
    const assemblyId = input.assemblyId ?? (await this.prisma.assembly.findFirst({
      where: { organizationId: ORGANIZATION_ID, status: { in: ['preparing', 'lobby_open', 'lobby_closed', 'in_progress'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }))?.id
    if (!assemblyId) throw new NotFoundException('Asamblea no encontrada')
    const changed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ presentation_active: boolean; presentation_slide: number }>>`
        SELECT presentation_active, presentation_slide FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new NotFoundException('Asamblea no encontrada')
      if (current.presentation_active === input.active && current.presentation_slide === input.slide) return false
      await tx.assembly.update({ where: { id: assemblyId }, data: { presentationActive: input.active, presentationSlide: input.slide } })
      await tx.auditEvent.create({ data: { assemblyId, actorRef: MODERATOR_ACTOR, action: 'presentation.changed', metadata: { active: input.active, slide: input.slide } } })
      return true
    })
    const presentation = { active: input.active, slide: input.slide }
    if (changed) this.realtime.presentationState(assemblyId, presentation)
    return { assemblyId, presentation }
  }
}
