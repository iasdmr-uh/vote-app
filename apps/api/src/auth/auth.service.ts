import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { hashCredential, matchesSecret } from './credentials.js'
import {
  REALTIME_AUTHORIZER,
  type RealtimeAuthorizer,
  type RealtimeCredentials,
  type RealtimeIdentity,
} from '../realtime/realtime.types.js'

export const PARTICIPANT_ID = Symbol('PARTICIPANT_ID')
export const MODERATOR_ACTOR = 'shared_moderator_credential'

@Injectable()
export class RealtimeAuthService implements RealtimeAuthorizer {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(credentials: RealtimeCredentials): Promise<RealtimeIdentity> {
    if (credentials.audience === 'public') {
      const assembly = await this.prisma.assembly.findUnique({
        where: { joinCodeHash: hashCredential(credentials.assemblyCode) },
        select: { id: true },
      })
      if (assembly) return { audience: 'public', assemblyId: assembly.id }
      throw new UnauthorizedException()
    }
    if (credentials.audience === 'participant') {
      const participant = await this.prisma.participantSession.findUnique({
        where: { tokenHash: hashCredential(credentials.participantSessionToken) },
        select: { id: true, assemblyId: true, status: true },
      })
      if (participant?.status === 'active') {
        return { audience: 'participant', assemblyId: participant.assemblyId, sessionId: participant.id }
      }
      throw new UnauthorizedException()
    }
    if (credentials.audience === 'moderator' && matchesSecret(credentials.moderatorCredential, process.env.MODERATOR_ACCESS_TOKEN)) {
      const assembly = await this.prisma.assembly.findUnique({
        where: { id: credentials.assemblyId },
        select: { id: true },
      })
      if (assembly) return { audience: 'moderator', assemblyId: assembly.id, moderatorId: MODERATOR_ACTOR }
    }
    throw new UnauthorizedException()
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  verifyModeratorToken(token: string | undefined): boolean {
    return matchesSecret(token ?? '', process.env.MODERATOR_ACCESS_TOKEN)
  }

  async participantForToken(token: string | undefined): Promise<string> {
    if (!token) throw new UnauthorizedException()
    const participant = await this.prisma.participantSession.findUnique({
      where: { tokenHash: hashCredential(token) },
      select: { id: true, status: true },
    })
    if (!participant || participant.status !== 'active') throw new UnauthorizedException()
    return participant.id
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1]
}
