import {
  Body,
  Controller,
  Delete,
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

@Controller('assemblies')
export class PublicAssemblyController {
  constructor(private readonly voting: VotingService) {}

  @Post('resume')
  resume(@Body() input: ResumeSessionDto) {
    return this.voting.redeemResumeCode(input.resumeCode)
  }

  @Post(':assemblyCode/join')
  join(@Param('assemblyCode') assemblyCode: string, @Body() input: JoinAssemblyDto) {
    return this.voting.joinAssembly(assemblyCode, input.firstName, input.lastName)
  }

  @Get(':assemblyCode/public-state')
  publicState(@Param('assemblyCode') assemblyCode: string) {
    return this.voting.publicState(assemblyCode)
  }
}

@Controller('participant')
@UseGuards(ParticipantGuard)
export class ParticipantController {
  constructor(private readonly voting: VotingService) {}

  @Get('me')
  me(@Req() request: SessionRequest) {
    return this.voting.participantState(sessionId(request))
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
  leave(@Req() request: SessionRequest) {
    return this.voting.leaveAssembly(sessionId(request))
  }
}

@Controller('moderator')
@UseGuards(ModeratorGuard)
export class ModeratorController {
  constructor(private readonly voting: VotingService, private readonly presentation: PresentationService) {}

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
  assembly(@Param('assemblyId', ParseUUIDPipe) assemblyId: string) {
    return this.voting.moderatorAssembly(assemblyId)
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
