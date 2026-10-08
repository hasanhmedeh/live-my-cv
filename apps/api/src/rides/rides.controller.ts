import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ParseLimitPipe } from '../common/parse-limit.pipe.js';
import type { Attraction, User } from '../generated/prisma/client.js';
import { FinishRoundDto } from './dto/finish-round.dto.js';
import { ParseRidePipe } from './parse-ride.pipe.js';
import type { RoundJson } from './round-json.js';
import { RidesService, type BoardResult, type FinishResult, type RefundResult, type RideStats } from './rides.service.js';

/** Every attraction needs an account and tickets: guests are turned away here with a 401. */
@Controller('rides')
@UseGuards(SessionGuard)
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  /**
   * Spends the attraction's tickets and opens a round, or answers 402 when the balance is short, and
   * 503 (code park_closed or ride_closed) while the park or the attraction is closed.
   */
  @Post(':ride/board')
  board(@CurrentUser() user: User, @Param('ride', ParseRidePipe) ride: Attraction): Promise<BoardResult> {
    return this.rides.board(user, ride);
  }

  @Post('rounds/:id/finish')
  @HttpCode(HttpStatus.OK)
  finish(@CurrentUser() user: User, @Param('id') id: string, @Body() body: FinishRoundDto): Promise<FinishResult> {
    return this.rides.finish(user.id, id, body);
  }

  /**
   * Ends a round whose attraction (or the park) closed while it was played, and gives its tickets
   * back. 409 if it's open again (finish the round instead), already over, or the caller is staff.
   */
  @Post('rounds/:id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@CurrentUser() user: User, @Param('id') id: string): Promise<RefundResult> {
    return this.rides.refund(user, id);
  }

  @Get('stats')
  stats(@CurrentUser() user: User): Promise<RideStats> {
    return this.rides.stats(user.id);
  }

  @Get('history')
  history(
    @CurrentUser() user: User,
    @Query('limit', new ParseLimitPipe(20, 100)) limit: number,
  ): Promise<{ rounds: RoundJson[] }> {
    return this.rides.history(user.id, limit);
  }
}
