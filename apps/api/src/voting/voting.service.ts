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
import { keepRoundTitlesInLog, requireLogDownloadedForDeletion } from './operator-log.service.js'
import { hashCredential, newOpaqueCredential } from '../auth/credentials.js'
import { RealtimeGateway } from '../realtime/realtime.gateway.js'
import type { AssemblyStatus, RoundStatus } from '../generated/prisma/enums.js'
import type { CreateRoundDto, RepeatRoundDto } from './dtos.js'
import { presentationOf } from './presentation.service.js'
import { tiedAtCut, type ThresholdRule } from './results-engine.js'
import { roomNumbers } from './room.js'
import { appUrl } from './app-url.js'
import { assertNotCompleted, lockAssembly, recordAudit } from './assembly-tx.js'
import { baseOf, basePeople, countInRoom, freezeRoundBase, roundBase, roundBases } from './base-count.js'
import { ORGANIZATION_ID, RESULTS_ENGINE_ACTOR, RESUME_CODE_TTL_MS, SECRECY_CLEANUP_PENDING, VACUUM_LOCK_TIMEOUT_MS } from './constants.js'
import { BOOLEAN_DECISION_LABELS, SETTLED_ROUND_STATUSES, decisionFields, isRunoff, outcomeOf, runoffSourceOf, seatsOf, voteNumberIn, waitsForSourceResult } from './round-rules.js'

