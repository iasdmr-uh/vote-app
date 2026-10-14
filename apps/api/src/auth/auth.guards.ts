import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService, PARTICIPANT_ID, bearerToken } from './auth.service.js'
import { hashCredential } from './credentials.js'
import { isModeratorChannelAllowed } from '../config/moderator-channel.js'

type AuthenticatedRequest = Request & { [PARTICIPANT_ID]?: string }

@Injectable()
export class ModeratorGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<Request>()
    // Same answer as a wrong token, so the Wi-Fi learns nothing about the moderator routes.
    if (!isModeratorChannelAllowed(request.headers)) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)
    if (!this.auth.verifyModeratorToken(bearerToken(request.headers.authorization))) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)
    }
    return true
  }
}

@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    request[PARTICIPANT_ID] = await this.auth.participantForToken(bearerToken(request.headers.authorization))
    return true
  }
}

/**
 * Delegates on venue Wi-Fi share one public IP, so a per-IP limit alone would throttle the whole room.
 * Each bearer token gets its own bucket, and a higher per-IP ceiling stops random tokens from bypassing it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()
  private readonly windowMs = 60_000
  private readonly tokenMaximum = 1000
  private readonly ipMaximum = 6000
  private checks = 0

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<Request>()
    const now = Date.now()
    this.checks += 1
    if (this.checks % 1000 === 0) {
      for (const [key, entry] of this.buckets) if (entry.resetAt <= now) this.buckets.delete(key)
    }
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown'
    const token = bearerToken(request.headers.authorization)
    const overIpLimit = this.hit(`ip:${ip}`, now) > this.ipMaximum
    const sessionKey = token ? `token:${hashCredential(token)}` : `anonymous:${ip}`
    const overTokenLimit = this.hit(sessionKey, now) > this.tokenMaximum
    if (overIpLimit || overTokenLimit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)
    }
    return true
  }

  private hit(key: string, now: number): number {
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs }
      this.buckets.set(key, bucket)
    }
    bucket.count += 1
    return bucket.count
  }
}
