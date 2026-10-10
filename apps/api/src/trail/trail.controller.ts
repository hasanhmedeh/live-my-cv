import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { TrailService, type TrailBoardJson } from './trail.service.js';

/** The Rally Trail's leaderboard. Anyone can look; a signed-in member also hears where they stand. */
@Controller('trail')
export class TrailController {
  constructor(
    private readonly trail: TrailService,
    private readonly auth: AuthService,
  ) {}

  /** Today's board (noon to noon, Beirut time): the top ten, and the caller's own place on it. */
  @Get('leaderboard')
  async leaderboard(@Req() req: Request): Promise<TrailBoardJson> {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    // an expired session just looks as a guest; the game's own requests sort the cookie out
    const user = typeof token === 'string' && token ? await this.auth.userFromToken(token) : null;
    return this.trail.board(user?.id ?? null);
  }
}