/** The Unión Hondureña org chart, seeded in this order on every new Asamblea (Asamblea, Nov 2026). */
export const DEFAULT_BOARD_POSITIONS = ['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3'] as const
export const DEFAULT_DEPARTMENT_POSITIONS = [
  'Auditor', 'Escuela Sabática', 'Obra Misionera', 'Niños', 'Jóvenes', 'Asistencia Social', 'Salud', 'Familia',
  'Colportaje', 'Música', 'Industria y Comercio', 'Multimedia', 'Agricultura', 'Construcción',
] as const

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
      await this.showSeparatedResults(undefined, false)
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
    await this.showSeparatedResults(assemblyId)
    return { assemblyId, secrecyCleanupPending: false }
  }

  async createAssembly(name: string, period?: string) {
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
        data: { organizationId: ORGANIZATION_ID, name: name.trim(), period: period?.trim() || null, status: 'lobby_open', joinCodeHash },
        select: { id: true, name: true, period: true, status: true },
      })
      await tx.position.createMany({ data: [
        ...DEFAULT_BOARD_POSITIONS.map((label, sortOrder) => ({ assemblyId: created.id, group: 'board' as const, label, sortOrder })),
        ...DEFAULT_DEPARTMENT_POSITIONS.map((label, sortOrder) => ({ assemblyId: created.id, group: 'department' as const, label, sortOrder })),
      ] })
      await recordAudit(tx, { assemblyId: created.id, action: 'assembly.created_and_lobby_opened' })
      return created
    })
    this.realtime.assemblyState(assembly.id, { status: assembly.status })
    this.realtime.lobbyState(assembly.id, { status: 'open', participantCount: 0 })
    return { assemblyId: assembly.id, name: assembly.name, period: assembly.period, status: assembly.status, joinCode, joinUrl: appUrl({ join: joinCode }) }
  }

  /** The mesa adds a departamento the default org chart lacks; it goes last among the departamentos. */
  async addPosition(assemblyId: string, label: string) {
    const name = label.trim()
    if (!name) throw new UnprocessableEntityException('Escribe el nombre del departamento')
    const position = await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      assertNotCompleted(assembly.status)
      const existing = await tx.position.findMany({ where: { assemblyId }, select: { label: true, group: true, sortOrder: true } })
      const key = name.toLocaleLowerCase('es')
      if (existing.some((item) => item.label.toLocaleLowerCase('es') === key)) throw new UnprocessableEntityException('Ese puesto ya está en la lista')
      const sortOrder = Math.max(-1, ...existing.filter((item) => item.group === 'department').map((item) => item.sortOrder)) + 1
      const created = await tx.position.create({
        data: { assemblyId, group: 'department', label: name, sortOrder, custom: true },
        select: { id: true, group: true, label: true, sortOrder: true, custom: true },
      })
      await recordAudit(tx, { assemblyId, action: 'position.added', metadata: { positionId: created.id, label: created.label } })
      return { ...created, status: assembly.status as AssemblyStatus }
    })
    // Mesa and projector refetch their state on assembly.state, so the new box shows on the org chart.
    this.realtime.assemblyState(assemblyId, { status: position.status })
    return { id: position.id, group: position.group, label: position.label, sortOrder: position.sortOrder, custom: position.custom, elected: null }
  }

  private async positionsOf(assemblyId: string) {
    const positions = await this.prisma.position.findMany({
      where: { assemblyId },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      include: {
        rounds: {
          where: { category: 'office', committeeRootRoundId: null },
          orderBy: { createdAt: 'asc' },
          select: { officialResult: { select: { registeredAt: true, options: { select: { option: { select: { label: true, roundId: true } } } } } } },
        },
      },
    })
    return positions.map((position) => {
      const elected = position.rounds
        .flatMap((round) => (round.officialResult?.registeredAt ? round.officialResult.options : []))
        .at(-1)
      return {
        id: position.id, group: position.group, label: position.label, sortOrder: position.sortOrder, custom: position.custom,
        elected: elected ? { label: elected.option.label, roundId: elected.option.roundId } : null,
      }
    })
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
      assertNotCompleted(current.assembly.status)
      await tx.participantSession.update({ where: { id: participantId }, data: { resumeCodeHash: hashCredential(resumeCode), resumeExpiresAt: expiresAt } })
      await recordAudit(tx, { assemblyId: current.assemblyId, action: 'participant.resume_code_issued', metadata: { participantId, personName: `${current.firstName} ${current.lastName}` } })
      return current
    })
    return {
      participantId,
      name: `${participant.firstName} ${participant.lastName}`,
      resumeUrl: appUrl({ resume: resumeCode }),
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
      await recordAudit(tx, { assemblyId: current.assemblyId, action: 'participant.resume_code_redeemed', metadata: { participantId: current.id } })
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

  async participantState(participantId: string) {
    const participant = await this.prisma.participantSession.findUnique({
      where: { id: participantId },
      include: { assembly: { select: { id: true, name: true, status: true, completedAt: true } } },
    })
    if (!participant || participant.status !== 'active') throw new NotFoundException('Sesión no encontrada')
    const round = await this.prisma.round.findFirst({
      where: { assemblyId: participant.assemblyId, status: { in: ['open', 'closed', 'published', 'annulled'] } },
      orderBy: { createdAt: 'desc' },
      include: { options: { orderBy: { order: 'asc' }, select: { id: true, label: true } } },
    })
    const participation = round
      ? await this.prisma.participation.findUnique({
          where: { roundId_participantSessionId: { roundId: round.id, participantSessionId: participant.id } },
          select: { id: true },
        })
      : null
    const chain = round ? await this.chainPosition(round) : null
    // An inhabilitado receives no ballot: the open round is announced without its options.
    const ballotWithheld = round?.status === 'open' && (participant.votingDisabled || (participant.isRegionalSecretary && !round.regionalSecretaryVotes))
    const openRound = round
      ? { roundId: round.id, status: round.status, title: round.title, format: round.format, category: round.category, memberCount: round.memberCount, electionSeats: round.electionSeats, regionalSecretaryVotes: round.regionalSecretaryVotes, ...decisionFields(round), ...chain, options: ballotWithheld ? [] : round.options.map((o) => ({ optionId: o.id, label: o.label })) }
      : null
    // Runoffs belong to the election's first vote, where the official result accumulates.
    const officialRoundId = round?.committeeRootRoundId ?? round?.id
    const results = round?.status === 'published' ? await this.publishedResults(round.id) : undefined
    const officialResult = officialRoundId ? await this.publishedOfficialResult(officialRoundId) : null
    const [recordedCount, eligibleCounts] = results && round
      ? await Promise.all([this.prisma.participation.count({ where: { roundId: round.id } }), roundBases(this.prisma, participant.assemblyId)])
      : [undefined, undefined]
    const outcome = results && round && eligibleCounts ? outcomeOf(round, results, eligibleCounts.get(round.id) ?? 0) : undefined
    return {
      assembly: { id: participant.assembly.id, name: participant.assembly.name, status: participant.assembly.status, completedAt: participant.assembly.completedAt?.toISOString() ?? null },
      assemblyStatus: participant.assembly.status,
      assemblyCompletedAt: participant.assembly.completedAt?.toISOString() ?? null,
      lobbyStatus: participant.assembly.status === 'lobby_open' ? 'open' as const : 'closed' as const,
      openRound,
      participationStatus: participation ? 'recorded' as const : 'pending' as const,
      votingDisabled: participant.votingDisabled,
      ...(results ? { results } : {}),
      ...(recordedCount !== undefined && eligibleCounts && round ? { recordedCount, eligibleCount: eligibleCounts.get(round.id) ?? 0 } : {}),
      ...(outcome ? { outcome } : {}),
      ...(outcome && round ? await this.resultSummary(round.id, outcome.runoff) : {}),
      ...(officialResult ? { officialResult } : {}),
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
        const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; format: string; category: string; member_count: number | null; election_seats: number | null; regional_secretary_votes: boolean }>>`
          SELECT id, assembly_id, status, format, category::text AS category, member_count, election_seats, regional_secretary_votes FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
        `
        const round = rows[0]
        if (!round) throw new NotFoundException('Ronda no encontrada')
        if (round.assembly_id !== participant.assemblyId) throw new NotFoundException('Ronda no encontrada')
        if (round.status !== 'open') throw new ConflictException('La papeleta no está abierta')
        // Read under a row lock so an Inhabilitar committing at the same moment lands either before or after this vote.
        const sessions = await tx.$queryRaw<Array<{ voting_disabled: boolean; is_regional_secretary: boolean }>>`
          SELECT voting_disabled, is_regional_secretary FROM participant_sessions WHERE id = ${participant.id}::uuid FOR SHARE
        `
        if (sessions[0]?.voting_disabled === true) throw new ForbiddenException('Tu voto está inhabilitado')
        if (sessions[0]?.is_regional_secretary === true && !round.regional_secretary_votes) throw new ForbiddenException('Esta votación no incluye a la secretaría regional')
        if (round.format === 'single_choice' && optionIds.length !== 1) throw new UnprocessableEntityException('Esta papeleta permite una sola opción')
        const options = await tx.ballotOption.count({ where: { id: { in: optionIds }, roundId } })
        if (options !== optionIds.length) throw new UnprocessableEntityException('Todas las opciones deben pertenecer a esta papeleta')
        // A committee ballot or runoff takes exactly the open seats, never fewer or more. A decision is
        // single choice, so the rule never applies to it.
        const seats = round.category === 'decision' ? null : round.election_seats ?? round.member_count
        if (round.category === 'decision' && optionIds.length !== 1) throw new UnprocessableEntityException('Esta papeleta permite una sola opción')
        if (seats !== null && seats !== undefined && optionIds.length !== seats) {
          throw new UnprocessableEntityException(`Marca exactamente ${seats} ${seats === 1 ? 'nombre' : 'nombres'}`)
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
    const state = await this.participantState(participantId)
    this.realtime.participantState(participantId, state)
    await this.announceParticipationCount(participant.assemblyId, roundId)
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
    const [participantCount, participants, recordedCount, eligibleCounts] = await Promise.all([
      countInRoom(this.prisma, assembly.id),
      assembly.status === 'lobby_open'
        ? this.prisma.participantSession.findMany({
            where: { assemblyId: assembly.id, status: 'active', isRegionalSecretary: false },
            orderBy: { joinedAt: 'asc' },
            select: { firstName: true, lastName: true },
          })
        : Promise.resolve(undefined),
      // Kept once published: a committee's percentages are over the people who voted, not over the marks.
      round && ['open', 'closed', 'published'].includes(round.status)
        ? this.prisma.participation.count({ where: { roundId: round.id } })
        : Promise.resolve(undefined),
      roundBases(this.prisma, assembly.id),
    ])
    const officialRoundId = round?.committeeRootRoundId ?? round?.id
    const result = round?.status === 'published' ? await this.publishedResults(round.id) : undefined
    const officialResult = officialRoundId ? await this.publishedOfficialResult(officialRoundId) : null
    const [chain, ballot] = round
      ? await Promise.all([this.chainPosition(round), this.prisma.ballotOption.findMany({ where: { roundId: round.id }, orderBy: { order: 'asc' }, select: { id: true } })])
      : [null, []]
    const outcome = result && round ? outcomeOf({ ...round, options: ballot }, result, eligibleCounts.get(round.id) ?? participantCount) : undefined
    const positions = await this.positionsOf(assembly.id)
    return {
      assembly: { id: assembly.id, name: assembly.name, status: assembly.status, completedAt: assembly.completedAt?.toISOString() ?? null },
      assemblyName: assembly.name,
      period: assembly.period,
      positions,
      // The projector runs on the server laptop, whose own address is not the one phones can reach.
      joinUrl: appUrl({ join: assemblyCode }),
      participantCount,
      ...(participants ? { participants } : {}),
      ...(recordedCount !== undefined ? { recordedCount, eligibleCount: eligibleCounts.get(round!.id) ?? participantCount } : {}),
      round: round ? { id: round.id, title: round.title, status: round.status, format: round.format, category: round.category, memberCount: round.memberCount, electionSeats: round.electionSeats, regionalSecretaryVotes: round.regionalSecretaryVotes, positionId: await this.positionIdOf(round), ...decisionFields(round), ...chain } : null,
      ...(result ? { results: result } : {}),
      ...(outcome ? { outcome } : {}),
      ...(outcome && round ? await this.resultSummary(round.id, outcome.runoff) : {}),
      ...(officialResult ? { officialResult } : {}),
      presentation: presentationOf(assembly),
    }
  }

  async moderatorAssembly(assemblyId: string) {
    const assembly = await this.prisma.assembly.findUnique({
      where: { id: assemblyId },
      include: {
        participants: { where: { status: 'active', isRegionalSecretary: false }, orderBy: { joinedAt: 'asc' }, select: { id: true, firstName: true, lastName: true, status: true, votingDisabled: true, joinedAt: true } },
        rounds: { orderBy: { createdAt: 'asc' }, include: { options: { orderBy: { order: 'asc' } }, _count: { select: { participations: true } } } },
      },
    })
    if (!assembly) throw new NotFoundException('Asamblea no encontrada')
    const attendanceRound = await this.prisma.round.findFirst({
      where: { assemblyId, openedAt: { not: null } }, orderBy: { openedAt: 'desc' }, select: { id: true, status: true },
    })
    const votedCount = attendanceRound ? await this.prisma.participation.count({ where: { roundId: attendanceRound.id } }) : 0
    const [eligibleCounts, leftParticipants, regionalSecretary, accredited] = await Promise.all([
      roundBases(this.prisma, assemblyId),
      this.prisma.participantSession.findMany({ where: { assemblyId, status: 'left', isRegionalSecretary: false }, orderBy: { joinedAt: 'asc' }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.participantSession.findFirst({ where: { assemblyId, isRegionalSecretary: true }, select: { id: true, firstName: true, lastName: true, status: true } }),
      this.prisma.participantSession.count({ where: { assemblyId, status: { in: ['active', 'left'] }, isRegionalSecretary: false } }),
    ])
    const chains = new Map<string, Array<{ id: string; status: string }>>()
    for (const round of assembly.rounds) {
      const rootId = round.committeeRootRoundId ?? round.id
      chains.set(rootId, [...(chains.get(rootId) ?? []), round])
    }
    const positionOfRound = new Map(assembly.rounds.map((round) => [round.id, round.positionId]))
    const statusById = new Map(assembly.rounds.map((round) => [round.id, round.status]))
    const shownRounds = assembly.rounds.filter((round) => !waitsForSourceResult(round.status, round.countingRule, statusById))
    const rounds = await Promise.all(shownRounds.map(async (round) => ({
      id: round.id,
      title: round.title,
      // A runoff fills its root's puesto.
      positionId: round.committeeRootRoundId ? positionOfRound.get(round.committeeRootRoundId) ?? null : round.positionId,
      format: round.format,
      category: round.category,
      memberCount: round.memberCount,
      electionSeats: round.electionSeats,
      regionalSecretaryVotes: round.regionalSecretaryVotes,
      ...decisionFields(round),
      committeeRootRoundId: round.committeeRootRoundId,
      countingRule: round.countingRule,
      status: round.status,
      options: round.options,
      annulledAt: round.annulledAt?.toISOString() ?? null,
      annulReason: round.annulReason,
      participationCount: round._count.participations,
      eligibleCount: eligibleCounts.get(round.id) ?? assembly.participants.length,
      secrecyCleanupPending: (SETTLED_ROUND_STATUSES as readonly string[]).includes(round.status) && !round.votesUnlinkedAt,
      ...(round.status === 'published' ? { results: await this.publishedResults(round.id) } : {}),
      ...(round.status === 'published'
        ? await this.moderatorSummary(round.id, outcomeOf(round, await this.rankedCounts(round.id), eligibleCounts.get(round.id) ?? assembly.participants.length))
        : {}),
      voteNumber: voteNumberIn(chains.get(round.committeeRootRoundId ?? round.id) ?? [], round.id),
      runoff: isRunoff(round.countingRule),
      runoffSourceRoundId: runoffSourceOf(round.countingRule),
      officialResult: await this.moderatorOfficialResult(round.id),
    })))
    // A runoff prepared on closing waits as a draft: the mesa keeps seeing the vote that produced it
    // until it opens the runoff.
    const latest = rounds.at(-1)
    const currentRound = latest?.status === 'draft' && latest.runoffSourceRoundId
      ? rounds.find((item) => item.id === latest.runoffSourceRoundId && (item.status === 'closed' || item.status === 'published')) ?? latest
      : latest
    return {
      id: assembly.id,
      name: assembly.name,
      period: assembly.period,
      positions: await this.positionsOf(assemblyId),
      status: assembly.status,
      completedAt: assembly.completedAt?.toISOString() ?? null,
      participants: assembly.participants,
      participantCount: assembly.participants.length,
      room: roomNumbers(assembly.participants.length, accredited),
      regionalSecretary,
      // Kept for the acta: they were registered, and those who voted still count in that ballot's base.
      leftParticipants,
      attendanceRound: attendanceRound ? { roundId: attendanceRound.id, status: attendanceRound.status, votedCount, eligibleCount: eligibleCounts.get(attendanceRound.id) ?? assembly.participants.length } : null,
      // The join code is only stored hashed, so the panel builds the QR from this base and the code it kept.
      publicAppUrl: process.env.PUBLIC_APP_URL,
      rounds,
      currentRound: currentRound ?? null,
      presentation: presentationOf(assembly),
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

  /**
   * After the assembly the acta is the record, not the database (Secretaría, Oct 2026). Only a completed
   * assembly can be erased: names, receipts, votes and the audit trail go with it, and VACUUM FULL
   * rewrites the tables so the deleted rows do not stay in their files.
   */
  async deleteAssemblyData(assemblyId: string, confirmation: true) {
    await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status !== 'completed') throw new ConflictException('Finaliza la Asamblea antes de borrar sus datos')
      await requireLogDownloadedForDeletion(tx, assemblyId)
      if (confirmation !== true) throw new UnprocessableEntityException('Confirma explícitamente el borrado de los datos')
      // Rounds first: their participation receipts reference the participant sessions.
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
      await recordAudit(tx, { assemblyId, action: 'assembly.completed', occurredAt: completedAt })
      return { id: updated.id, status: updated.status, completedAt, changed: true }
    })
    if (completed.changed) {
      this.realtime.assemblyState(assemblyId, { status: 'completed', completedAt: completed.completedAt.toISOString() })
    }
    return { id: completed.id, status: completed.status, completedAt: completed.completedAt.toISOString() }
  }

  async createRound(assemblyId: string, input: CreateRoundDto) {
    const category = input.category ?? 'office'
    if (category !== 'committee' && input.memberCount !== undefined) {
      throw new UnprocessableEntityException('El número de integrantes solo aplica a comisiones')
    }
    if (category === 'committee' && !input.memberCount) {
      throw new UnprocessableEntityException('Indica cuántos integrantes quedarán en la comisión')
    }
    if (category !== 'decision' && (input.decisionFormat !== undefined || (input.approvalRule ?? 'simple') !== 'simple')) {
      throw new UnprocessableEntityException('El formato y la regla de aprobación solo aplican a decisiones')
    }
    if (category === 'decision' && !input.decisionFormat) throw new UnprocessableEntityException('Indica el formato de la decisión')
    if (category !== 'office' && input.positionId !== undefined) throw new UnprocessableEntityException('El puesto solo aplica a cargos')
    if (!input.positionId && !input.title?.trim()) throw new UnprocessableEntityException('Escribe el título de la papeleta')
    // Results are computed on close (Asamblea, Nov 2026): the rule is the server's, whatever the client sends.
    const approvalRule: ThresholdRule = input.approvalRule ?? 'simple'
    const boolean = category === 'decision' && input.decisionFormat === 'boolean'
    if (boolean && input.options?.length) throw new UnprocessableEntityException('Una decisión A favor / En contra no lleva opciones')
    const labels = boolean ? [...BOOLEAN_DECISION_LABELS] : (input.options ?? []).map(({ label }) => label.trim())
    if (labels.length < 1) throw new UnprocessableEntityException('Agrega al menos una opción')
    if (category === 'decision' && labels.length < 2) throw new UnprocessableEntityException('Agrega al menos dos opciones')
    if (labels.some((label) => !label) || new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
      throw new UnprocessableEntityException('Las opciones deben tener etiquetas no vacías y distintas')
    }
    // More candidates than seats are allowed; fewer would leave seats nobody can fill.
    if (category === 'committee' && labels.length < input.memberCount!) {
      throw new UnprocessableEntityException(`Agrega al menos ${input.memberCount} candidatos para una comisión de ${input.memberCount} integrantes`)
    }
    const round = await this.prisma.$transaction(async (tx) => {
      const assembly = await lockAssembly(tx, assemblyId)
      if (!assembly) throw new NotFoundException('Asamblea no encontrada')
      if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten nuevas papeletas')
      if (!['lobby_closed', 'in_progress'].includes(assembly.status)) throw new ConflictException('Cierra el ingreso antes de preparar una papeleta')
      const position = input.positionId ? await tx.position.findFirst({ where: { id: input.positionId, assemblyId }, select: { id: true, label: true } }) : null
      if (input.positionId && !position) throw new UnprocessableEntityException('Ese puesto no está en la lista de esta Asamblea')
      if (position) {
        const elected = await tx.officialResultOption.count({ where: { officialResult: { round: { positionId: position.id, committeeRootRoundId: null } } } })
        if (elected) throw new ConflictException('Ese puesto ya tiene electo')
      }
      const created = await tx.round.create({
        data: {
          assemblyId,
          title: input.title?.trim() || position!.label,
          positionId: position?.id ?? null,
          format: category === 'committee' ? 'multiple_choice' : category === 'decision' ? 'single_choice' : (input.format ?? 'single_choice'),
          category,
          memberCount: category === 'committee' ? input.memberCount : null,
          electionSeats: category === 'committee' ? input.memberCount : null,
          decisionFormat: category === 'decision' ? input.decisionFormat : null,
          approvalRule,
          countingRule: { kind: 'automatic', rule: approvalRule },
          options: { create: labels.map((label, order) => ({ label, order })) },
        },
        include: { options: { orderBy: { order: 'asc' } } },
      })
      await recordAudit(tx, { assemblyId, roundId: created.id, action: 'round.prepared' })
      return created
    })
    await this.announceRound(round.id)
    return { id: round.id, title: round.title, format: round.format, category: round.category, memberCount: round.memberCount, electionSeats: round.electionSeats, positionId: round.positionId, ...decisionFields(round), countingRule: round.countingRule, status: round.status, options: round.options }
  }

  /** The puesto a vote fills: its own, or its root's for a runoff or repetition. */
  private async positionIdOf(round: { positionId: string | null; committeeRootRoundId: string | null }) {
    if (!round.committeeRootRoundId) return round.positionId
    return (await this.prisma.round.findUnique({ where: { id: round.committeeRootRoundId }, select: { positionId: true } }))?.positionId ?? null
  }

  /** Phones and projector refetch on round.state. */
  private async announceRound(roundId: string) {
    // Best effort: the action already committed, and clients still poll if the notice is lost.
    try {
      const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { assemblyId: true, status: true, title: true } })
      if (round) this.realtime.roundState(round.assemblyId, { roundId, status: round.status, title: round.title })
    } catch (error) {
      this.logger.warn(`No se pudo anunciar el cambio de la papeleta ${roundId}: ${(error as Error).message}`)
    }
  }

  async openRound(roundId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rounds = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string; committee_root_round_id: string | null; counting_rule: unknown }>>`
        SELECT id, assembly_id, status, committee_root_round_id, counting_rule FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const round = rounds[0]
      if (!round) throw new NotFoundException('Ronda no encontrada')
      if (round.status === 'open') return { roundId: round.id, assemblyId: round.assembly_id, status: 'open' as const, changed: false }
      if (round.status !== 'draft') throw new ConflictException('La ronda no se puede abrir desde su estado actual')
      await lockAssembly(tx, round.assembly_id)
      const assembly = await tx.assembly.findUnique({ where: { id: round.assembly_id }, select: { status: true, presentationActive: true, presentationSlide: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden abrir papeletas')
      if (!assembly || !['lobby_closed', 'in_progress'].includes(assembly.status)) throw new ConflictException('El ingreso debe estar cerrado antes de abrir una papeleta')
      const otherOpen = await tx.round.findFirst({ where: { assemblyId: round.assembly_id, status: 'open' }, select: { id: true } })
      if (otherOpen) throw new ConflictException('Ya hay una papeleta abierta')
      if (await this.pendingElectionOtherThan(tx, round.assembly_id, round.committee_root_round_id ?? round.id)) {
        throw new ConflictException('Otra elección espera su resultado oficial o su anulación')
      }
      const sourceId = runoffSourceOf(round.counting_rule)
      const source = sourceId ? await tx.round.findUnique({ where: { id: sourceId }, select: { id: true, status: true } }) : null
      if (source && waitsForSourceResult(round.status, round.counting_rule, new Map([[source.id, source.status]]))) {
        throw new ConflictException('El resultado de la votación anterior todavía se está preparando')
      }
      if (round.committee_root_round_id && await this.openSeatsOf(tx, round.committee_root_round_id) === 0) {
        throw new ConflictException('Todos los puestos de esta elección ya están ocupados')
      }
      const updated = await tx.round.update({ where: { id: round.id }, data: { status: 'open', openedAt: new Date() }, select: { id: true, assemblyId: true, title: true } })
      await freezeRoundBase(tx, round.assembly_id, round.id)
      if (assembly.status === 'lobby_closed') await tx.assembly.update({ where: { id: round.assembly_id }, data: { status: 'in_progress' } })
      await recordAudit(tx, { assemblyId: round.assembly_id, roundId: round.id, action: 'round.opened' })
      // A forgotten «Presentar oficiales» never covers a live vote: opening one ends it.
      const presentationEnded = assembly.presentationActive
      if (presentationEnded) {
        await tx.assembly.update({ where: { id: round.assembly_id }, data: { presentationActive: false } })
        await recordAudit(tx, { assemblyId: round.assembly_id, roundId: round.id, action: 'presentation.changed', metadata: { active: false, slide: assembly.presentationSlide, reason: 'round.opened' } })
      }
      return { roundId: updated.id, assemblyId: updated.assemblyId, title: updated.title, status: 'open' as const, changed: true, presentationEnded, presentationSlide: assembly.presentationSlide }
    })
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, include: { options: { orderBy: { order: 'asc' } } } })
    const payload = { roundId, status: 'open' as const, title: round!.title }
    if (result.changed) {
      this.realtime.roundState(result.assemblyId, payload)
      this.realtime.roundOpened(result.assemblyId, { ...payload, options: round!.options.map((option) => ({ optionId: option.id, label: option.label })) })
      this.realtime.assemblyState(result.assemblyId, { status: 'in_progress' })
      if (result.presentationEnded) this.realtime.presentationState(result.assemblyId, presentationOf({ presentationActive: false, presentationSlide: result.presentationSlide }))
    }
    return payload
  }

  private async pendingElectionOtherThan(tx: Prisma.TransactionClient, assemblyId: string, rootId: string) {
    const votes = await tx.round.findMany({
      where: { assemblyId, status: { not: 'draft' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, committeeRootRoundId: true },
    })
    const latestByElection = new Map(votes.map((vote) => [vote.committeeRootRoundId ?? vote.id, vote.status]))
    latestByElection.delete(rootId)
    const unsettled = [...latestByElection].filter(([, status]) => status === 'closed' || status === 'published').map(([root]) => root)
    if (!unsettled.length) return false
    const registered = await tx.officialResult.count({ where: { roundId: { in: unsettled }, registeredAt: { not: null } } })
    return registered < unsettled.length
  }

  async closeRound(roundId: string) {
    const round = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assembly_id: string; status: string }>>`
        SELECT id, assembly_id, status FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new NotFoundException('Ronda no encontrada')
      await lockAssembly(tx, current.assembly_id)
      const assembly = await tx.assembly.findUnique({ where: { id: current.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus papeletas')
      if (current.status === 'closed' || current.status === 'published') return { id: current.id, assemblyId: current.assembly_id, status: current.status, changed: false, runoffRoundId: null }
      if (current.status !== 'open') throw new ConflictException('Solo se puede cerrar una papeleta abierta')
      const updated = await tx.round.update({ where: { id: roundId }, data: { status: 'closed', closedAt: new Date() }, select: { id: true, assemblyId: true, status: true } })
      await recordAudit(tx, { assemblyId: current.assembly_id, roundId, action: 'round.closed' })
      await this.unlinkRoundVotes(tx, roundId)
      // Closing computes the result: the elected join the official result and open seats get a runoff draft.
      const runoffRoundId = await this.settleElection(tx, roundId)
      return { ...updated, changed: true, runoffRoundId }
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
      roundBase(this.prisma, round.assemblyId, roundId),
      this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { title: true } }),
    ])
    const payload = { roundId, status: round.status as RoundStatus, title: title.title }
    if (round.changed) {
      this.realtime.roundState(round.assemblyId, payload)
      if (round.status === 'closed') this.realtime.roundClosed(round.assemblyId, roundId)
      this.realtime.participationCount(round.assemblyId, { roundId, recorded, eligible })
    }
    if (!secrecyCleanupPending) await this.showSeparatedResults(round.assemblyId)
    if (round.changed && round.runoffRoundId) await this.announceRound(round.runoffRoundId)
    const status = (await this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { status: true } })).status
    return {
      roundId, status, participation: { recorded, eligible },
      ...(secrecyCleanupPending ? { secrecyCleanupPending: true } : {}),
    }
  }

  private async showSeparatedResults(assemblyId?: string, notify = true) {
    const ready = await this.prisma.round.findMany({
      where: { ...(assemblyId ? { assemblyId } : {}), status: 'closed', votesUnlinkedAt: { not: null }, assembly: { status: { not: 'completed' } } },
      orderBy: { closedAt: 'asc' },
      select: { id: true },
    })
    for (const { id } of ready) {
      const shown = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ assembly_id: string }>>`SELECT assembly_id FROM rounds WHERE id = ${id}::uuid FOR UPDATE`
        if (!rows[0]) return null
        await lockAssembly(tx, rows[0].assembly_id)
        const round = await tx.round.findUniqueOrThrow({ where: { id }, select: { assemblyId: true, status: true, title: true, votesUnlinkedAt: true, committeeRootRoundId: true, assembly: { select: { status: true } } } })
        if (round.status !== 'closed' || !round.votesUnlinkedAt || round.assembly.status === 'completed') return null
        const stillLinked = await tx.round.count({ where: { assemblyId: round.assemblyId, status: { in: [...SETTLED_ROUND_STATUSES] }, votesUnlinkedAt: null } })
        if (stillLinked) return null
        const publishedAt = new Date()
        await tx.round.update({ where: { id }, data: { status: 'published', publishedAt } })
        await tx.officialResult.updateMany({ where: { roundId: round.committeeRootRoundId ?? id }, data: { publishedAt } })
        await recordAudit(tx, { assemblyId: round.assemblyId, roundId: id, actorRef: RESULTS_ENGINE_ACTOR, action: 'round.results_published' })
        return round
      })
      if (!shown || !notify) continue
      this.realtime.roundState(shown.assemblyId, { roundId: id, status: 'published', title: shown.title })
      this.realtime.resultsPublished(shown.assemblyId, { roundId: id, options: await this.publishedResults(id) })
    }
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
      await lockAssembly(tx, round.assembly_id)
      const assembly = await tx.assembly.findUnique({ where: { id: round.assembly_id }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus papeletas')
      if (round.status === 'annulled') return { assemblyId: round.assembly_id, title: round.title, previousStatus: round.status, changed: false }
      // Only the latest vote of an election can be annulled: a later vote was prepared from its result.
      const rootId = round.committee_root_round_id ?? round.id
      if ((await tx.officialResult.findUnique({ where: { roundId: rootId }, select: { registeredAt: true } }))?.registeredAt) {
        throw new ConflictException('El resultado ya está registrado como oficial')
      }
      const chain = await tx.round.findMany({ where: { OR: [{ id: rootId }, { committeeRootRoundId: rootId }] }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, countingRule: true } })
      const later = chain.slice(chain.findIndex((item) => item.id === roundId) + 1)
      const pendingRunoffs = later.filter((item) => item.status === 'draft' && runoffSourceOf(item.countingRule) === roundId)
      if (later.some((item) => item.status !== 'annulled' && !pendingRunoffs.includes(item))) {
        throw new ConflictException('Anula primero la votación posterior de esta elección')
      }
      // Whoever this vote elected leaves the official result, and the runoff it prepared is discarded.
      await tx.officialResultOption.deleteMany({ where: { officialResult: { roundId: rootId }, option: { roundId } } })
      await tx.officialResult.updateMany({ where: { roundId: rootId, settledRoundId: roundId }, data: { settledRoundId: null, approved: null } })
      await tx.officialResult.deleteMany({ where: { roundId: rootId, options: { none: {} } } })
      if (pendingRunoffs.length) {
        await keepRoundTitlesInLog(tx, pendingRunoffs.map((item) => item.id))
        await tx.round.deleteMany({ where: { id: { in: pendingRunoffs.map((item) => item.id) } } })
        await recordAudit(tx, { assemblyId: round.assembly_id, roundId, action: 'round.runoff_discarded', metadata: { runoffRoundIds: pendingRunoffs.map((item) => item.id) } })
      }
      await tx.round.update({
        where: { id: roundId },
        data: { status: 'annulled', annulledAt: new Date(), annulReason: reason.trim(), votesUnlinkedAt: null },
      })
      await tx.anonymousVote.deleteMany({ where: { roundId } })
      await recordAudit(tx, { assemblyId: round.assembly_id, roundId, action: 'round.annulled', metadata: { previousStatus: round.status, reason: reason.trim() } })
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
   * Prepares the same vote again after it was annulled (for example, a misspelled candidate). Results are
   * automatic, so this is the only manual repetition: a runoff is prepared by closing the vote.
   */
  async repeatRound(roundId: string, input: RepeatRoundDto) {
    const optionIds = [...new Set(input.optionIds)]
    if (optionIds.length !== input.optionIds.length) throw new UnprocessableEntityException('No repitas opciones')
    const created = await this.prisma.$transaction(async (tx) => {
      const source = await tx.round.findUnique({ where: { id: roundId }, include: { options: { orderBy: { order: 'asc' } } } })
      if (!source) throw new NotFoundException('Ronda no encontrada')
      await lockAssembly(tx, source.assemblyId)
      const assembly = await tx.assembly.findUnique({ where: { id: source.assemblyId }, select: { status: true } })
      if (assembly?.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se permiten nuevas papeletas')
      if (!['lobby_closed', 'in_progress'].includes(assembly?.status ?? '')) throw new ConflictException('Cierra el ingreso antes de preparar una papeleta')
      if (source.status !== 'annulled') throw new ConflictException('Solo se puede repetir una papeleta anulada; los desempates se preparan solos')
      const rootId = source.committeeRootRoundId ?? source.id
      const later = await tx.round.count({ where: { OR: [{ id: rootId }, { committeeRootRoundId: rootId }], createdAt: { gt: source.createdAt }, status: { not: 'annulled' } } })
      if (later) throw new ConflictException('Esta elección ya tiene una votación posterior')
      const selected = source.options.filter((option) => optionIds.includes(option.id))
      if (selected.length !== optionIds.length) throw new UnprocessableEntityException('Todas las opciones deben pertenecer a la papeleta original')
      const root = source.committeeRootRoundId ? await tx.round.findUniqueOrThrow({ where: { id: rootId }, select: { title: true } }) : source
      const seats = source.category === 'committee' ? (input.seats ?? Math.min(source.electionSeats ?? source.memberCount ?? selected.length, selected.length)) : null
      if (seats !== null && (seats < 1 || seats > selected.length)) throw new UnprocessableEntityException(`Indica entre 1 y ${selected.length} cupos para esta votación`)
      if (source.category !== 'committee' && input.seats !== undefined) throw new UnprocessableEntityException('Los cupos solo aplican a comisiones')
      const round = await tx.round.create({
        data: {
          assemblyId: source.assemblyId,
          title: input.title?.trim() || root.title,
          format: source.format,
          category: source.category,
          memberCount: source.memberCount,
          decisionFormat: source.decisionFormat,
          approvalRule: source.approvalRule,
          committeeRootRoundId: rootId,
          electionSeats: seats,
          regionalSecretaryVotes: source.regionalSecretaryVotes,
          // Repeating an annulled runoff is still that runoff: same label, same rules for new candidates.
          countingRule: { kind: 'count_only', reason: 'repeat', sourceRoundId: source.id, ...(isRunoff(source.countingRule) ? { runoff: true } : {}) },
          options: { create: selected.map((option, order) => ({ label: option.label, order })) },
        },
        include: { options: { orderBy: { order: 'asc' } } },
      })
      await recordAudit(tx, { assemblyId: source.assemblyId, roundId: round.id, action: 'round.repeated', metadata: { sourceRoundId: source.id, optionLabels: selected.map((option) => option.label), seats } })
      return round
    })
    return { id: created.id, title: created.title, status: created.status, committeeRootRoundId: created.committeeRootRoundId, electionSeats: created.electionSeats, options: created.options }
  }

  /**
   * From the 3rd vote of an election on, the mesa may add a new candidate to the runoff draft before
   * opening it; never in the first runoff (Asamblea, Nov 2026). It is optional and marked as new.
   */
  async addCandidate(roundId: string, label: string) {
    const name = label.trim()
    if (!name) throw new UnprocessableEntityException('Escribe el nombre del candidato')
    const added = await this.prisma.$transaction(async (tx) => {
      const round = await this.lockCandidateDraft(tx, roundId)
      const options = await tx.ballotOption.findMany({ where: { roundId }, select: { label: true, order: true } })
      if (options.length >= 40) throw new UnprocessableEntityException('La papeleta admite hasta 40 candidatos')
      const key = name.toLocaleLowerCase('es')
      if (options.some((option) => option.label.toLocaleLowerCase('es') === key)) throw new UnprocessableEntityException('Ese candidato ya está en la papeleta')
      // Someone elected in an earlier vote of this election already holds a seat.
      const elected = await tx.officialResultOption.findMany({ where: { officialResult: { roundId: round.rootId } }, select: { option: { select: { label: true } } } })
      if (elected.some(({ option }) => option.label.toLocaleLowerCase('es') === key)) throw new UnprocessableEntityException('Esa persona ya fue electa en esta elección')
      const option = await tx.ballotOption.create({
        data: { roundId, label: name, order: Math.max(-1, ...options.map((item) => item.order)) + 1, isNew: true },
        select: { id: true, label: true, order: true, isNew: true },
      })
      await recordAudit(tx, { assemblyId: round.assemblyId, roundId, action: 'round.candidate_added', metadata: { optionId: option.id, label: option.label, voteNumber: round.voteNumber } })
      return option
    })
    await this.announceRound(roundId)
    return { roundId, option: added }
  }

  /** Takes back a candidate the mesa added; the candidates the previous vote passed on stay. */
  async removeCandidate(roundId: string, optionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const round = await this.lockCandidateDraft(tx, roundId)
      const option = await tx.ballotOption.findFirst({ where: { id: optionId, roundId }, select: { id: true, label: true, isNew: true } })
      if (!option) throw new NotFoundException('Candidato no encontrado')
      if (!option.isNew) throw new ConflictException('Solo se puede quitar un candidato agregado por la mesa')
      await tx.ballotOption.delete({ where: { id: option.id } })
      await recordAudit(tx, { assemblyId: round.assemblyId, roundId, action: 'round.candidate_removed', metadata: { optionId: option.id, label: option.label, voteNumber: round.voteNumber } })
    })
    await this.announceRound(roundId)
    return { roundId, optionId, removed: true as const }
  }

  /** Locks a runoff draft whose candidates the mesa may change: the 3rd vote of its election or later. */
  private async lockCandidateDraft(tx: Prisma.TransactionClient, roundId: string) {
    const round = await this.lockDraft(tx, roundId, 'Los candidatos solo se cambian antes de abrir la votación')
    // A decision repeats between the options it already had; only an election takes a new candidate.
    if (round.category === 'decision') throw new ConflictException('Solo se agregan candidatos en la elección de un cargo o una comisión')
    if (!round.runoff || round.voteNumber < 3) {
      throw new ConflictException('Solo se puede agregar un candidato a partir de la 3.ª votación')
    }
    return round
  }

  private async lockDraft(tx: Prisma.TransactionClient, roundId: string, notDraftMessage: string) {
    const rows = await tx.$queryRaw<Array<{ assembly_id: string }>>`SELECT assembly_id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`
    if (!rows[0]) throw new NotFoundException('Ronda no encontrada')
    await lockAssembly(tx, rows[0].assembly_id)
    const assembly = await tx.assembly.findUniqueOrThrow({ where: { id: rows[0].assembly_id }, select: { status: true } })
    if (assembly.status === 'completed') throw new ConflictException('La Asamblea ya finalizó; no se pueden modificar sus papeletas')
    const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, select: { id: true, assemblyId: true, status: true, category: true, committeeRootRoundId: true, countingRule: true } })
    if (round.status !== 'draft') throw new ConflictException(notDraftMessage)
    const rootId = round.committeeRootRoundId ?? round.id
    // Counted as chainPosition counts it, so the server agrees with the "N.ª VOTACIÓN" the mesa sees.
    const chain = await tx.round.findMany({ where: { OR: [{ id: rootId }, { committeeRootRoundId: rootId }] }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true } })
    return { assemblyId: round.assemblyId, rootId, category: round.category, runoff: isRunoff(round.countingRule), voteNumber: voteNumberIn(chain, round.id), chain }
  }

  async addRegionalSecretary(roundId: string, input: { firstName: string; lastName: string }) {
    const resumeCode = newOpaqueCredential()
    const expiresAt = new Date(Date.now() + RESUME_CODE_TTL_MS)
    const identity = { firstName: input.firstName.trim(), lastName: input.lastName.trim() }
    const session = { ...identity, status: 'active' as const, votingDisabled: false, resumeCodeHash: hashCredential(resumeCode), resumeExpiresAt: expiresAt }
    const secretary = await this.prisma.$transaction(async (tx) => {
      const round = await this.lockDraft(tx, roundId, 'La secretaría regional solo se agrega antes de abrir la votación')
      if (!round.runoff || round.voteNumber < 4) throw new ConflictException('La secretaría regional se agrega a partir de la 4.ª votación')
      if (!await this.previousVoteTied(tx, round.chain, roundId)) throw new ConflictException('La secretaría regional solo se agrega si la votación anterior terminó en empate')
      const existing = await tx.participantSession.findFirst({ where: { assemblyId: round.assemblyId, isRegionalSecretary: true }, select: { id: true } })
      const person = existing
        ? await tx.participantSession.update({ where: { id: existing.id }, data: { ...session, tokenHash: hashCredential(newOpaqueCredential()) }, select: { id: true, firstName: true, lastName: true } })
        : await tx.participantSession.create({ data: { ...session, assemblyId: round.assemblyId, isRegionalSecretary: true, tokenHash: hashCredential(newOpaqueCredential()) }, select: { id: true, firstName: true, lastName: true } })
      await tx.round.update({ where: { id: roundId }, data: { regionalSecretaryVotes: true } })
      await recordAudit(tx, { assemblyId: round.assemblyId, roundId, action: 'round.regional_secretary_added', metadata: { participantId: person.id, personName: `${person.firstName} ${person.lastName}`, voteNumber: round.voteNumber } })
      return { ...person, replaced: Boolean(existing) }
    })
    if (secretary.replaced) this.realtime.participantSessionReplaced(secretary.id)
    await this.announceRound(roundId)
    return { participantId: secretary.id, name: `${identity.firstName} ${identity.lastName}`, resumeUrl: appUrl({ resume: resumeCode }), expiresAt: expiresAt.toISOString() }
  }

  async removeRegionalSecretary(roundId: string) {
    await this.prisma.$transaction(async (tx) => {
      const round = await this.lockDraft(tx, roundId, 'La secretaría regional solo se quita antes de abrir la votación')
      await tx.round.update({ where: { id: roundId }, data: { regionalSecretaryVotes: false } })
      await recordAudit(tx, { assemblyId: round.assemblyId, roundId, action: 'round.regional_secretary_removed', metadata: { voteNumber: round.voteNumber } })
    })
    await this.announceRound(roundId)
    return { roundId, removed: true as const }
  }

  private async previousVoteTied(tx: Prisma.TransactionClient, chain: Array<{ id: string; status: string }>, roundId: string) {
    const earlier = chain.slice(0, chain.findIndex((item) => item.id === roundId))
    const previous = earlier.filter((item) => (SETTLED_ROUND_STATUSES as readonly string[]).includes(item.status) && item.status !== 'annulled').at(-1)
    if (!previous) return false
    const round = await tx.round.findUniqueOrThrow({ where: { id: previous.id }, include: { options: { select: { id: true } } } })
    const counts = await tx.anonymousVote.groupBy({ by: ['optionId'], where: { roundId: previous.id }, _count: { _all: true } })
    const countOf = new Map(counts.map((row) => [row.optionId, row._count._all]))
    return tiedAtCut(round.options.map((option) => ({ optionId: option.id, count: countOf.get(option.id) ?? 0 })), seatsOf(round))
  }

  /** Which vote of its election a round is (1 for the first) and whether it is a runoff. */
  private async chainPosition(round: { id: string; committeeRootRoundId: string | null; countingRule: unknown }) {
    const rootId = round.committeeRootRoundId ?? round.id
    const chain = await this.prisma.round.findMany({ where: { OR: [{ id: rootId }, { committeeRootRoundId: rootId }] }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true } })
    return { voteNumber: voteNumberIn(chain, round.id), runoff: isRunoff(round.countingRule) }
  }

  /**
   * Runs the results engine on a vote that just closed. The elected join the official result of the
   * election (kept on its first vote); if seats remain open, the runoff is prepared as a draft among
   * the candidates that pass, for exactly the open seats. Returns the runoff's id, if any.
   */
  private async settleElection(tx: Prisma.TransactionClient, roundId: string) {
    const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { options: { orderBy: { order: 'asc' } } } })
    const counts = await tx.anonymousVote.groupBy({ by: ['optionId'], where: { roundId }, _count: { _all: true } })
    const outcome = outcomeOf(round, counts.map((row) => ({ optionId: row.optionId, count: row._count._all })), round.eligibleCount ?? 0)
    const rootId = round.committeeRootRoundId ?? round.id
    const labelOf = new Map(round.options.map((option) => [option.id, option.label]))
    const now = new Date()
    const settles = outcome.openSeats === 0
    if (outcome.elected.length || settles) {
      const seatsTaken = await tx.officialResultOption.count({ where: { officialResult: { roundId: rootId } } })
      const seats = outcome.elected.map((optionId, index) => ({ optionId, seatOrder: seatsTaken + index }))
      const settlement = settles ? { settledRoundId: roundId, approved: 'approved' in outcome ? outcome.approved : null } : {}
      await tx.officialResult.upsert({
        where: { roundId: rootId },
        create: { roundId: rootId, actorRef: RESULTS_ENGINE_ACTOR, declaredAt: now, ...settlement, options: { create: seats } },
        update: { actorRef: RESULTS_ENGINE_ACTOR, declaredAt: now, ...settlement, options: { create: seats } },
      })
    }
    const rootTitle = round.committeeRootRoundId ? (await tx.round.findUniqueOrThrow({ where: { id: rootId }, select: { title: true } })).title : round.title
    const runoff = outcome.openSeats > 0 && outcome.runoff.length
      ? await tx.round.create({
          data: {
            assemblyId: round.assemblyId,
            title: rootTitle,
            format: round.format,
            category: round.category,
            memberCount: round.memberCount,
            // A decision with options repeats under the same rule until one option reaches it.
            decisionFormat: round.decisionFormat,
            approvalRule: round.approvalRule,
            committeeRootRoundId: rootId,
            electionSeats: round.category === 'committee' ? outcome.openSeats : null,
            regionalSecretaryVotes: round.regionalSecretaryVotes,
            countingRule: { kind: 'count_only', reason: 'runoff', sourceRoundId: round.id },
            // Ballot order, not rank order, so the runoff ballot does not favor the most voted.
            options: { create: round.options.filter((option) => outcome.runoff.includes(option.id)).map((option, order) => ({ label: option.label, order })) },
          },
          select: { id: true },
        })
      : null
    await recordAudit(tx, {
      assemblyId: round.assemblyId, roundId, actorRef: RESULTS_ENGINE_ACTOR, action: 'round.result_computed', occurredAt: now,
      metadata: {
        base: outcome.base, threshold: outcome.threshold, seats: outcome.seats, openSeats: outcome.openSeats,
        electedLabels: outcome.elected.map((id) => labelOf.get(id) ?? id), runoffLabels: outcome.runoff.map((id) => labelOf.get(id) ?? id),
        runoffRoundId: runoff?.id ?? null,
        ...('approved' in outcome ? { rule: outcome.rule, approved: outcome.approved } : {}),
      },
    })
    return runoff?.id ?? null
  }

  /** Seats of the election still open: its size minus everyone elected in any of its votes. */
  private async openSeatsOf(tx: Prisma.TransactionClient, rootRoundId: string) {
    const root = await tx.round.findUniqueOrThrow({ where: { id: rootRoundId }, select: { category: true, memberCount: true, electionSeats: true } })
    const elected = await tx.officialResultOption.count({ where: { officialResult: { roundId: rootRoundId } } })
    return Math.max(0, seatsOf(root) - elected)
  }

  private serializeOfficialResult(result: {
    roundId: string; note: string | null; actorRef: string; declaredAt: Date; publishedAt: Date | null;
    options: Array<{ optionId: string; option: { label: string; roundId: string } }>
  }) {
    return {
      roundId: result.roundId,
      elected: result.options.map(({ optionId, option }) => ({ optionId, label: option.label, roundId: option.roundId })),
      note: result.note,
      declaredBy: result.actorRef,
      declaredAt: result.declaredAt.toISOString(),
      publishedAt: result.publishedAt?.toISOString() ?? null,
    }
  }

  private async resultSummary(roundId: string, runoff: string[]): Promise<{
    final?: { elected: Array<{ optionId: string; label: string }>; approved: boolean | null }
    continuing?: Array<{ optionId: string; label: string }>
  }> {
    const round = await this.prisma.round.findUniqueOrThrow({ where: { id: roundId }, select: { committeeRootRoundId: true, options: { select: { id: true, label: true }, orderBy: { order: 'asc' } } } })
    const result = await this.prisma.officialResult.findUnique({
      where: { roundId: round.committeeRootRoundId ?? roundId },
      select: { settledRoundId: true, approved: true, options: { orderBy: { seatOrder: 'asc' }, select: { optionId: true, option: { select: { label: true } } } } },
    })
    if (result?.settledRoundId === roundId) {
      return { final: { elected: result.options.map(({ optionId, option }) => ({ optionId, label: option.label })), approved: result.approved } }
    }
    return { continuing: round.options.filter((option) => runoff.includes(option.id)).map((option) => ({ optionId: option.id, label: option.label })) }
  }

  private async moderatorSummary<T extends { runoff: string[] }>(roundId: string, outcome: T) {
    const summary = await this.resultSummary(roundId, outcome.runoff)
    return { outcome, final: Boolean(summary.final), ...(summary.continuing ? { continuing: summary.continuing } : {}) }
  }

  private async moderatorOfficialResult(roundId: string) {
    const result = await this.prisma.officialResult.findUnique({
      where: { roundId }, include: { settledRound: { select: { status: true } }, options: { where: { option: { round: { status: 'published' } } }, orderBy: { seatOrder: 'asc' }, include: { option: { select: { label: true, roundId: true } } } } },
    })
    const settled = result?.settledRound?.status === 'published'
    if (!result || (!result.options.length && !settled)) return null
    return {
      ...this.serializeOfficialResult(result),
      settledRoundId: settled ? result.settledRoundId : null,
      approved: settled ? result.approved : null,
      registeredAt: result.registeredAt?.toISOString() ?? null,
    }
  }

  private async publishedOfficialResult(roundId: string) {
    const result = await this.prisma.officialResult.findUnique({
      where: { roundId },
      include: { options: { where: { option: { round: { status: 'published' } } }, orderBy: { seatOrder: 'asc' }, include: { option: { select: { label: true, roundId: true } } } } },
    })
    if (!result?.options.length) return null
    const serialized = this.serializeOfficialResult(result)
    return { elected: serialized.elected.map(({ optionId, label }) => ({ optionId, label })), note: serialized.note, declaredAt: serialized.declaredAt }
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
   * repeated votes that are never published on their own. Safe to repeat: shuffling again
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

  async openRoundBase(assemblyId: string) {
    const round = await this.prisma.round.findFirst({ where: { assemblyId, status: 'open' }, select: { id: true, regionalSecretaryVotes: true } })
    if (!round) return null
    return { roundId: round.id, participantIds: baseOf(round, await basePeople(this.prisma, assemblyId)) }
  }

  private async announceParticipationCount(assemblyId: string, roundId: string) {
    const [recorded, eligible] = await Promise.all([
      this.prisma.participation.count({ where: { roundId } }),
      roundBase(this.prisma, assemblyId, roundId),
    ])
    this.realtime.participationCount(assemblyId, { roundId, recorded, eligible })
  }

  private async publishedResults(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { status: true } })
    if (!round || round.status !== 'published') throw new NotFoundException('Resultados no publicados')
    return this.rankedCounts(roundId)
  }

  /** Counts per option for any round; callers decide who may see them. */
  private async rankedCounts(roundId: string) {
    const [options, counts] = await Promise.all([
      this.prisma.ballotOption.findMany({ where: { roundId }, orderBy: { order: 'asc' }, select: { id: true, label: true } }),
      this.prisma.anonymousVote.groupBy({ by: ['optionId'], where: { roundId }, _count: { _all: true } }),
    ])
    const countByOption = new Map(counts.map((row) => [row.optionId, row._count._all]))
    // Ranked by votes; ties keep ballot order.
    return options
      .map((option) => ({ optionId: option.id, label: option.label, count: countByOption.get(option.id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
  }
}
