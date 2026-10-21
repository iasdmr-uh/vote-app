import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import pg from 'pg'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { hashCredential, newOpaqueCredential } from '../auth/credentials.js'
import { MODERATOR_ACTOR } from '../auth/auth.service.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'
import type { AssemblyStatus, RoundStatus } from '../generated/prisma/enums.js'
import type { CommitteeApprovalDto, CommitteeConfigurationUpdateDto, CreateRoundDto, OfficialResultDto, RepeatRoundDto } from './dtos.js'

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001'
const RESUME_CODE_TTL_MS = 10 * 60_000
const VACUUM_LOCK_TIMEOUT_MS = 5_000
/** Every ballot offers this option (Secretaría, Oct 2026); it is counted apart and never declared elected. */
const NULL_VOTE_LABEL = 'Voto nulo'
/** Rounds whose votes are at rest and must be unlinked from their participation receipts. */
const SETTLED_ROUND_STATUSES = ['closed', 'published', 'annulled'] as const
const SECRECY_CLEANUP_PENDING = 'No se completó la limpieza que protege el secreto del voto. La operación no se realizó; usa «Reintentar limpieza» en unos segundos.'

@Injectable()
export class VotingService implements OnModuleInit {
  private readonly logger = new Logger(VotingService.name)

  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeGateway) {}

  /**
   * Finishes any pending vote unlinking on every deploy or restart, including rounds closed or
   * published before unlinking existed and assemblies that are already completed. Fails startup
   * unless the head table explicitly accepts running with linkable votes at rest (for example, a
   * full disk during an assembly), because a deploy must not come up silently in that state.
   */
  async onModuleInit() {
    try {
      await this.ensureVotesUnlinked()
    } catch (error) {
      const message = `Vote unlinking at startup did not complete: ${(error as Error).message}`
      if (process.env.ALLOW_START_WITH_PENDING_VOTE_CLEANUP !== 'true') {
        throw new Error(`${message}. Refusing to start; fix the cause or set ALLOW_START_WITH_PENDING_VOTE_CLEANUP=true as an explicit emergency decision.`)
      }
      this.logger.error(`${message}. STARTING ANYWAY because ALLOW_START_WITH_PENDING_VOTE_CLEANUP=true: votes of affected rounds remain linkable at rest; publishing and completing stay blocked until cleanup succeeds.`)
    }
  }

  async retrySecrecyCleanup(assemblyId: string) {
    await this.ensureVotesUnlinkedOrFail(assemblyId)
    return { assemblyId, secrecyCleanupPending: false }
  }

  async createAssembly(name: string) {
    const joinCode = newOpaqueCredential()
    const joinCodeHash = hashCredential(joinCode)
    await this.prisma.organization.upsert({
      where: { id: ORGANIZATION_ID },
      create: { id: ORGANIZATION_ID, name: 'Unión Hondureña ASDMR', type: 'union' },
      update: {},
    })
    const assembly = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${ORGANIZATION_ID}::uuid FOR UPDATE`
      const liveAssembly = await tx.assembly.findFirst({
        where: { organizationId: ORGANIZATION_ID, status: { in: ['lobby_open', 'lobby_closed', 'in_progress'] } },
        select: { id: true },
      })
      if (liveAssembly) throw new ConflictException('Ya existe una Asamblea activa')
      const created = await tx.assembly.create({
        data: { organizationId: ORGANIZATION_ID, name: name.trim(), status: 'lobby_open', joinCodeHash },
        select: { id: true, name: true, status: true },
      })
      await tx.auditEvent.create({
        data: { assemblyId: created.id, actorRef: MODERATOR_ACTOR, action: 'assembly.created_and_lobby_opened' },
      })
      return created
    })
    this.realtime.assemblyState(assembly.id, { status: assembly.status })
    this.realtime.lobbyState(assembly.id, { status: 'open', participantCount: 0 })
    return { assemblyId: assembly.id, name: assembly.name, status: assembly.status, joinCode, joinUrl: this.appUrl({ join: joinCode }) }
  }

  private appUrl(params: Record<string, string>) {
    const url = new URL(process.env.PUBLIC_APP_URL!)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }

  /**
   * Lets the moderator move a delegate to a new device after check-in closed. The participation
   * receipts stay on the same session, so moving devices can never yield a second vote.
   */
  async issueResumeCode(participantId: string) {
    const resumeCode = newOpaqueCredential()
    const expiresAt = new Date(Date.now() + RESUME_CODE_TTL_MS)
    const participant = await this.prisma.$transaction(async (tx) => {
      const current = await tx.participantSession.findUnique({
        where: { id: participantId }, select: { id: true, assemblyId: true, status: true, firstName: true, lastName: true, assembly: { select: { status: true } } },
      })
      if (!current || current.status !== 'active') throw new NotFoundException('Participante no encontrado')
      if (current.assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
      await tx.participantSession.update({ where: { id: participantId }, data: { resumeCodeHash: hashCredential(resumeCode), resumeExpiresAt: expiresAt } })
      await tx.auditEvent.create({ data: { assemblyId: current.assemblyId, actorRef: MODERATOR_ACTOR, action: 'participant.resume_code_issued', metadata: { participantId } } })
      return current
    })
    return {
      participantId,
      name: `${participant.firstName} ${participant.lastName}`,
      resumeUrl: this.appUrl({ resume: resumeCode }),
      expiresAt: expiresAt.toISOString(),
    }
  }

  async redeemResumeCode(resumeCode: string) {
    const participantSessionToken = newOpaqueCredential()
    const resumeCodeHash = hashCredential(resumeCode)
    const participant = await this.prisma.$transaction(async (tx) => {
      const current = await tx.participantSession.findUnique({
        where: { resumeCodeHash }, select: { id: true, assemblyId: true, status: true, firstName: true, lastName: true, resumeExpiresAt: true },
      })
      if (!current || current.status !== 'active' || !current.resumeExpiresAt || current.resumeExpiresAt <= new Date()) {
        throw new NotFoundException('El código de reconexión no es válido o ya venció')
      }
      // Conditional update makes the code single-use even if two devices redeem it at once.
      const claimed = await tx.participantSession.updateMany({
        where: { id: current.id, resumeCodeHash },
        data: { tokenHash: hashCredential(participantSessionToken), resumeCodeHash: null, resumeExpiresAt: null },
      })
      if (claimed.count !== 1) throw new NotFoundException('El código de reconexión no es válido o ya venció')
      await tx.auditEvent.create({ data: { assemblyId: current.assemblyId, actorRef: MODERATOR_ACTOR, action: 'participant.resume_code_redeemed', metadata: { participantId: current.id } } })
      return current
    })
    this.realtime.participantSessionReplaced(participant.id)
    const state = await this.participantState(participant.id)
    return {
      participantSessionToken,
      participant: { firstName: participant.firstName, lastName: participant.lastName },
      ...state,
    }
  }

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
      const count = await tx.participantSession.count({ where: { assemblyId: assembly.id, status: 'active' } })
      return { participant, count }
    })
    this.realtime.participantJoined(joined.participant.assemblyId, {
      participantId: joined.participant.id,
      firstName: joined.participant.firstName,
      lastName: joined.participant.lastName,
    })
    this.realtime.lobbyState(joined.participant.assemblyId, { status: 'open', participantCount: joined.count })
    const state = await this.participantState(joined.participant.id)
    this.realtime.participantState(joined.participant.id, state)
    return {
      participantSessionToken,
      participant: { firstName: joined.participant.firstName, lastName: joined.participant.lastName },
      ...state,
    }
  }

  async participantState(participantId: string) {
    const participant = await this.prisma.participantSession.findUnique({
      where: { id: participantId },
      include: { assembly: { select: { id: true, name: true, status: true, completedAt: true } } },
    })
    if (!participant || participant.status !== 'active') throw new NotFoundException('Sesión no encontrada')
    const round = await this.prisma.round.findFirst({
      where: { assemblyId: participant.assemblyId, OR: [
        { status: { in: ['open', 'closed', 'published', 'annulled'] } },
        { category: 'committee', status: 'draft', committeeStage: { in: ['proposals', 'support'] } },
      ] },
      orderBy: { createdAt: 'desc' },
      include: { options: { orderBy: { order: 'asc' }, select: { id: true, label: true, isNullVote: true } } },
    })
    const participation = round
      ? await this.prisma.participation.findUnique({
          where: { roundId_participantSessionId: { roundId: round.id, participantSessionId: participant.id } },
          select: { id: true },
        })
      : null
    const openRound = round
      ? { roundId: round.id, status: round.status, title: round.title, format: round.format, category: round.category, committeeType: round.committeeType, memberCount: round.memberCount, decisionNote: round.decisionNote, committeeStage: round.committeeStage, committeeConfiguration: round.committeeConfiguration, electionSeats: round.electionSeats, options: round.options.map((o) => ({ optionId: o.id, label: o.label, isNullVote: o.isNullVote })) }
      : null
    // Repeated votes belong to the round they repeat; the mesa declares the official result there.
    const officialRoundId = round?.committeeRootRoundId ?? round?.id
    const results = round?.status === 'published' ? await this.publishedResults(round.id) : undefined
    const officialResult = officialRoundId ? await this.publishedOfficialResult(officialRoundId) : null
    // An annulled committee keeps its stage; only a live one shows candidates, proposals and supports.
    const liveNominationStage = round?.status === 'draft' ? round.committeeStage : null
    const proposals = liveNominationStage && ['proposals', 'support'].includes(liveNominationStage)
      ? await this.prisma.participantSession.findMany({
          // Secretaría (Oct 2026): eligibility is not checked by the system; the mesa filters at approval.
          where: { assemblyId: participant.assemblyId, status: 'active' },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], select: { id: true, firstName: true, lastName: true },
        }) : undefined
    const committeeProposals = round && liveNominationStage && ['proposals', 'support'].includes(liveNominationStage)
      ? await this.prisma.committeeProposal.findMany({
          where: { roundId: round.id, status: 'proposed' }, include: { candidate: { select: { firstName: true, lastName: true } }, _count: { select: { supporters: true } } }, orderBy: { createdAt: 'asc' },
        }) : undefined
    const supportedProposalIds = round && liveNominationStage === 'support'
      ? new Set((await this.prisma.committeeProposalSupport.findMany({ where: { proposal: { roundId: round.id }, supporterParticipantId: participant.id }, select: { proposalId: true } })).map((support) => support.proposalId))
      : new Set<string>()
    return {
      assembly: { id: participant.assembly.id, name: participant.assembly.name, status: participant.assembly.status, completedAt: participant.assembly.completedAt?.toISOString() ?? null },
      assemblyStatus: participant.assembly.status,
      assemblyCompletedAt: participant.assembly.completedAt?.toISOString() ?? null,
      lobbyStatus: participant.assembly.status === 'lobby_open' ? 'open' as const : 'closed' as const,
      openRound,
      participationStatus: participation ? 'recorded' as const : 'pending' as const,
      ...(results ? { results } : {}),
      ...(officialResult ? { officialResult } : {}),
      ...(proposals ? { committeeCandidates: proposals } : {}),
      ...(committeeProposals ? { committeeProposals: committeeProposals.map((proposal) => ({ id: proposal.id, candidateName: `${proposal.candidate.firstName} ${proposal.candidate.lastName}`, supportCount: proposal._count.supporters, supportedByMe: supportedProposalIds.has(proposal.id) })) } : {}),
    }
  }

  async castVote(participantId: string, roundId: string, selections: string | string[]) {
    const requestedOptionIds = Array.isArray(selections) ? selections : [selections]
    const optionIds = [...new Set(requestedOptionIds)]
    if (requestedOptionIds.length !== optionIds.length) throw new UnprocessableEntityException('No repitas opciones en la papeleta')
    if (!optionIds.length || optionIds.some((id) => !id)) throw new UnprocessableEntityException('Selecciona al menos una opción válida')
    const participant = await this.prisma.participantSession.findUnique({
      where: { id: participantId },
      select: { id: true, assemblyId: true, status: true },
    })
    if (!participant || participant.status !== 'active') throw new ForbiddenException()
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; format: string; category: string; member_count: number | null; election_seats: number | null }>>`
          SELECT id, assembly_id, status, format, category, member_count, election_seats FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
        `
        const round = rows[0]
        if (!round) throw new NotFoundException('Ronda no encontrada')
        if (round.assembly_id !== participant.assemblyId) throw new NotFoundException('Ronda no encontrada')
        if (round.status !== 'open') throw new ConflictException('La papeleta no está abierta')
        if (round.format === 'single_choice' && optionIds.length !== 1) throw new UnprocessableEntityException('Esta papeleta permite una sola opción')
        const options = await tx.ballotOption.findMany({ where: { id: { in: optionIds }, roundId }, select: { id: true, isNullVote: true } })
        if (options.length !== optionIds.length) throw new UnprocessableEntityException('Todas las opciones deben pertenecer a esta papeleta')
        if (options.length > 1 && options.some((option) => option.isNullVote)) throw new UnprocessableEntityException('El voto nulo no se puede combinar con otras opciones')
        const maxSelections = round.election_seats ?? round.member_count
        if (maxSelections !== null && maxSelections !== undefined && optionIds.length > maxSelections) {
          throw new UnprocessableEntityException(`Puedes seleccionar como máximo ${maxSelections} integrantes`)
        }
        // The unique participation claim and anonymous ballot share a transaction but no shared identity key.
        // If either insert fails, PostgreSQL rolls both back.
        await tx.participation.create({ data: { roundId, participantSessionId: participant.id } })
        await tx.anonymousVote.createMany({ data: optionIds.map((optionId) => ({ roundId, optionId })) })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya se registró una participación para esta ronda')
      }
      throw error
    }
    const [state, recorded, eligible] = await Promise.all([
      this.participantState(participantId),
      this.prisma.participation.count({ where: { roundId } }),
      this.prisma.participantSession.count({ where: { assemblyId: participant.assemblyId, status: 'active' } }),
    ])
    this.realtime.participantState(participantId, state)
    this.realtime.participationCount(participant.assemblyId, { roundId, recorded, eligible })
    return { accepted: true, participationStatus: 'recorded' as const }
  }

  async publicState(assemblyCode: string) {
    const assembly = await this.prisma.assembly.findUnique({
      where: { joinCodeHash: hashCredential(assemblyCode) },
      include: {
        rounds: { where: { status: { in: ['open', 'closed', 'published', 'annulled'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    if (!assembly) throw new NotFoundException('Asamblea no encontrada')
    const round = assembly.rounds[0]
    const [participantCount, participants, recordedCount] = await Promise.all([
      this.prisma.participantSession.count({ where: { assemblyId: assembly.id, status: 'active' } }),
      assembly.status === 'lobby_open'
        ? this.prisma.participantSession.findMany({
            where: { assemblyId: assembly.id, status: 'active' },
            orderBy: { joinedAt: 'asc' },
            select: { firstName: true, lastName: true },
          })
        : Promise.resolve(undefined),
      round && ['open', 'closed'].includes(round.status)
        ? this.prisma.participation.count({ where: { roundId: round.id } })
        : Promise.resolve(undefined),
    ])
    const officialRoundId = round?.committeeRootRoundId ?? round?.id
    const result = round?.status === 'published' ? await this.publishedResults(round.id) : undefined
    const officialResult = officialRoundId ? await this.publishedOfficialResult(officialRoundId) : null
    return {
      assembly: { id: assembly.id, name: assembly.name, status: assembly.status, completedAt: assembly.completedAt?.toISOString() ?? null },
      // The projector runs on the server laptop, whose own address is not the one phones can reach.
      joinUrl: this.appUrl({ join: assemblyCode }),
      participantCount,
      ...(participants ? { participants } : {}),
      ...(recordedCount !== undefined ? { recordedCount, eligibleCount: participantCount } : {}),
      round: round ? { id: round.id, title: round.title, status: round.status, format: round.format, category: round.category, committeeType: round.committeeType, memberCount: round.memberCount, decisionNote: round.decisionNote, committeeStage: round.committeeStage } : null,
      ...(result ? { results: result } : {}),
      ...(officialResult ? { officialResult } : {}),
    }
  }

  async moderatorAssembly(assemblyId: string) {
    const assembly = await this.prisma.assembly.findUnique({
      where: { id: assemblyId },
      include: {
        participants: { where: { status: 'active' }, orderBy: { joinedAt: 'asc' }, select: { id: true, firstName: true, lastName: true, status: true, joinedAt: true, assemblyRole: true, committeeEligible: true } },
        rounds: { orderBy: { createdAt: 'asc' }, include: { options: { orderBy: { order: 'asc' } }, committeeProposals: { include: { candidate: { select: { firstName: true, lastName: true } }, _count: { select: { supporters: true } } }, orderBy: { createdAt: 'asc' } }, _count: { select: { participations: true } } } },
      },
    })
    if (!assembly) throw new NotFoundException('Asamblea no encontrada')
    const rounds = await Promise.all(assembly.rounds.map(async (round) => ({
      id: round.id,
      title: round.title,
      format: round.format,
      category: round.category,
      committeeType: round.committeeType,
      memberCount: round.memberCount,
      decisionNote: round.decisionNote,
      committeeStage: round.committeeStage,
      committeeConfiguration: round.committeeConfiguration,
      electionSeats: round.electionSeats,
      committeeRootRoundId: round.committeeRootRoundId,
      countingRule: round.countingRule,
      status: round.status,
      options: round.options,
      committeeProposals: round.committeeProposals.map((proposal) => ({
        id: proposal.id,
        candidateParticipantId: proposal.candidateParticipantId,
        candidateName: `${proposal.candidate.firstName} ${proposal.candidate.lastName}`,
        status: proposal.status,
        supportCount: proposal._count.supporters,
        approvalYes: proposal.approvalYes,
        approvalNo: proposal.approvalNo,
        decidedAt: proposal.decidedAt?.toISOString() ?? null,
      })),
      annulledAt: round.annulledAt?.toISOString() ?? null,
      annulReason: round.annulReason,
      participationCount: round._count.participations,
      secrecyCleanupPending: (SETTLED_ROUND_STATUSES as readonly string[]).includes(round.status) && !round.votesUnlinkedAt,
      ...(round.status === 'published' ? { results: await this.publishedResults(round.id) } : {}),
      // Only the mesa sees a closed ballot's counts, so it can review them before deciding to publish.
      ...(round.status === 'closed' ? { privateResults: await this.rankedCounts(round.id) } : {}),
      officialResult: await this.moderatorOfficialResult(round.id),
    })))
    return {
      id: assembly.id,
      name: assembly.name,
      status: assembly.status,
      completedAt: assembly.completedAt?.toISOString() ?? null,
      participants: assembly.participants,
      participantCount: assembly.participants.length,
      // The join code is only stored hashed, so the panel builds the QR from this base and the code it kept.
      publicAppUrl: process.env.PUBLIC_APP_URL,
      rounds,
    }
  }

  async activeAssembly() {
    const assembly = await this.prisma.assembly.findFirst({
      where: { organizationId: ORGANIZATION_ID, status: { in: ['lobby_open', 'lobby_closed', 'in_progress'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, status: true },
    })
    // A completed assembly stays until the mesa erases it, so a closed tab must not lose the acta or the delete button.
    const completed = await this.prisma.assembly.findMany({
      where: { organizationId: ORGANIZATION_ID, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
      select: { id: true, name: true, completedAt: true },
    })
    return { assembly, completed: completed.map((item) => ({ ...item, completedAt: item.completedAt?.toISOString() ?? null })) }
  }

  /** The join code is stored only as a hash, so a lost QR can be replaced but never shown again. */
  async rotateJoinCode(assemblyId: string) {
    const joinCode = newOpaqueCredential()
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      if (!rows[0]) throw new NotFoundException('Asamblea no encontrada')
      if (rows[0].status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
      await tx.assembly.update({ where: { id: assemblyId }, data: { joinCodeHash: hashCredential(joinCode) } })
      await tx.auditEvent.create({ data: { assemblyId, actorRef: MODERATOR_ACTOR, action: 'assembly.join_code_rotated' } })
    })
    this.realtime.publicSessionsRevoked(assemblyId)
    return { joinCode, joinUrl: this.appUrl({ join: joinCode }) }
  }

  async reopenLobby(assemblyId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      const assembly = rows[0]
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
      if (assembly.status === 'lobby_open') return { id: assembly.id, status: assembly.status, changed: false }
      const openRound = await tx.round.findFirst({ where: { assemblyId, status: 'open' }, select: { id: true } })
      if (openRound) throw new ConflictException('Cierra la papeleta abierta antes de reabrir el ingreso')
      const updated = await tx.assembly.update({ where: { id: assemblyId }, data: { status: 'lobby_open' }, select: { id: true, status: true } })
      await tx.auditEvent.create({ data: { assemblyId, actorRef: MODERATOR_ACTOR, action: 'lobby.reopened', metadata: { previousStatus: assembly.status } } })
      return { ...updated, changed: true }
    })
    if (!result.changed) return { id: result.id, status: result.status }
    const count = await this.prisma.participantSession.count({ where: { assemblyId, status: 'active' } })
    this.realtime.assemblyState(assemblyId, { status: 'lobby_open' })
    this.realtime.lobbyState(assemblyId, { status: 'open', participantCount: count })
    return { id: result.id, status: result.status }
  }

  async changeLobby(assemblyId: string, status: 'lobby_open' | 'lobby_closed') {
    if (status === 'lobby_open') return this.reopenLobby(assemblyId)
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      const assembly = rows[0]
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
      if (assembly.status === 'lobby_closed' || assembly.status === 'in_progress') return { id: assembly.id, status: assembly.status, changed: false }
      if (assembly.status !== 'lobby_open') throw new ConflictException('La Asamblea no permite cerrar el ingreso')
      const updated = await tx.assembly.update({ where: { id: assemblyId }, data: { status: 'lobby_closed' }, select: { id: true, status: true } })
      await tx.auditEvent.create({ data: { assemblyId, actorRef: MODERATOR_ACTOR, action: 'lobby.closed' } })
      return { ...updated, changed: true }
    })
    if (!result.changed) return { id: result.id, status: result.status }
    const count = await this.prisma.participantSession.count({ where: { assemblyId, status: 'active' } })
    this.realtime.assemblyState(assemblyId, { status: result.status as AssemblyStatus })
    this.realtime.lobbyState(assemblyId, { status: 'closed', participantCount: count })
    return result
  }

  /**
   * After the assembly the acta is the record, not the database (Secretaría, Oct 2026). Only a completed
   * assembly can be erased: names, receipts, votes and the audit trail go with it, and VACUUM FULL
   * rewrites the tables so the deleted rows do not stay in their files.
   */
  async deleteAssemblyData(assemblyId: string, confirmation: true) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: AssemblyStatus }>>`
        SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      if (!rows[0]) throw new NotFoundException('Asamblea no encontrada')
      if (rows[0].status !== 'completed') throw new ConflictException('Finaliza la Asamblea antes de borrar sus datos')
      if (confirmation !== true) throw new UnprocessableEntityException('Confirma explícitamente el borrado de los datos')
      // Rounds first: their options, proposals and winners reference the participant sessions.
      await tx.round.deleteMany({ where: { assemblyId } })
      await tx.participantSession.deleteMany({ where: { assemblyId } })
      await tx.auditEvent.deleteMany({ where: { assemblyId } })
      await tx.assembly.delete({ where: { id: assemblyId } })
    })
    this.realtime.assemblyDeleted(assemblyId)
    try {
      await this.vacuumDatabase()
      return { assemblyId, deleted: true, vacuumed: true }
    } catch (error) {
      this.logger.error(`Deleted assembly ${assemblyId}, but VACUUM FULL did not complete: ${(error as Error).message}`)
      return { assemblyId, deleted: true, vacuumed: false }
    }
  }

  async completeAssembly(assemblyId: string, confirmation: true) {
    await this.ensureVotesUnlinkedOrFail(assemblyId)
    const completed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: AssemblyStatus; completed_at: Date | null; updated_at: Date }>>`
        SELECT id, status, completed_at, updated_at FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      const assembly = rows[0]
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') {
        return { id: assembly.id, status: assembly.status, completedAt: assembly.completed_at ?? assembly.updated_at, changed: false }
      }
      if (assembly.status === 'preparing') throw new ConflictException('La Asamblea aún no ha comenzado y no puede finalizarse')
      const openRound = await tx.round.findFirst({ where: { assemblyId, status: 'open' }, select: { id: true } })
      if (openRound) throw new ConflictException('Cierra la papeleta abierta antes de finalizar la Asamblea')
      // Once completed, no operation can retry the cleanup, so it must be finished first.
      const stillLinked = await tx.round.count({ where: { assemblyId, status: { in: [...SETTLED_ROUND_STATUSES] }, votesUnlinkedAt: null } })
      if (stillLinked) throw new ServiceUnavailableException(SECRECY_CLEANUP_PENDING)
      if (confirmation !== true) throw new UnprocessableEntityException('Confirma explícitamente la finalización de la Asamblea')
      const completedAt = new Date()
      const updated = await tx.assembly.update({
        where: { id: assemblyId },
        data: { status: 'completed', completedAt },
        select: { id: true, status: true, completedAt: true },
      })
      await tx.auditEvent.create({
        data: { assemblyId, actorRef: MODERATOR_ACTOR, action: 'assembly.completed', occurredAt: completedAt },
      })
      return { id: updated.id, status: updated.status, completedAt, changed: true }
    })
    if (completed.changed) {
      this.realtime.assemblyState(assemblyId, { status: 'completed', completedAt: completed.completedAt.toISOString() })
    }
    return { id: completed.id, status: completed.status, completedAt: completed.completedAt.toISOString() }
  }

  async patchParticipant(participantId: string, input: { firstName?: string; lastName?: string; status?: 'removed'; assemblyRole?: 'president' | 'vice_president' | 'secretary' | 'treasurer' | 'delegate' | null; committeeEligible?: boolean }) {
    const identity = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { assemblyId: true } })
    if (!identity) throw new NotFoundException('Participante no encontrado')
    if (input.firstName === undefined && input.lastName === undefined && input.status === undefined && input.assemblyRole === undefined && input.committeeEligible === undefined) {
      throw new UnprocessableEntityException('Indica un cambio para el participante')
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${identity.assemblyId}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: identity.assemblyId }, select: { status: true } })
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten cambios operativos')
      const hasVoted = await tx.participation.count({ where: { participantSessionId: participantId } }) > 0
      const hasStartedCommittee = await tx.round.count({ where: { assemblyId: identity.assemblyId, category: 'committee', committeeStage: { in: ['proposals', 'support', 'approval', 'election', 'tie_break_required', 'tie_break', 'composition_ready'] } } }) > 0
      const changesRoster = input.firstName !== undefined || input.lastName !== undefined || input.status !== undefined
      const changesEligibility = input.assemblyRole !== undefined || input.committeeEligible !== undefined
      if ((changesRoster && (assembly.status === 'in_progress' || hasVoted)) || (changesEligibility && hasStartedCommittee)) {
        throw new ConflictException('La lista o elegibilidad ya no admite cambios después de iniciar la votación aplicable')
      }
      const current = await tx.participantSession.findUnique({ where: { id: participantId }, select: { id: true } })
      if (!current) throw new NotFoundException('Participante no encontrado')
      const value = await tx.participantSession.update({
        where: { id: participantId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
          ...(input.status === 'removed' ? { status: 'removed' as const } : {}),
          ...(input.assemblyRole !== undefined ? { assemblyRole: input.assemblyRole } : {}),
          ...(input.committeeEligible !== undefined ? { committeeEligible: input.committeeEligible } : {}),
        },
        select: { id: true, assemblyId: true, firstName: true, lastName: true, status: true, assemblyRole: true, committeeEligible: true },
      })
      await tx.auditEvent.create({ data: { assemblyId: identity.assemblyId, actorRef: MODERATOR_ACTOR, action: input.status === 'removed' ? 'participant.removed' : changesEligibility ? 'participant.committee_eligibility_configured' : 'participant.corrected', metadata: { participantId, ...(input.assemblyRole ? { assemblyRole: input.assemblyRole } : {}), ...(input.committeeEligible !== undefined ? { committeeEligible: input.committeeEligible } : {}) } } })
      return value
    })
    if (updated.status === 'removed') {
      this.realtime.participantRemoved(updated.assemblyId, updated.id)
      const count = await this.prisma.participantSession.count({ where: { assemblyId: updated.assemblyId, status: 'active' } })
      const assembly = await this.prisma.assembly.findUniqueOrThrow({ where: { id: updated.assemblyId }, select: { status: true } })
      this.realtime.lobbyState(updated.assemblyId, { status: assembly.status === 'lobby_open' ? 'open' : 'closed', participantCount: count })
    } else this.realtime.participantUpdated(updated.assemblyId, { participantId: updated.id, firstName: updated.firstName, lastName: updated.lastName })
    return { id: updated.id, firstName: updated.firstName, lastName: updated.lastName, status: updated.status, assemblyRole: updated.assemblyRole, committeeEligible: updated.committeeEligible }
  }

  async createRound(assemblyId: string, input: CreateRoundDto) {
    const category = input.category ?? 'office'
    if (category === 'committee' && !input.committeeType) {
      throw new UnprocessableEntityException('Selecciona el tipo de comisión')
    }
    if (category === 'office' && (input.committeeType || input.memberCount !== undefined)) {
      throw new UnprocessableEntityException('Los metadatos de comisión solo aplican a rondas de comisión')
    }
    if (category === 'committee' && input.committeeType === 'nomination' && input.memberCount !== undefined && (input.memberCount < 5 || input.memberCount % 2 === 0)) {
      throw new UnprocessableEntityException('La Comisión de Nombramiento requiere un número impar de al menos cinco integrantes')
    }
    if (category === 'committee' && input.memberCount !== undefined && ['finance', 'statutes'].includes(input.committeeType ?? '') && ![3, 5].includes(input.memberCount)) {
      throw new UnprocessableEntityException('Finanzas y Estatutos admiten tres o cinco integrantes')
    }
    if (!input.countingRule || Array.isArray(input.countingRule) || Object.keys(input.countingRule).length === 0) {
      throw new UnprocessableEntityException('countingRule debe declarar explícitamente la regla configurada')
    }
    if (input.countingRule.kind !== 'count_only') throw new UnprocessableEntityException('La única regla compatible con V1 es kind: count_only; no se determina un ganador')
    const options = input.options ?? []
    if (category === 'office' && options.length < 1) throw new UnprocessableEntityException('Agrega al menos una opción')
    const labels = options.map(({ label }) => label.trim())
    if (labels.some((label) => !label) || new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
      throw new UnprocessableEntityException('Las opciones deben tener etiquetas no vacías y distintas')
    }
    if (labels.some((label) => label.toLocaleLowerCase() === NULL_VOTE_LABEL.toLocaleLowerCase())) {
      throw new UnprocessableEntityException(`«${NULL_VOTE_LABEL}» se agrega automáticamente a cada papeleta`)
    }
    const rules = input.committeeConfiguration ?? {}
    // Mesa v2: Secretaría's validation is the only required decision; reference, note and rules are optional context for the acta.
    const validated = category === 'committee' && Boolean(rules.institutionallyValidated)
    const nominationReady = input.committeeType === 'nomination' && Boolean(
      validated && Number.isInteger(Number(rules.supportMinimum)) && Number(rules.supportMinimum) > 0 &&
      this.nominationCandidateCountValid(rules.candidateCount, input.memberCount ?? 5),
    )
    let stage: 'configuration_required' | 'proposals' | 'election' | null = category !== 'committee' ? null
      : input.committeeType === 'nomination'
        ? (nominationReady ? 'proposals' : 'configuration_required')
        : (validated && input.memberCount && options.length ? 'election' : 'configuration_required')
    const round = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM assemblies WHERE id = ${assemblyId}::uuid FOR UPDATE
      `
      const assembly = rows[0]
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten nuevas papeletas')
      if (!['lobby_closed', 'in_progress'].includes(assembly.status)) throw new ConflictException('Cierra el ingreso antes de preparar una papeleta')
      if (input.committeeType === 'nomination' && stage === 'proposals') {
        const participantCount = await tx.participantSession.count({ where: { assemblyId, status: 'active' } })
        if (Number(rules.supportMinimum) > participantCount) stage = 'configuration_required'
      }
      if (category === 'committee' && input.committeeType !== 'nomination' && validated) {
        const candidateIds = options.map((option) => option.candidateParticipantId)
        if (candidateIds.some((id) => !id) || new Set(candidateIds).size !== candidateIds.length) {
          throw new UnprocessableEntityException('Selecciona participantes distintos para esta comisión')
        }
        const activeCandidates = await tx.participantSession.count({ where: { assemblyId, id: { in: candidateIds as string[] }, status: 'active' } })
        if (activeCandidates !== candidateIds.length) throw new UnprocessableEntityException('Cada integrante debe ser un participante activo de esta Asamblea')
      }
      const created = await tx.round.create({
        data: {
          assemblyId,
          title: input.title.trim(),
          format: category === 'committee' ? 'multiple_choice' : (input.format ?? 'single_choice'),
          category,
          committeeType: category === 'committee' ? input.committeeType : null,
          memberCount: category === 'committee' ? input.memberCount ?? null : null,
          decisionNote: category === 'committee' ? input.decisionNote?.trim() || null : null,
          committeeStage: stage,
          committeeConfiguration: category === 'committee' ? rules as Prisma.InputJsonValue : Prisma.JsonNull,
          electionSeats: category === 'committee' ? input.memberCount ?? null : null,
          countingRule: input.countingRule as Prisma.InputJsonValue,
          // A Nomination Committee gets its candidates (and the null vote) when its election stage starts.
          options: { create: [
            ...labels.map((label, order) => ({ label, order, ...(options[order]?.candidateParticipantId ? { candidateParticipantId: options[order].candidateParticipantId } : {}) })),
            ...(labels.length ? [this.nullVoteOption(labels.length)] : []),
          ] },
        },
        include: { options: { orderBy: { order: 'asc' } } },
      })
      await tx.auditEvent.create({ data: { assemblyId, roundId: created.id, actorRef: MODERATOR_ACTOR, action: 'round.prepared' } })
      return created
    })
    const createdRound = await this.prisma.round.findUniqueOrThrow({ where: { id: round.id }, include: { options: { orderBy: { order: 'asc' } } } })
    await this.announceRound(createdRound.id)
    return { id: createdRound.id, title: createdRound.title, format: createdRound.format, category: createdRound.category, committeeType: createdRound.committeeType, memberCount: createdRound.memberCount, decisionNote: createdRound.decisionNote, committeeStage: createdRound.committeeStage, committeeConfiguration: createdRound.committeeConfiguration, countingRule: createdRound.countingRule, status: createdRound.status, options: createdRound.options }
  }

  /** The candidate count is optional (mesa v2); when absent it defaults to the member count, so it never blocks. */
  private nominationCandidateCountValid(candidateCount: unknown, memberCount: number) {
    if (candidateCount === undefined || candidateCount === null) return true
    const count = Number(candidateCount)
    return Number.isInteger(count) && count >= memberCount
  }

  /** Phones and projector refetch on round.state; committee steps change what they show without opening a ballot. */
  private async announceRound(roundId: string) {
    // Best effort: the action already committed, and clients still poll if the notice is lost.
    try {
      const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { assemblyId: true, status: true, title: true } })
      if (round) this.realtime.roundState(round.assemblyId, { roundId, status: round.status, title: round.title })
    } catch (error) {
      this.logger.warn(`No se pudo anunciar el cambio de la papeleta ${roundId}: ${(error as Error).message}`)
    }
  }

  async updateCommitteeConfiguration(roundId: string, input: CommitteeConfigurationUpdateDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; committee_type: string | null; committee_stage: string | null; member_count: number | null; decision_note: string | null; committee_configuration: Record<string, unknown> | null }>>`
        SELECT id, assembly_id, status, committee_type, committee_stage, member_count, decision_note, committee_configuration FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round || round.committee_type === null) throw new NotFoundException('Comisión no encontrada')
      if (round.status !== 'draft' || !['configuration_required', 'proposals', 'support'].includes(round.committee_stage ?? '')) throw new ConflictException('La configuración ya quedó congelada al iniciar la votación')
      const memberCount = input.memberCount ?? round.member_count
      const decisionNote = input.decisionNote?.trim() ?? round.decision_note
      const config = { ...(round.committee_configuration ?? {}), ...(input.committeeConfiguration ?? {}) }
      const validated = Boolean(config.institutionallyValidated)
      if (round.committee_type === 'nomination' && memberCount !== null && memberCount !== undefined && (memberCount < 5 || memberCount % 2 === 0)) {
        throw new UnprocessableEntityException('Nombramiento requiere un cupo impar de al menos cinco integrantes')
      }
      if (validated && ['finance', 'statutes'].includes(round.committee_type) && ![3, 5].includes(memberCount ?? 0)) {
        throw new UnprocessableEntityException('Finanzas y Estatutos requieren tres o cinco integrantes confirmados')
      }
      let nextStage: 'configuration_required' | 'proposals' | 'support' | 'election' = 'configuration_required'
      if (validated && memberCount) {
        if (round.committee_type === 'nomination') {
          const supportMinimum = Number(config.supportMinimum)
          const ready = Boolean(Number.isInteger(supportMinimum) && supportMinimum >= 1 && this.nominationCandidateCountValid(config.candidateCount, memberCount))
          const participantCount = await tx.participantSession.count({ where: { assemblyId: round.assembly_id, status: 'active' } })
          if (ready && supportMinimum <= participantCount) nextStage = round.committee_stage === 'support' ? 'support' : 'proposals'
        } else if (round.committee_type === 'finance' || round.committee_type === 'statutes') {
          const activeOptions = await tx.ballotOption.count({ where: { roundId, candidateParticipantId: { not: null }, candidateParticipant: { is: { status: 'active' } } } })
          const optionCount = await tx.ballotOption.count({ where: { roundId, isNullVote: false } })
          if ([3, 5].includes(memberCount) && optionCount >= memberCount && activeOptions === optionCount) nextStage = 'election'
        } else if (round.committee_type === 'plans' || round.committee_type === 'other') {
          const optionCount = await tx.ballotOption.count({ where: { roundId, isNullVote: false } })
          const activeOptions = await tx.ballotOption.count({ where: { roundId, candidateParticipantId: { not: null }, candidateParticipant: { is: { status: 'active' } } } })
          if (optionCount > 0 && activeOptions === optionCount) nextStage = 'election'
        }
      }
      const updated = await tx.round.update({
        where: { id: roundId },
        data: {
          memberCount,
          electionSeats: memberCount,
          decisionNote,
          committeeConfiguration: config as Prisma.InputJsonValue,
          committeeStage: nextStage,
          format: 'multiple_choice',
        },
        select: { id: true, committeeStage: true, memberCount: true, decisionNote: true, committeeConfiguration: true },
      })
      await tx.auditEvent.create({ data: { assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: nextStage === 'configuration_required' ? 'committee.configuration.blocked' : 'committee.configuration.validated', metadata: { stage: nextStage, committeeType: round.committee_type, memberCount } } })
      const participantCount = round.committee_type === 'nomination'
        ? await tx.participantSession.count({ where: { assemblyId: round.assembly_id, status: 'active' } })
        : null
      const impossibleMinimum = round.committee_type === 'nomination' && Number(config.supportMinimum) > (participantCount ?? 0)
      const missingCandidateCount = round.committee_type === 'nomination' && !this.nominationCandidateCountValid(config.candidateCount, memberCount ?? 0)
      return { ...updated, ready: nextStage !== 'configuration_required', message: impossibleMinimum ? `El mínimo de apoyos (${Number(config.supportMinimum)}) supera los ${participantCount} participantes activos; corrígelo antes de continuar.` : missingCandidateCount ? 'El número de candidatos fijado por la delegación no puede ser menor que el número de integrantes.' : nextStage === 'configuration_required' ? 'Falta marcar que Secretaría validó esta comisión.' : 'Configuración validada; puede continuar el flujo.' }
    })
    await this.announceRound(roundId)
    return result
  }

  async submitCommitteeProposal(participantId: string, roundId: string, candidateParticipantId: string) {
    // Secretaría (Oct 2026): the system does not check eligibility; the delegation decides each candidacy at approval.
    const proposer = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { id: true, assemblyId: true, status: true } })
    if (!proposer || proposer.status !== 'active') throw new ForbiddenException()
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { id: true, assemblyId: true, category: true, committeeType: true, committeeStage: true, status: true } })
    if (!round || round.assemblyId !== proposer.assemblyId) throw new NotFoundException('Proceso no encontrado')
    if (round.category !== 'committee' || round.committeeType !== 'nomination' || round.committeeStage !== 'proposals' || round.status !== 'draft') throw new ConflictException('El proceso no está recibiendo propuestas')
    const candidate = await this.prisma.participantSession.findUnique({ where: { id: candidateParticipantId }, select: { id: true, assemblyId: true, status: true } })
    if (!candidate || candidate.assemblyId !== round.assemblyId || candidate.status !== 'active') throw new UnprocessableEntityException('La candidatura debe pertenecer a un participante activo de esta Asamblea')
    try {
      const proposal = await this.prisma.$transaction(async (tx) => {
        // Shared lock, as for supports: closing proposals or annulling (FOR UPDATE) waits, and a proposal
        // that arrives after either is refused instead of being saved into a finished stage.
        await this.assertNominationStageOpen(tx, roundId, 'proposals', 'El proceso no está recibiendo propuestas')
        const proposal = await tx.committeeProposal.create({ data: { roundId, candidateParticipantId, proposedByParticipantId: participantId }, select: { id: true, roundId: true, candidateParticipantId: true } })
        await tx.auditEvent.create({ data: { assemblyId: round.assemblyId, roundId, actorRef: participantId, action: 'committee.nomination.proposed', metadata: { proposalId: proposal.id, candidateParticipantId } } })
        return proposal
      })
      await this.announceRound(roundId)
      return proposal
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Esta persona ya fue propuesta')
      throw error
    }
  }

  async supportCommitteeProposal(participantId: string, roundId: string, proposalId: string) {
    const participant = await this.prisma.participantSession.findUnique({ where: { id: participantId }, select: { id: true, assemblyId: true, status: true } })
    if (!participant || participant.status !== 'active') throw new ForbiddenException()
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { assemblyId: true, status: true, category: true, committeeType: true, committeeStage: true } })
    if (!round || round.assemblyId !== participant.assemblyId || round.category !== 'committee' || round.committeeType !== 'nomination' || round.committeeStage !== 'support' || round.status !== 'draft') throw new ConflictException('El proceso no está recibiendo apoyos')
    const proposal = await this.prisma.committeeProposal.findFirst({ where: { id: proposalId, roundId, status: 'proposed' }, select: { id: true } })
    if (!proposal) throw new NotFoundException('Propuesta no disponible')
    try {
      await this.prisma.$transaction(async (tx) => {
        // Shared lock: delegates support concurrently, but closing supports or annulling (FOR UPDATE) waits
        // for them, so no support is saved after the counts that decide each proposal were taken.
        await this.assertNominationStageOpen(tx, roundId, 'support', 'El proceso no está recibiendo apoyos')
        await tx.committeeProposalSupport.create({ data: { proposalId, supporterParticipantId: participantId } })
        await tx.auditEvent.create({ data: { assemblyId: round.assemblyId, roundId, actorRef: participantId, action: 'committee.nomination.supported', metadata: { proposalId } } })
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Ya registraste tu apoyo a esta propuesta')
      throw error
    }
    await this.announceRound(roundId)
    return { supported: true }
  }

  async advanceCommitteeStage(roundId: string, stage: 'support' | 'approval' | 'election') {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; committee_stage: string | null; committee_type: string | null; member_count: number | null; committee_configuration: Record<string, unknown> | null }>>`
        SELECT id, assembly_id, status, committee_stage, committee_type, member_count, committee_configuration FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round || round.committee_type !== 'nomination' || round.status !== 'draft') throw new ConflictException('El proceso de Nombramiento no se puede avanzar desde su estado actual')
      const config = round.committee_configuration ?? {}
      if (stage === 'support' && round.committee_stage === 'proposals') {
        const proposalCount = await tx.committeeProposal.count({ where: { roundId, status: 'proposed' } })
        if (!proposalCount) throw new ConflictException('Registra al menos una propuesta antes de iniciar apoyos')
        await tx.round.update({ where: { id: roundId }, data: { committeeStage: 'support' } })
      } else if (stage === 'approval' && round.committee_stage === 'support') {
        const participantCount = await tx.participantSession.count({ where: { assemblyId: round.assembly_id, status: 'active' } })
        const minimum = Number(config.supportMinimum)
        if (!Number.isInteger(minimum) || minimum < 1) throw new ConflictException('Falta validar el mínimo de apoyos institucional')
        if (minimum > participantCount) throw new ConflictException(`No se pueden cerrar los apoyos: el mínimo configurado (${minimum}) supera los ${participantCount} participantes activos. Corrige la configuración.`)
        const proposals = await tx.committeeProposal.findMany({ where: { roundId, status: 'proposed' }, include: { _count: { select: { supporters: true } } } })
        for (const proposal of proposals) {
          await tx.committeeProposal.update({ where: { id: proposal.id }, data: { status: proposal._count.supporters >= minimum ? 'supported' : 'rejected' } })
        }
        if (!proposals.some((proposal) => proposal._count.supporters >= minimum)) throw new ConflictException('Ninguna propuesta alcanzó el mínimo de apoyos configurado')
        await tx.round.update({ where: { id: roundId }, data: { committeeStage: 'approval' } })
      } else if (stage === 'election' && round.committee_stage === 'approval') {
        const pending = await tx.committeeProposal.count({ where: { roundId, status: 'supported' } })
        if (pending) throw new ConflictException('Registra la decisión de la delegación sobre cada propuesta apoyada')
        const approved = await tx.committeeProposal.findMany({ where: { roundId, status: 'approved' }, orderBy: { createdAt: 'asc' }, include: { candidate: { select: { id: true, firstName: true, lastName: true } } } })
        if (approved.length < (round.member_count ?? 5)) throw new ConflictException('Faltan candidaturas aprobadas para cubrir los cupos')
        const candidateCount = Number(config.candidateCount)
        if (Number.isInteger(candidateCount) && approved.length > candidateCount) {
          throw new ConflictException(`Hay ${approved.length} candidaturas aprobadas y la delegación fijó ${candidateCount}; corrige las decisiones antes de abrir la elección`)
        }
        await tx.ballotOption.createMany({ data: [
          ...approved.map((proposal, order) => ({ roundId, label: `${proposal.candidate.firstName} ${proposal.candidate.lastName}`, order, candidateParticipantId: proposal.candidate.id })),
          { roundId, ...this.nullVoteOption(approved.length) },
        ] })
        await tx.round.update({ where: { id: roundId }, data: { committeeStage: 'election', format: 'multiple_choice', electionSeats: round.member_count } })
      } else throw new ConflictException('Transición de comisión no permitida')
      await tx.auditEvent.create({ data: { assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: `committee.stage.${stage}`, metadata: { previousStage: round.committee_stage } } })
      return { roundId, stage }
    })
    await this.announceRound(roundId)
    return result
  }

  async recordCommitteeApproval(roundId: string, proposalId: string, input: CommitteeApprovalDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Same row lock as advanceCommitteeStage: a decision either lands before the ballot copies the
      // approved candidates or sees the election stage and is refused, never after the copy.
      await tx.$queryRaw`SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`
      const round = await tx.round.findUnique({ where: { id: roundId }, select: { assemblyId: true, status: true, category: true, committeeType: true, committeeStage: true, committeeConfiguration: true } })
      if (!round || round.status !== 'draft' || round.category !== 'committee' || round.committeeType !== 'nomination' || round.committeeStage !== 'approval') throw new ConflictException('El proceso no está en aprobación de candidaturas')
      // Proposals rejected for lacking supports have no decision date and stay out; decided ones can be corrected.
      const proposal = await tx.committeeProposal.findFirst({ where: { id: proposalId, roundId, OR: [{ status: 'supported' }, { decidedAt: { not: null } }] }, select: { id: true } })
      if (!proposal) throw new NotFoundException('Propuesta apoyada no disponible')
      // Secretaría decided the system does not compute majorities: the mesa records what the delegation decided.
      const yesVotes = input.yesVotes ?? null
      const noVotes = input.noVotes ?? null
      const decided = await tx.committeeProposal.update({ where: { id: proposalId }, data: { status: input.decision, approvalYes: yesVotes, approvalNo: noVotes, decidedAt: new Date() } })
      await tx.auditEvent.create({ data: { assemblyId: round.assemblyId, roundId, actorRef: MODERATOR_ACTOR, action: 'committee.nomination.approval_recorded', metadata: { proposalId, decision: input.decision, yesVotes, noVotes } } })
      return { proposalId: decided.id, status: decided.status, yesVotes: decided.approvalYes, noVotes: decided.approvalNo }
    })
    await this.announceRound(roundId)
    return result
  }

  async openRound(roundId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rounds = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; category: string; committee_stage: string | null; committee_root_round_id: string | null }>>`
        SELECT id, assembly_id, status, category, committee_stage, committee_root_round_id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rounds[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      if (round.status === 'open') return { roundId: round.id, assemblyId: round.assembly_id, status: 'open' as const, changed: false }
      if (round.status !== 'draft') throw new ConflictException('La ronda no se puede abrir desde su estado actual')
      if (round.category === 'committee' && !['election', 'tie_break'].includes(round.committee_stage ?? '')) {
        throw new ConflictException('La comisión no está lista para votar: completa y valida primero su configuración y etapas anteriores')
      }
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${round.assembly_id}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: round.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden abrir papeletas')
      if (!assembly || !['lobby_closed', 'in_progress'].includes(assembly.status)) throw new ConflictException('El ingreso debe estar cerrado antes de abrir una papeleta')
      const otherOpen = await tx.round.findFirst({ where: { assemblyId: round.assembly_id, status: 'open' }, select: { id: true } })
      if (otherOpen) throw new ConflictException('Ya hay una papeleta abierta')
      // A repetition prepared before the declaration must not open while that declaration is shown as official.
      if (round.committee_root_round_id) await this.assertNoOfficialResult(tx, round.committee_root_round_id, 'La papeleta original ya tiene un resultado oficial; retíralo antes de abrir esta votación')
      const updated = await tx.round.update({ where: { id: round.id }, data: { status: 'open', openedAt: new Date() }, select: { id: true, assemblyId: true, title: true } })
      if (assembly.status === 'lobby_closed') await tx.assembly.update({ where: { id: round.assembly_id }, data: { status: 'in_progress' } })
      await tx.auditEvent.create({ data: { assemblyId: round.assembly_id, roundId: round.id, actorRef: MODERATOR_ACTOR, action: 'round.opened', metadata: { committeeStage: round.committee_stage } } })
      return { roundId: updated.id, assemblyId: updated.assemblyId, title: updated.title, status: 'open' as const, changed: true }
    })
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, include: { options: { orderBy: { order: 'asc' } } } })
    const payload = { roundId, status: 'open' as const, title: round!.title }
    if (result.changed) {
      this.realtime.roundState(result.assemblyId, payload)
      this.realtime.roundOpened(result.assemblyId, { ...payload, options: round!.options.map((option) => ({ optionId: option.id, label: option.label })) })
      this.realtime.assemblyState(result.assemblyId, { status: 'in_progress' })
    }
    return payload
  }

  async closeRound(roundId: string) {
    const round = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; category: string; committee_type: string | null; committee_stage: string | null; committee_root_round_id: string | null; election_seats: number | null }>>`
        SELECT id, assembly_id, status, category, committee_type, committee_stage, committee_root_round_id, election_seats FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${current.assembly_id}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: current.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus papeletas')
      if (current.status === 'closed' || current.status === 'published') return { id: current.id, assemblyId: current.assembly_id, status: current.status, changed: false }
      if (current.status !== 'open') throw new ConflictException('Solo se puede cerrar una papeleta abierta')
      const updated = await tx.round.update({ where: { id: roundId }, data: { status: 'closed', closedAt: new Date() }, select: { id: true, assemblyId: true, status: true } })
      await tx.auditEvent.create({ data: { assemblyId: current.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: 'round.closed' } })
      await this.unlinkRoundVotes(tx, roundId)
      // Closing never elects anyone: the mesa reviews the ranking and declares the result, or repeats the vote.
      if (current.category === 'committee' && !current.committee_root_round_id) {
        await tx.round.update({ where: { id: roundId }, data: { committeeStage: 'composition_ready' } })
        await tx.auditEvent.create({ data: { assemblyId: current.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: 'committee.election.closed_for_official_composition' } })
      }
      return { ...updated, changed: true }
    })
    // Also runs when the round was already closed, so repeating "close" retries a failed cleanup.
    let secrecyCleanupPending = false
    try {
      await this.ensureVotesUnlinked(round.assemblyId)
    } catch (error) {
      secrecyCleanupPending = true
      this.logger.error(`Vote unlinking did not complete for assembly ${round.assemblyId}; publishing stays blocked: ${(error as Error).message}`)
    }
    const [recorded, eligible, title] = await Promise.all([
      this.prisma.participation.count({ where: { roundId } }),
      this.prisma.participantSession.count({ where: { assemblyId: round.assemblyId, status: 'active' } }),
      this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { title: true } }),
    ])
    const payload = { roundId, status: round.status as RoundStatus, title: title.title }
    if (round.changed) {
      this.realtime.roundState(round.assemblyId, payload)
      if (round.status === 'closed') this.realtime.roundClosed(round.assemblyId, roundId)
      this.realtime.participationCount(round.assemblyId, { roundId, recorded, eligible })
    }
    return {
      roundId, status: round.status, participation: { recorded, eligible },
      ...(secrecyCleanupPending ? { secrecyCleanupPending: true } : {}),
    }
  }

  async publishRound(roundId: string) {
    const current = await this.prisma.round.findUnique({ where: { id: roundId }, select: { id: true, assemblyId: true, status: true, title: true } })
    if (!current) throw new NotFoundException('Ronda no encontrada')
    if (current.status !== 'closed' && current.status !== 'published') throw new ConflictException('Cierra la papeleta antes de publicar resultados')
    let publishedNow = false
    if (current.status === 'closed') {
      await this.ensureVotesUnlinkedOrFail(current.assemblyId)
      await this.prisma.$transaction(async (tx) => {
        const roundRows = await tx.$queryRaw<Array<{ assembly_id: string }>>`SELECT assembly_id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`
        if (!roundRows[0]) throw new NotFoundException('Ronda no encontrada')
        await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${roundRows[0].assembly_id}::uuid FOR UPDATE`
        const assembly = await tx.assembly.findUnique({ where: { id: roundRows[0].assembly_id }, select: { status: true } })
        if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus resultados')
        const latest = await tx.round.findUniqueOrThrow({ where: { id: roundId }, select: { status: true, votesUnlinkedAt: true } })
        if (latest.status === 'published') return
        if (latest.status !== 'closed') throw new ConflictException('La papeleta debe estar cerrada para publicar')
        const stillLinked = await tx.round.count({ where: { assemblyId: current.assemblyId, status: { in: [...SETTLED_ROUND_STATUSES] }, votesUnlinkedAt: null } })
        if (stillLinked) throw new ServiceUnavailableException(SECRECY_CLEANUP_PENDING)
        await tx.round.update({ where: { id: roundId }, data: { status: 'published', publishedAt: new Date() } })
        await tx.auditEvent.create({ data: { assemblyId: current.assemblyId, roundId, actorRef: MODERATOR_ACTOR, action: 'round.results_published' } })
        publishedNow = true
      })
    }
    const results = await this.publishedResults(roundId)
    if (!publishedNow) return { roundId, status: 'published', results }
    const payload = { roundId, options: results }
    this.realtime.roundState(current.assemblyId, { roundId, status: 'published', title: current.title })
    this.realtime.resultsPublished(current.assemblyId, payload)
    return { roundId, status: 'published', results }
  }

  async declareOfficialResult(roundId: string, input: OfficialResultDto) {
    const optionIds = [...new Set(input.optionIds)]
    if (optionIds.length !== input.optionIds.length) throw new UnprocessableEntityException('No repitas opciones en el resultado declarado')
    const note = input.note?.trim() || null
    const declared = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; category: string; committee_type: string | null; member_count: number | null }>>`
        SELECT id, assembly_id, status, category, committee_type, member_count FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${round.assembly_id}::uuid FOR UPDATE`
      await this.assertDecidable(tx, roundId)
      if (round.category === 'committee' && round.member_count !== null && optionIds.length !== round.member_count) {
        throw new UnprocessableEntityException(`Selecciona exactamente ${round.member_count} integrantes para la comisión`)
      }
      const options = await tx.ballotOption.findMany({ where: { roundId, id: { in: optionIds } }, select: { id: true, label: true, isNullVote: true } })
      if (options.length !== optionIds.length) throw new UnprocessableEntityException('Todas las opciones declaradas deben pertenecer a esta papeleta')
      if (options.some((option) => option.isNullVote)) throw new UnprocessableEntityException(`«${NULL_VOTE_LABEL}» no se puede declarar como resultado`)
      const current = await tx.officialResult.findUnique({
        where: { roundId }, include: { options: { include: { option: { select: { label: true } } } } },
      })
      const now = new Date()
      const saved = current
        ? await tx.officialResult.update({
            where: { id: current.id },
            data: {
              note, actorRef: MODERATOR_ACTOR, declaredAt: now, publishedAt: null,
              options: { deleteMany: {}, create: optionIds.map((optionId) => ({ optionId })) },
            },
            include: { options: { include: { option: { select: { label: true } } } } },
          })
        : await tx.officialResult.create({
            data: { roundId, note, actorRef: MODERATOR_ACTOR, declaredAt: now, options: { create: optionIds.map((optionId) => ({ optionId })) } },
            include: { options: { include: { option: { select: { label: true } } } } },
          })
      await tx.auditEvent.create({
        data: {
          assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR,
          action: current ? 'round.official_result.corrected' : 'round.official_result.declared',
          occurredAt: now,
          metadata: {
            previous: current ? { optionLabels: current.options.map((item) => item.option.label), note: current.note } : null,
            declared: { optionLabels: options.map((option) => option.label), note },
          },
        },
      })
      return saved
    })
    const round = await this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { assemblyId: true, status: true, title: true } })
    this.realtime.roundState(round.assemblyId, { roundId, status: round.status, title: round.title })
    return this.serializeOfficialResult(declared)
  }

  async publishOfficialResult(roundId: string) {
    const published = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ assembly_id: string; status: string }>>`
        SELECT assembly_id, status FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${round.assembly_id}::uuid FOR UPDATE`
      const publishedInChain = await tx.round.count({ where: { OR: [{ id: roundId }, { committeeRootRoundId: roundId }], status: 'published' } })
      if (!publishedInChain) throw new ConflictException('Publica primero el conteo de la papeleta o de su repetición')
      const existing = await tx.officialResult.findUnique({ where: { roundId } })
      if (!existing) throw new ConflictException('Registra primero el resultado oficial de la mesa')
      if (existing.publishedAt) return tx.officialResult.findUniqueOrThrow({
        where: { roundId }, include: { options: { include: { option: { select: { label: true } } } } },
      })
      const now = new Date()
      const result = await tx.officialResult.update({
        where: { roundId }, data: { publishedAt: now },
        include: { options: { include: { option: { select: { label: true } } } } },
      })
      await tx.auditEvent.create({ data: { assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: 'round.official_result.published', occurredAt: now } })
      return result
    })
    const round = await this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { assemblyId: true, status: true, title: true } })
    this.realtime.roundState(round.assemblyId, { roundId, status: round.status, title: round.title })
    return this.serializeOfficialResult(published)
  }

  /**
   * Annuls a ballot (for example, a misspelled candidate). Its votes are deleted so they can never be
   * counted or published; participation receipts stay as the record of who took part. The deleted
   * tuples keep their original `xmin` until vacuumed, so the round goes through the same cleanup as closing.
   */
  async annulRound(roundId: string, reason: string) {
    const annulled = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; title: string; committee_root_round_id: string | null }>>`
        SELECT id, assembly_id, status, title, committee_root_round_id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${round.assembly_id}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: round.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus papeletas')
      if (round.status === 'annulled') return { assemblyId: round.assembly_id, title: round.title, previousStatus: round.status, changed: false }
      // A repetition's result is declared on the original ballot, so that is where the declaration lives.
      // A draft has no votes, so discarding it cannot affect the declaration.
      if (round.status !== 'draft') await this.assertNoOfficialResult(tx, round.committee_root_round_id ?? round.id, 'Ya hay un resultado oficial registrado con esta votación; retíralo antes de anularla')
      if (await tx.round.count({ where: { committeeRootRoundId: roundId, status: 'open' } })) {
        throw new ConflictException('Cierra primero la repetición abierta de esta papeleta')
      }
      await tx.round.update({
        where: { id: roundId },
        data: { status: 'annulled', annulledAt: new Date(), annulReason: reason.trim(), votesUnlinkedAt: null },
      })
      await tx.anonymousVote.deleteMany({ where: { roundId } })
      await tx.auditEvent.create({ data: { assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: 'round.annulled', metadata: { previousStatus: round.status, reason: reason.trim() } } })
      return { assemblyId: round.assembly_id, title: round.title, previousStatus: round.status, changed: true }
    })
    let secrecyCleanupPending = false
    try {
      await this.ensureVotesUnlinked(annulled.assemblyId)
    } catch (error) {
      secrecyCleanupPending = true
      this.logger.error(`Vote cleanup after annulment did not complete for assembly ${annulled.assemblyId}: ${(error as Error).message}`)
    }
    if (annulled.changed) {
      this.realtime.roundState(annulled.assemblyId, { roundId, status: 'annulled', title: annulled.title })
      if (annulled.previousStatus === 'open') this.realtime.roundClosed(annulled.assemblyId, roundId)
    }
    return { roundId, status: 'annulled' as const, ...(secrecyCleanupPending ? { secrecyCleanupPending: true } : {}) }
  }

  /**
   * Prepares a new vote among the options the mesa selected from a closed, published or annulled ballot,
   * for example the most voted candidates. The new round is linked to the original one, where the mesa
   * declares the official result once it decides.
   */
  async repeatRound(roundId: string, input: RepeatRoundDto) {
    const optionIds = [...new Set(input.optionIds)]
    if (optionIds.length !== input.optionIds.length) throw new UnprocessableEntityException('No repitas opciones')
    const created = await this.prisma.$transaction(async (tx) => {
      const source = await tx.round.findUnique({ where: { id: roundId }, include: { options: { orderBy: { order: 'asc' } } } })
      if (!source) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${source.assemblyId}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: source.assemblyId }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten nuevas papeletas')
      if (!['lobby_closed', 'in_progress'].includes(assembly?.status ?? '')) throw new ConflictException('Cierra el ingreso antes de preparar una papeleta')
      if (!['closed', 'published', 'annulled'].includes(source.status)) throw new ConflictException('Solo se puede repetir una papeleta cerrada, publicada o anulada')
      await this.assertNoOfficialResult(tx, source.committeeRootRoundId ?? source.id, 'La papeleta original ya tiene un resultado oficial; retíralo antes de repetir la votación')
      if (source.category === 'committee' && !source.options.some((option) => !option.isNullVote)) throw new ConflictException('Esta comisión todavía no tiene candidaturas para votar')
      const selected = source.options.filter((option) => optionIds.includes(option.id))
      if (selected.length !== optionIds.length) throw new UnprocessableEntityException('Todas las opciones deben pertenecer a la papeleta original')
      if (selected.some((option) => option.isNullVote)) throw new UnprocessableEntityException(`«${NULL_VOTE_LABEL}» se agrega automáticamente`)
      const rootId = source.committeeRootRoundId ?? source.id
      const root = source.committeeRootRoundId ? await tx.round.findUniqueOrThrow({ where: { id: rootId }, select: { title: true } }) : source
      const seats = source.category === 'committee' ? (input.seats ?? Math.min(source.electionSeats ?? source.memberCount ?? selected.length, selected.length)) : null
      if (seats !== null && (seats < 1 || seats > selected.length)) throw new UnprocessableEntityException(`Indica entre 1 y ${selected.length} cupos para esta votación`)
      if (source.category !== 'committee' && input.seats !== undefined) throw new UnprocessableEntityException('Los cupos solo aplican a comisiones')
      const round = await tx.round.create({
        data: {
          assemblyId: source.assemblyId,
          title: input.title?.trim() || `${root.title} — nueva votación`,
          format: source.format,
          category: source.category,
          committeeType: source.committeeType,
          memberCount: source.memberCount,
          decisionNote: source.decisionNote,
          committeeStage: source.category === 'committee' ? 'tie_break' : null,
          committeeConfiguration: (source.committeeConfiguration ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          committeeRootRoundId: rootId,
          electionSeats: seats,
          countingRule: { kind: 'count_only', reason: 'repeat' },
          options: { create: [
            ...selected.map((option, order) => ({ label: option.label, order, candidateParticipantId: option.candidateParticipantId })),
            this.nullVoteOption(selected.length),
          ] },
        },
        include: { options: { orderBy: { order: 'asc' } } },
      })
      await tx.auditEvent.create({ data: { assemblyId: source.assemblyId, roundId: round.id, actorRef: MODERATOR_ACTOR, action: 'round.repeated', metadata: { sourceRoundId: source.id, optionLabels: selected.map((option) => option.label), seats } } })
      return round
    })
    return { id: created.id, title: created.title, status: created.status, committeeRootRoundId: created.committeeRootRoundId, electionSeats: created.electionSeats, options: created.options }
  }

  /** Removes the mesa's declaration (published or not) so the ballot can be repeated or annulled; the audit keeps it. */
  async withdrawOfficialResult(roundId: string) {
    const withdrawn = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ assembly_id: string; title: string; status: string }>>`
        SELECT assembly_id, title, status FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rows[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${round.assembly_id}::uuid FOR UPDATE`
      const assembly = await tx.assembly.findUnique({ where: { id: round.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus resultados')
      const current = await tx.officialResult.findUnique({ where: { roundId }, include: { options: { include: { option: { select: { label: true } } } } } })
      if (!current) throw new NotFoundException('Esta papeleta no tiene un resultado oficial registrado')
      await tx.officialResult.delete({ where: { roundId } })
      await tx.auditEvent.create({ data: {
        assemblyId: round.assembly_id, roundId, actorRef: MODERATOR_ACTOR, action: 'round.official_result.withdrawn',
        metadata: { previous: { optionLabels: current.options.map((item) => item.option.label), note: current.note, publishedAt: current.publishedAt?.toISOString() ?? null } },
      } })
      return round
    })
    this.realtime.roundState(withdrawn.assembly_id, { roundId, status: withdrawn.status as RoundStatus, title: withdrawn.title })
    return { roundId, withdrawn: true }
  }

  /** An annulled committee keeps its last stage, so the stage alone does not mean the stage is still open. */
  private async assertNominationStageOpen(tx: Prisma.TransactionClient, roundId: string, stage: 'proposals' | 'support', message: string) {
    const rows = await tx.$queryRaw<Array<{ status: string; committee_stage: string | null }>>`SELECT status, committee_stage FROM rounds WHERE id = ${roundId}::uuid FOR SHARE`
    if (rows[0]?.status !== 'draft' || rows[0]?.committee_stage !== stage) throw new ConflictException(message)
  }

  private async assertNoOfficialResult(tx: Prisma.TransactionClient, rootRoundId: string, message: string) {
    if (await tx.officialResult.count({ where: { roundId: rootRoundId } })) throw new ConflictException(message)
  }

  private nullVoteOption(order: number) {
    return { label: NULL_VOTE_LABEL, order, isNullVote: true }
  }

  /** The official result is declared on the original ballot once it, or one of its repetitions, has been counted. */
  private async assertDecidable(tx: Prisma.TransactionClient, roundId: string) {
    const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, select: { committeeRootRoundId: true } })
    if (round.committeeRootRoundId) throw new UnprocessableEntityException('Registra el resultado oficial en la papeleta original, no en su repetición')
    const chain = await tx.round.findMany({ where: { OR: [{ id: roundId }, { committeeRootRoundId: roundId }] }, select: { status: true } })
    if (chain.some((item) => item.status === 'open')) throw new ConflictException('Cierra la votación abierta antes de registrar el resultado oficial')
    if (!chain.some((item) => item.status === 'closed' || item.status === 'published')) {
      throw new ConflictException('Cierra la papeleta antes de registrar el resultado oficial')
    }
  }

  private serializeOfficialResult(result: {
    roundId: string; note: string | null; actorRef: string; declaredAt: Date; publishedAt: Date | null;
    options: Array<{ optionId: string; option: { label: string } }>
  }) {
    return {
      roundId: result.roundId,
      elected: result.options.map(({ optionId, option }) => ({ optionId, label: option.label })),
      note: result.note,
      declaredBy: result.actorRef,
      declaredAt: result.declaredAt.toISOString(),
      publishedAt: result.publishedAt?.toISOString() ?? null,
    }
  }

  private async moderatorOfficialResult(roundId: string) {
    const result = await this.prisma.officialResult.findUnique({
      where: { roundId }, include: { options: { include: { option: { select: { label: true } } } } },
    })
    return result ? this.serializeOfficialResult(result) : null
  }

  private async publishedOfficialResult(roundId: string) {
    const result = await this.prisma.officialResult.findFirst({
      where: { roundId, publishedAt: { not: null } },
      include: { options: { include: { option: { select: { label: true } } } } },
    })
    if (!result) return null
    const serialized = this.serializeOfficialResult(result)
    return { elected: serialized.elected, note: serialized.note, declaredAt: serialized.declaredAt }
  }

  /**
   * A vote and its participation receipt are written in the same transaction, so until this runs
   * PostgreSQL can link them through the shared `xmin` and through physical insertion order.
   * Re-inserting the round's votes in random order gives them the closing transaction's id instead.
   */
  private async unlinkRoundVotes(tx: Prisma.TransactionClient, roundId: string) {
    await tx.$executeRaw`
      WITH removed AS (DELETE FROM anonymous_votes WHERE round_id = ${roundId}::uuid RETURNING option_id)
      INSERT INTO anonymous_votes (id, round_id, option_id)
      SELECT gen_random_uuid(), ${roundId}::uuid, option_id FROM removed ORDER BY random()
    `
  }

  /**
   * Completes unlinking for every closed round of the assembly that has not finished it, including
   * committee tie-break rounds that are never published on their own. Safe to repeat: shuffling again
   * only adds dead tuples that the same VACUUM removes. Throws if the cleanup cannot complete.
   */
  private async ensureVotesUnlinked(assemblyId?: string) {
    const pending = await this.prisma.round.findMany({
      where: { ...(assemblyId ? { assemblyId } : {}), status: { in: [...SETTLED_ROUND_STATUSES] }, votesUnlinkedAt: null }, select: { id: true },
    })
    if (!pending.length) return
    // One short transaction per round: a single transaction over many historical rounds could exceed
    // Prisma's interactive-transaction timeout and roll everything back on every retry.
    for (const { id } of pending) await this.prisma.$transaction((tx) => this.unlinkRoundVotes(tx, id))
    await this.vacuumAnonymousVotes()
    await this.prisma.round.updateMany({ where: { id: { in: pending.map(({ id }) => id) } }, data: { votesUnlinkedAt: new Date() } })
  }

  private async ensureVotesUnlinkedOrFail(assemblyId: string) {
    try {
      await this.ensureVotesUnlinked(assemblyId)
    } catch (error) {
      this.logger.error(`Vote unlinking did not complete for assembly ${assemblyId}: ${(error as Error).message}`)
      throw new ServiceUnavailableException(SECRECY_CLEANUP_PENDING)
    }
  }

  protected vacuumLockTimeoutMs = VACUUM_LOCK_TIMEOUT_MS

  /**
   * Physically removes the dead pre-shuffle tuples, which otherwise keep their original `xmin` until vacuumed.
   * VACUUM FULL needs an exclusive lock and cannot run in a transaction, so `lock_timeout` must be set on the
   * same session; a dedicated connection guarantees that, unlike the pool. Without the timeout, a held lock
   * would leave closing or startup waiting forever instead of reaching the recoverable error.
   */
  protected async vacuumAnonymousVotes() {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query(`SET lock_timeout = ${Math.trunc(this.vacuumLockTimeoutMs)}`)
      await client.query('VACUUM FULL anonymous_votes')
    } finally {
      await client.end()
    }
  }

  protected async vacuumDatabase() {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query(`SET lock_timeout = ${Math.trunc(this.vacuumLockTimeoutMs)}`)
      await client.query('VACUUM FULL')
    } finally {
      await client.end()
    }
  }

  private async publishedResults(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { status: true } })
    if (!round || round.status !== 'published') throw new NotFoundException('Resultados no publicados')
    return this.rankedCounts(roundId)
  }

  /** Counts per option for any round; callers decide who may see them. */
  private async rankedCounts(roundId: string) {
    const [options, counts] = await Promise.all([
      this.prisma.ballotOption.findMany({ where: { roundId }, orderBy: { order: 'asc' }, select: { id: true, label: true, isNullVote: true } }),
      this.prisma.anonymousVote.groupBy({ by: ['optionId'], where: { roundId }, _count: { _all: true } }),
    ])
    const countByOption = new Map(counts.map((row) => [row.optionId, row._count._all]))
    // Ranked by votes for the mesa to decide; ties keep ballot order and the null vote is listed last.
    return options
      .map((option) => ({ optionId: option.id, label: option.label, count: countByOption.get(option.id) ?? 0, isNullVote: option.isNullVote }))
      .sort((a, b) => Number(a.isNullVote) - Number(b.isNullVote) || b.count - a.count)
  }
}
