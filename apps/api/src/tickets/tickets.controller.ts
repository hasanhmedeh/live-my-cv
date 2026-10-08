import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ParseLimitPipe } from '../common/parse-limit.pipe.js';
import type { User } from '../generated/prisma/client.js';
import type { PurchaseJson } from './purchase-json.js';
import { TicketsService, type PurchaseResult, type TicketStatus } from './tickets.service.js';

/** The Ticket Booth. Tickets belong to an account, so every route needs a session. */
@Controller('tickets')
@UseGuards(SessionGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  status(@CurrentUser() user: User): Promise<TicketStatus> {
    return this.tickets.status(user);
  }

  /** One pack, added to the balance. 409 with nextPurchaseAt during the cooldown, 503 park_closed while the park is closed. */
  @Post('purchase')
  purchase(@CurrentUser() user: User): Promise<PurchaseResult> {
    return this.tickets.purchase(user);
  }

  @Get('purchases')
  purchases(
    @CurrentUser() user: User,
    @Query('limit', new ParseLimitPipe(50, 200)) limit: number,
  ): Promise<{ purchases: PurchaseJson[] }> {
    return this.tickets.purchases(user.id, limit);
  }
}
