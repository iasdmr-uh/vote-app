import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { PARTICIPANT_ID } from '../auth/auth.service.js'
import { ModeratorGuard, ParticipantGuard, ParticipantSessionGuard } from '../auth/auth.guards.js'
import { VotingService } from './voting.service.js'
import { PresentationService } from './presentation.service.js'
import { ConnectionCountService } from './connection-count.service.js'
import { CONNECTION_GRACE_MS } from '../realtime/connection-timing.js'
import {
  AddPositionDto,
  AnnulRoundDto,
  BallotOptionDto,
  CreateAssemblyDto,
  CompleteAssemblyDto,
  CreateRoundDto,
  JoinAssemblyDto,
  LobbyPatchDto,
  ParticipantPatchDto,
  PresentationDto,
  RepeatRoundDto,
  ResumeSessionDto,
  VoteDto,
} from './dtos.js'

type SessionRequest = Request & { [PARTICIPANT_ID]?: string }

function sessionId(request: SessionRequest): string {
  if (!request[PARTICIPANT_ID]) throw new Error('Participant guard did not attach the session identity')
  return request[PARTICIPANT_ID]
}

function withConnection<T extends object>(state: T, connection: Awaited<ReturnType<ConnectionCountService['current']>>) {
  return connection ? { ...state, connection } : state
}

@Controller('assemblies')
export class PublicAssemblyController {
  constructor(private readonly voting: VotingService, private readonly connections: ConnectionCountService) {}

  @Post('resume')
  async resume(@Body() input: ResumeSessionDto) {
    return { ...await this.voting.redeemResumeCode(input.resumeCode), connectionGraceMs: CONNECTION_GRACE_MS }
  }

  @Post(':assemblyCode/join')
  async join(@Param('assemblyCode') assemblyCode: string, @Body() input: JoinAssemblyDto) {
    return { ...await this.voting.joinAssembly(assemblyCode, input.firstName, input.lastName), connectionGraceMs: CONNECTION_GRACE_MS }
  }

  @Get(':assemblyCode/public-state')
  async publicState(@Param('assemblyCode') assemblyCode: string) {
    const state = await this.voting.publicState(assemblyCode)
    return withConnection(state, await this.connections.current(state.assembly.id))
  }
}

@Controller('participant')
@UseGuards(ParticipantGuard)
export class ParticipantController {
  constructor(private readonly voting: VotingService) {}

  @Get('me')
  async me(@Req() request: SessionRequest) {
    return { ...await this.voting.participantState(sessionId(request)), connectionGraceMs: CONNECTION_GRACE_MS }
  }

  @Post('rounds/:roundId/vote')
  vote(@Req() request: SessionRequest, @Param('roundId', ParseUUIDPipe) roundId: string, @Body() input: VoteDto) {
    return this.voting.castVote(sessionId(request), roundId, input.optionIds ?? input.optionId ?? '')
  }
}

@Controller('participant')
@UseGuards(ParticipantSessionGuard)
export class ParticipantLeaveController {
  constructor(private readonly voting: VotingService) {}

  @Post('leave')
  @HttpCode(200)
  leave() {
    throw new ForbiddenException('Solo la mesa puede retirar a una persona de la sala')
  }
}

@Controller('moderator')
@UseGuards(ModeratorGuard)
export class ModeratorController {
  constructor(
    private readonly voting: VotingService,
    private readonly presentation: PresentationService,
    private readonly connections: ConnectionCountService,
  ) {}

  @Get('session')
  session() {
    return { authenticated: true }
  }

  @Post('assemblies')
  createAssembly(@Body() input: CreateAssemblyDto) {
    return this.voting.createAssembly(input.name, input.period)
  }

  @Post('positions')
  addPosition(@Body() input: AddPositionDto) {
    return this.voting.addPosition(input.assemblyId, input.label)
  }

  // Declared before 'assemblies/:assemblyId' so that route does not capture "active".
  @Get('assemblies/active')
  activeAssembly() {
    return this.voting.activeAssembly()
  }

  @Post('assemblies/:assemblyId/join-code')
  rotateJoinCode(@Param('assemblyId', ParseUUIDPipe) assemblyId: string) {
    return this.voting.rotateJoinCode(assemblyId)
  }

  @Post('presentation')
  @HttpCode(200)
  setPresentation(@Body() input: PresentationDto) {
    return this.presentation.setPresentation(input)
  }

