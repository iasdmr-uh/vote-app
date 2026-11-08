import { Type } from 'class-transformer'
import { LOG_PURPOSES, type LogPurpose } from './operator-log.js'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class CreateAssemblyDto {
  @IsString() @Matches(/\S/) @MinLength(2) @MaxLength(160)
  name!: string

  /** Term the elected serve, e.g. "2027–2029". */
  @IsOptional() @IsString() @MaxLength(60)
  period?: string
}

export class AddPositionDto {
  @IsUUID()
  assemblyId!: string

  /** Checked by the service, so an empty name answers 422 like a duplicate. */
  @IsString() @MaxLength(160)
  label!: string
}

export class JoinAssemblyDto {
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(80)
  firstName!: string

  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(100)
  lastName!: string
}

export class LobbyPatchDto {
  @IsIn(['lobby_open', 'lobby_closed'])
  status!: 'lobby_open' | 'lobby_closed'
}

export class ResumeSessionDto {
  @IsString() @MinLength(20) @MaxLength(100)
  resumeCode!: string
}

export class LogDownloadDto {
  @IsIn(LOG_PURPOSES)
  purpose!: LogPurpose
}

export class CompleteAssemblyDto {
  @Equals(true)
  confirmation!: true
}

export class ParticipantPatchDto {
  @IsOptional() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(80)
  firstName?: string

  @IsOptional() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(100)
  lastName?: string

  @IsOptional() @Equals('removed')
  status?: 'removed'
}

export class BallotOptionDto {
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(160)
  label!: string
}

export class CreateRoundDto {
  /** Optional only for a cargo with a puesto, which takes the puesto's name. */
  @IsOptional() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(200)
  title?: string

  /** Office only: the org-chart puesto this election fills. */
  @IsOptional() @IsUUID()
  positionId?: string

  @IsOptional() @IsIn(['single_choice', 'multiple_choice'])
  format: 'single_choice' | 'multiple_choice' = 'single_choice'

  @IsOptional() @IsIn(['office', 'committee', 'decision'])
  category?: 'office' | 'committee' | 'decision'

  /** Committee only: how many people stay on it; each delegate marks exactly this many names. */
  @IsOptional() @IsInt() @Min(1) @Max(40)
  memberCount?: number

  /** Decision only: A favor / En contra (the server writes both options) or options written by the mesa. */
  @IsOptional() @IsIn(['boolean', 'options'])
  decisionFormat?: 'boolean' | 'options'

  /** Decision only: mayoría simple (> 1/2) or 3/4 of the habilitados. Elections always use mayoría simple. */
  @IsOptional() @IsIn(['simple', 'three_quarters'])
  approvalRule?: 'simple' | 'three_quarters'

  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => BallotOptionDto)
  options?: BallotOptionDto[]

  /** Kept for older clients; the result is always computed by the server, so its content is not used. */
  @IsOptional() @IsObject()
  countingRule?: Record<string, unknown>
}

export class VoteDto {
  @IsOptional() @IsUUID()
  optionId?: string

  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(40) @IsUUID('all', { each: true })
  optionIds?: string[]

  @Equals(true)
  confirmation!: true
}

export class AnnulRoundDto {
  @IsString() @Matches(/\S/) @MaxLength(1000)
  reason!: string
}

export class RepeatRoundDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @IsUUID('all', { each: true })
  optionIds!: string[]

  @IsOptional() @IsInt() @Min(1)
  seats?: number

  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(200)
  title?: string
}

/** «Presentar oficiales» (#48): on or off, and the slide the projector shows. */
export class PresentationDto {
  @IsBoolean()
  active!: boolean

  @IsInt() @IsIn([0, 1, 2])
  slide!: 0 | 1 | 2

  /** The mesa's assembly; without it, the live one. */
  @IsOptional() @IsUUID()
  assemblyId?: string
}

export class RouteIdDto {
  @IsInt() @Min(1)
  id!: number
}
