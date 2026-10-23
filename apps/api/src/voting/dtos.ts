import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayMinSize,
  Equals,
  IsArray,
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
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(200)
  title!: string

  @IsOptional() @IsIn(['single_choice', 'multiple_choice'])
  format: 'single_choice' | 'multiple_choice' = 'single_choice'

  @IsOptional() @IsIn(['office', 'committee'])
  category?: 'office' | 'committee'

  /** Committee only: how many people stay on it; each delegate marks from one up to this many names. */
  @IsOptional() @IsInt() @Min(1) @Max(40)
  memberCount?: number

  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => BallotOptionDto)
  options?: BallotOptionDto[]

  @IsObject()
  countingRule!: Record<string, unknown>
}

export class VoteDto {
  @IsOptional() @IsUUID()
  optionId?: string

  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(40) @IsUUID('all', { each: true })
  optionIds?: string[]

  @Equals(true)
  confirmation!: true
}

export class OfficialResultDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @IsUUID('all', { each: true })
  optionIds!: string[]

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string
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

export class RouteIdDto {
  @IsInt() @Min(1)
  id!: number
}