  @Get('assemblies/:assemblyId')
  async assembly(@Param('assemblyId', ParseUUIDPipe) assemblyId: string) {
    const [state, connection] = await Promise.all([this.voting.moderatorAssembly(assemblyId), this.connections.current(assemblyId)])
    return withConnection(state, connection)
  }

  @Patch('assemblies/:assemblyId/lobby')
  lobby(@Param('assemblyId', ParseUUIDPipe) assemblyId: string, @Body() input: LobbyPatchDto) {
    return this.voting.changeLobby(assemblyId, input.status)
  }

  @Post('assemblies/:assemblyId/secrecy-cleanup')
  secrecyCleanup(@Param('assemblyId', ParseUUIDPipe) assemblyId: string) {
    return this.voting.retrySecrecyCleanup(assemblyId)
  }

  @Post('assemblies/:assemblyId/complete')
  completeAssembly(@Param('assemblyId', ParseUUIDPipe) assemblyId: string, @Body() input: CompleteAssemblyDto) {
    return this.voting.completeAssembly(assemblyId, input.confirmation)
  }

  @Delete('assemblies/:assemblyId')
  deleteAssemblyData(@Param('assemblyId', ParseUUIDPipe) assemblyId: string, @Body() input: CompleteAssemblyDto) {
    return this.voting.deleteAssemblyData(assemblyId, input.confirmation)
  }

  @Patch('participants/:participantId')
  participant(@Param('participantId', ParseUUIDPipe) participantId: string, @Body() input: ParticipantPatchDto) {
    return this.voting.patchParticipant(participantId, input)
  }

  @Post('participants/:participantId/disable-voting')
  @HttpCode(200)
  disableVoting(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.voting.setVotingDisabled(participantId, true)
  }

  @Post('participants/:participantId/enable-voting')
  @HttpCode(200)
  enableVoting(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.voting.setVotingDisabled(participantId, false)
  }

  @Post('participants/:participantId/take-out')
  @HttpCode(200)
  takeOut(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.voting.takeOutOfRoom(participantId)
  }

  @Post('participants/:participantId/return')
  @HttpCode(200)
  returnToRoom(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.voting.returnToRoom(participantId)
  }

  @Post('participants/:participantId/resume-code')
  participantResumeCode(@Param('participantId', ParseUUIDPipe) participantId: string) {
    return this.voting.issueResumeCode(participantId)
  }

  @Post('assemblies/:assemblyId/rounds')
  createRound(@Param('assemblyId', ParseUUIDPipe) assemblyId: string, @Body() input: CreateRoundDto) {
    return this.voting.createRound(assemblyId, input)
  }

  @Post('rounds/:roundId/open')
  openRound(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.voting.openRound(roundId)
  }

  @Post('rounds/:roundId/close')
  closeRound(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.voting.closeRound(roundId)
  }

  @Post('rounds/:roundId/publish')
  publishRound(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.voting.publishRound(roundId)
  }

  @Post('rounds/:roundId/annul')
  annulRound(@Param('roundId', ParseUUIDPipe) roundId: string, @Body() input: AnnulRoundDto) {
    return this.voting.annulRound(roundId, input.reason)
  }

  @Post('rounds/:roundId/candidates')
  addCandidate(@Param('roundId', ParseUUIDPipe) roundId: string, @Body() input: BallotOptionDto) {
    return this.voting.addCandidate(roundId, input.label)
  }

  @Delete('rounds/:roundId/candidates/:optionId')
  removeCandidate(@Param('roundId', ParseUUIDPipe) roundId: string, @Param('optionId', ParseUUIDPipe) optionId: string) {
    return this.voting.removeCandidate(roundId, optionId)
  }

  @Post('rounds/:roundId/regional-secretary')
  addRegionalSecretary(@Param('roundId', ParseUUIDPipe) roundId: string, @Body() input: JoinAssemblyDto) {
    return this.voting.addRegionalSecretary(roundId, input)
  }

  @Delete('rounds/:roundId/regional-secretary')
  removeRegionalSecretary(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.voting.removeRegionalSecretary(roundId)
  }

  @Post('rounds/:roundId/repeat')
  repeatRound(@Param('roundId', ParseUUIDPipe) roundId: string, @Body() input: RepeatRoundDto) {
    return this.voting.repeatRound(roundId, input)
  }
}
