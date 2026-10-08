import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClientIp } from '../access/access.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { LiveService, type Presence } from './live.service.js';

/** A game tab's own id: a random UUID it makes up when it loads. */
const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * GET /api/live: live updates, as Server-Sent Events. Guests hear about the park; a signed-in
 * member also hears about their own account, and staff about what's going on. A game tab passes
 * `?visitor=<its id>&in=1|0` (past the entrance or not) to be counted as a visitor; the office
 * passes nothing. See LiveService.
 */
@Controller('live')
export class LiveController {
  constructor(
    private readonly live: LiveService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query('visitor') visitor: unknown,
    @Query('in') inFair: unknown,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    // an expired session just listens as a guest; the game's own requests sort the cookie out
    const user = typeof token === 'string' && token ? await this.auth.userFromToken(token) : null;
    const presence: Presence | null = typeof visitor === 'string' && VISITOR_ID.test(visitor) ? { visitor, inFair: inFair === '1' } : null;
    await this.live.open(res, user, ip, presence);
  }
}
