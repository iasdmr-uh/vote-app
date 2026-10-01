import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService, PARTICIPANT_ID, bearerToken } from './auth.service.js'

type AuthenticatedRequest = Request & { [PARTICIPANT_ID]?: string }

@Injectable()
export class ModeratorGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<Request>()
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

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()
  private readonly windowMs = 60_000
  private readonly maximum = 1000
  private checks = 0

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<Request>()
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs }
      this.buckets.set(key, bucket)
    }
    bucket.count += 1
    this.checks += 1
    if (this.checks % 1000 === 0) {
      for (const [ip, entry] of this.buckets) if (entry.resetAt <= now) this.buckets.delete(ip)
    }
    if (bucket.count > this.maximum) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)
    }
    return true
  }
}
