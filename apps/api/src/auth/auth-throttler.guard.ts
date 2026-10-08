import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

const LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * Rate limit for the routes that take a password (signup, login, account deletion): 10 requests
 * a minute per IP, counted separately for each route. A fixed window held in memory, so on
 * serverless each instance counts on its own. (In place of @nestjs/throttler, which is CommonJS
 * and can't load Nest 12's ESM-only packages on every runtime.)
 */
@Injectable()
export class AuthThrottlerGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const now = Date.now();
    this.sweep(now);

    const key = `${context.getClass().name}.${context.getHandler().name}:${req.ip ?? 'unknown'}`;
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      this.hits.set(key, entry);
    }
    entry.count++;

    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('X-RateLimit-Limit', LIMIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, LIMIT - entry.count));
    res.setHeader('X-RateLimit-Reset', resetSeconds);
    if (entry.count <= LIMIT) return true;

    res.setHeader('Retry-After', resetSeconds);
    throw new HttpException(
      HttpException.createBody('Too many attempts. Wait a minute and try again.', 'Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Drops expired windows now and then, so the map can't grow without bound. */
  private sweep(now: number) {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
