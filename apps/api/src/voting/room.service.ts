import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { hashCredential, newOpaqueCredential } from '../auth/credentials.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'
import type { AssemblyStatus } from '../generated/prisma/enums.js'
import { appUrl } from './app-url.js'
import { assertNoOpenRound, assertNotCompleted, lockAssembly, recordAudit } from './assembly-tx.js'
import { countInRoom } from './base-count.js'
import { VotingService } from './voting.service.js'

@Injectable()
export class RoomService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeGateway, private readonly voting: VotingService) {}

  async joinAssembly(assemblyCode: string, firstName: string, lastName: string) {
    const participantSessionToken = newOpaqueCredential()
    const assemblyCodeHash = hashCredential(assemblyCode)
    const tokenHash = hashCredential(participantSessionToken)
    const joined = await this.prisma.$transaction(async (tx) => {
      const assemblies = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM assemblies WHERE join_code_hash = ${assemblyCodeHash} FOR UPDATE
      `
      const assembly = assemblies[0]
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      await assertNoOpenRound(tx, assembly.id, 'Hay una votación en curso. Espera a que termine para ingresar.')
      if (assembly.status !== 'lobby_open') throw new ConflictException('El ingreso a la sala está cerrado')
      const participant = await tx.participantSession.create({
        data: {
          assemblyId: assembly.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          tokenHash,
        },
        select: { id: true, assemblyId: true, firstName: true, lastName: true },
      })
      const count = await countInRoom(tx, assembly.id)
      return { participant, count }
    })
    this.realtime.participantJoined(joined.participant.assemblyId, {
      participantId: joined.participant.id,
      firstName: joined.participant.firstName,
      lastName: joined.participant.lastName,
    })
    this.realtime.lobbyState(joined.participant.assemblyId, { status: 'open', participantCount: joined.count })
    const state = await this.voting.participantState(joined.participant.id)
    this.realtime.participantState(joined.participant.id, state)
    return {
      participantSessionToken,
      participant: { firstName: joined.participant.firstName, lastName: joined.participant.lastName },
      ...state,
    }
  }

  async takeOutOfRoom(participantId: string) {
    const result = await this.changeRoomPresence(participantId, 'left')
    if (result.changed) {
      this.realtime.participantLeft(result.assemblyId, { participantId: result.id, firstName: result.firstName, lastName: result.lastName })
      await this.announceRoomCount(result.assemblyId)
    }
    return { id: result.id, firstName: result.firstName, lastName: result.lastName, status: 'left' as const }
  }

  async returnToRoom(participantId: string) {
    const result = await this.changeRoomPresence(participantId, 'active')
    if (result.changed) {
      this.realtime.participantJoined(result.assemblyId, { participantId: result.id, firstName: result.firstName, lastName: result.lastName })
      await this.announceRoomCount(result.assemblyId)
    }
    return { id: result.id, firstName: result.firstName, lastName: result.lastName, status: 'active' as const }
  }

  private async changeRoomPresence(participantId: string, target: 'left' | 'active') {
    const identity = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { assemblyId: true } })
    if (!identity) throw new NotFoundException('Participante no encontrado')
    return this.prisma.$transaction(async (tx) => {
      await lockAssembly(tx, identity.assemblyId)
      const assembly = await tx.assembly.findUniqueOrThrow({ where: { id: identity.assemblyId }, select: { status: true } })
      assertNotCompleted(assembly.status)
      const current = await tx.participantSession.findUnique({
        where: { id: participantId },
        select: { id: true, assemblyId: true, firstName: true, lastName: true, status: true, isRegionalSecretary: true },
      })
      if (current?.isRegionalSecretary && target === 'active') throw new ConflictException('La secretaría regional no regresa a la sala; se agrega de nuevo desde la votación que corresponde')
      const from = target === 'left' ? 'active' : 'left'
      if (!current || (current.status !== from && !(target === 'left' && current.status === 'left'))) throw new NotFoundException('Participante no encontrado')
      if (await tx.round.count({ where: { assemblyId: current.assemblyId, status: 'open' } }) > 0) {
        throw new ConflictException(target === 'active' ? 'Regresa a la sala cuando cierre la votación abierta' : 'Retira de la sala cuando cierre la votación abierta')
      }
      if (current.status === target) return { ...current, changed: false }
      await tx.participantSession.update({
        where: { id: participantId },
        data: target === 'left'
          ? { status: 'left', resumeCodeHash: null, resumeExpiresAt: null }
          : { status: 'active', tokenHash: hashCredential(newOpaqueCredential()) },
      })
      if (current.isRegionalSecretary) await tx.round.updateMany({ where: { assemblyId: current.assemblyId, status: 'draft' }, data: { regionalSecretaryVotes: false } })
      await recordAudit(tx, { assemblyId: current.assemblyId, action: target === 'left' ? 'participant.taken_out' : 'participant.returned', metadata: { participantId, personName: `${current.firstName} ${current.lastName}` } })
      return { ...current, changed: true }
    })
  }

  private async announceRoomCount(assemblyId: string) {
    const [count, assembly] = await Promise.all([
      countInRoom(this.prisma, assemblyId),
      this.prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId }, select: { status: true } }),
    ])
    this.realtime.lobbyState(assemblyId, { status: assembly.status === 'lobby_open' ? 'open' : 'closed', participantCount: count })
  }

  async rotateJoinCode(assemblyId: string) {
    const joinCode = newOpaqueCredential()
    await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      assertNotCompleted(assembly.status)
      await assertNoOpenRound(tx, assemblyId, 'Cambia el código de ingreso cuando cierre la votación abierta')
      await tx.assembly.update({ where: { id: assemblyId }, data: { joinCodeHash: hashCredential(joinCode) } })
      await recordAudit(tx, { assemblyId, action: 'assembly.join_code_rotated' })
    })
    this.realtime.publicSessionsRevoked(assemblyId)
    return { joinCode, joinUrl: appUrl({ join: joinCode }) }
  }

  async reopenLobby(assemblyId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      assertNotCompleted(assembly.status)
      if (assembly.status === 'lobby_open') return { id: assembly.id, status: assembly.status, changed: false }
      const openRound = await tx.round.findFirst({ where: { assemblyId, status: 'open' }, select: { id: true } })
      if (openRound) throw new ConflictException('Cierra la papeleta abierta antes de reabrir el ingreso')
      const updated = await tx.assembly.update({ where: { id: assemblyId }, data: { status: 'lobby_open' }, select: { id: true, status: true } })
      await recordAudit(tx, { assemblyId, action: 'lobby.reopened', metadata: { previousStatus: assembly.status } })
      return { ...updated, changed: true }
    })
    if (!result.changed) return { id: result.id, status: result.status }
    const count = await countInRoom(this.prisma, assemblyId)
    this.realtime.assemblyState(assemblyId, { status: 'lobby_open' })
    this.realtime.lobbyState(assemblyId, { status: 'open', participantCount: count })
    return { id: result.id, status: result.status }
  }

  async changeLobby(assemblyId: string, status: 'lobby_open' | 'lobby_closed') {
    if (status === 'lobby_open') return this.reopenLobby(assemblyId)
    const result = await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      assertNotCompleted(assembly.status)
      if (assembly.status === 'lobby_closed' || assembly.status === 'in_progress') return { id: assembly.id, status: assembly.status, changed: false }
      if (assembly.status !== 'lobby_open') throw new ConflictException('La Asamblea no permite cerrar el ingreso')
      const updated = await tx.assembly.update({ where: { id: assemblyId }, data: { status: 'lobby_closed' }, select: { id: true, status: true } })
      await recordAudit(tx, { assemblyId, action: 'lobby.closed' })
      return { ...updated, changed: true }
    })
    if (!result.changed) return { id: result.id, status: result.status }
    const count = await countInRoom(this.prisma, assemblyId)
    this.realtime.assemblyState(assemblyId, { status: result.status as AssemblyStatus })
    this.realtime.lobbyState(assemblyId, { status: 'closed', participantCount: count })
    return result
  }

  async patchParticipant(participantId: string, input: { firstName?: string; lastName?: string; status?: 'removed' }) {
    const identity = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { assemblyId: true } })
    if (!identity) throw new NotFoundException('Participante no encontrado')
    if (input.firstName === undefined && input.lastName === undefined && input.status === undefined) {
      throw new UnprocessableEntityException('Indica un cambio para el participante')
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAssembly(tx, identity.assemblyId)
      const assembly = await tx.assembly.findUnique({ where: { id: identity.assemblyId }, select: { status: true } })
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      assertNotCompleted(assembly.status)
      const hasVoted = await tx.participation.count({ where: { participantSessionId: participantId } }) > 0
      if (assembly.status === 'in_progress' || hasVoted) {
        throw new ConflictException('La lista ya no admite cambios después de iniciar la votación')
      }
      const current = await tx.participantSession.findUnique({ where: { id: participantId }, select: { id: true, firstName: true, lastName: true } })
      if (!current) throw new NotFoundException('Participante no encontrado')
      const value = await tx.participantSession.update({
        where: { id: participantId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
          ...(input.status === 'removed' ? { status: 'removed' as const } : {}),
        },
        select: { id: true, assemblyId: true, firstName: true, lastName: true, status: true },
      })
      await recordAudit(tx, { assemblyId: identity.assemblyId, action: input.status === 'removed' ? 'participant.removed' : 'participant.corrected', metadata: { participantId, personName: `${current.firstName} ${current.lastName}`, ...(input.status === 'removed' ? {} : { newName: `${value.firstName} ${value.lastName}` }) } })
      return value
    })
    if (updated.status === 'removed') {
      this.realtime.participantRemoved(updated.assemblyId, updated.id)
      const count = await countInRoom(this.prisma, updated.assemblyId)
      const assembly = await this.prisma.assembly.findUniqueOrThrow({ where: { id: updated.assemblyId }, select: { status: true } })
      this.realtime.lobbyState(updated.assemblyId, { status: assembly.status === 'lobby_open' ? 'open' : 'closed', participantCount: count })
    } else this.realtime.participantUpdated(updated.assemblyId, { participantId: updated.id, firstName: updated.firstName, lastName: updated.lastName })
    return { id: updated.id, firstName: updated.firstName, lastName: updated.lastName, status: updated.status }
  }

  async setVotingDisabled(participantId: string, disabled: boolean) {
    const identity = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { assemblyId: true } })
    if (!identity) throw new NotFoundException('Participante no encontrado')
    const result = await this.prisma.$transaction(async (tx) => {
      await lockAssembly(tx, identity.assemblyId)
      const assembly = await tx.assembly.findUniqueOrThrow({ where: { id: identity.assemblyId }, select: { status: true } })
      assertNotCompleted(assembly.status)
      const current = await tx.participantSession.findUniqueOrThrow({
        where: { id: participantId }, select: { id: true, assemblyId: true, firstName: true, lastName: true, status: true, votingDisabled: true },
      })
      if (current.status !== 'active') throw new NotFoundException('Participante no encontrado')
      if (await tx.round.count({ where: { assemblyId: current.assemblyId, status: 'open' } }) > 0) {
        throw new ConflictException(disabled ? 'Inhabilita cuando cierre la votación abierta' : 'Habilita cuando cierre la votación abierta')
      }
      if (current.votingDisabled === disabled) return { ...current, changed: false }
      await tx.participantSession.update({ where: { id: participantId }, data: { votingDisabled: disabled } })
      await recordAudit(tx, {
        assemblyId: current.assemblyId,
        action: disabled ? 'participant.voting_disabled' : 'participant.voting_enabled',
        metadata: { participantId, personName: `${current.firstName} ${current.lastName}` },
      })
      return { ...current, changed: true }
    })
    if (result.changed) {
      this.realtime.participantVoting(result.assemblyId, { participantId: result.id, votingDisabled: disabled })
      this.realtime.participantState(result.id, await this.voting.participantState(result.id))
    }
    return { id: result.id, firstName: result.firstName, lastName: result.lastName, status: 'active' as const, votingDisabled: disabled }
  }
}
