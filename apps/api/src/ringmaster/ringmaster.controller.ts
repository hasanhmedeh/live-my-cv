import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ParseLimitPipe } from '../common/parse-limit.pipe.js';
import { ParseOffsetPipe } from '../common/parse-offset.pipe.js';
import { SuggestionStatus, type Attraction, type User } from '../generated/prisma/client.js';
import { ParseRidePipe } from '../rides/parse-ride.pipe.js';
import { ANALYTICS_DAYS, AnalyticsService, type AnalyticsDays, type Overview } from './analytics.service.js';
import { UpdateAttractionDto } from './dto/update-attraction.dto.js';
import { UpdateParkDto } from './dto/update-park.dto.js';
import { UpdateShopItemDto } from './dto/update-shop-item.dto.js';
import { UpdateSuggestionDto } from './dto/update-suggestion.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  RingmasterService,
  type AdminActionJson,
  type AdminPurchaseJson,
  type AdminRoundJson,
  type AdminShopItemJson,
  type AdminShopOrderJson,
  type AdminSuggestionJson,
  type AdminUserDetail,
  type AdminUserJson,
  type AttractionJson,
  type ParkSettingsJson,
  type VisitorsJson,
} from './ringmaster.service.js';
import { StaffGuard } from './staff.guard.js';

/**
 * The Ringmaster's Office: the park's back office, for staff only (a guest gets a 401, a player a
 * 403). Appoint staff with `pnpm staff:appoint <email>`. Every change lands in the logbook.
 */
@Controller('ringmaster')
@UseGuards(SessionGuard, StaffGuard)
export class RingmasterController {
  constructor(
    private readonly office: RingmasterService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** The numbers: members, tickets, rounds, per attraction and per day. `?days=` 7, 30 (default) or 90. */
  @Get('overview')
  overview(@Query('days') days?: string): Promise<Overview> {
    return this.analytics.overview(parseDays(days));
  }

  /** Who's in the fair right now: members, guests, and visitors still at the entrance. */
  @Get('visitors')
  visitors(): Promise<VisitorsJson> {
    return this.office.visitors();
  }

  @Get('park')
  park(): Promise<ParkSettingsJson> {
    return this.office.parkSettings();
  }

  /** Opens or closes the whole park, changes its sign or the pack rules. */
  @Patch('park')
  updatePark(@CurrentUser() actor: User, @Body() body: UpdateParkDto): Promise<ParkSettingsJson> {
    return this.office.updatePark(actor, body);
  }

  @Get('attractions')
  attractions(): Promise<{ attractions: AttractionJson[] }> {
    return this.office.attractions();
  }

  /** Sets an attraction's price, or closes it for maintenance (and opens it again). */
  @Patch('attractions/:ride')
  updateAttraction(
    @CurrentUser() actor: User,
    @Param('ride', ParseRidePipe) ride: Attraction,
    @Body() body: UpdateAttractionDto,
  ): Promise<AttractionJson> {
    return this.office.updateAttraction(actor, ride, body);
  }

  @Get('shop')
  shopItems(): Promise<{ items: AdminShopItemJson[] }> {
    return this.office.shopItems();
  }

  /** Sets a shop item's price, or how many are left to sell (null for no limit). */
  @Patch('shop/:item')
  updateShopItem(@CurrentUser() actor: User, @Param('item') item: string, @Body() body: UpdateShopItemDto): Promise<AdminShopItemJson> {
    return this.office.updateShopItem(actor, item, body);
  }

  @Get('users')
  users(
    @Query('q') q: string | undefined,
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ users: AdminUserJson[]; total: number }> {
    return this.office.users({ q: typeof q === 'string' ? q : undefined, limit, offset });
  }

  @Get('users/:id')
  user(@Param('id') id: string): Promise<AdminUserDetail> {
    return this.office.user(id);
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: UpdateUserDto): Promise<AdminUserJson> {
    return this.office.updateUser(actor, id, body);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@CurrentUser() actor: User, @Param('id') id: string): Promise<void> {
    return this.office.deleteUser(actor, id);
  }

  @Get('purchases')
  purchases(
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ purchases: AdminPurchaseJson[]; total: number }> {
    return this.office.purchases({ limit, offset });
  }

  @Get('shop-orders')
  shopOrders(
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ orders: AdminShopOrderJson[]; total: number }> {
    return this.office.shopOrders({ limit, offset });
  }

  @Get('rounds')
  rounds(
    @Query('ride') ride: string | undefined,
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ rounds: AdminRoundJson[]; total: number }> {
    const only = ride ? new ParseRidePipe().transform(ride) : undefined;
    return this.office.rounds({ ride: only, limit, offset });
  }

  /** The Idea Box, newest first. `?status=` shows one status only; `counts` has every status either way. */
  @Get('suggestions')
  suggestions(
    @Query('status') status: string | undefined,
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ suggestions: AdminSuggestionJson[]; total: number; counts: Record<SuggestionStatus, number> }> {
    return this.office.suggestions({ status: parseStatus(status), limit, offset });
  }

  /** Answers a suggestion (once: 409 if it has an answer already), or changes its status. */
  @Patch('suggestions/:id')
  updateSuggestion(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: UpdateSuggestionDto): Promise<AdminSuggestionJson> {
    return this.office.updateSuggestion(actor, id, body);
  }

  @Get('actions')
  actions(
    @Query('limit', new ParseLimitPipe(25, 100)) limit: number,
    @Query('offset', ParseOffsetPipe) offset: number,
  ): Promise<{ actions: AdminActionJson[]; total: number }> {
    return this.office.actions({ limit, offset });
  }
}

function parseDays(value: string | undefined): AnalyticsDays {
  if (value === undefined || value === '') return 30;
  const days = Number(value);
  if (!(ANALYTICS_DAYS as readonly number[]).includes(days)) throw new BadRequestException(`days must be one of ${ANALYTICS_DAYS.join(', ')}`);
  return days as AnalyticsDays;
}

/** `?status=`: one of the statuses, or nothing for all of them. */
function parseStatus(value: string | undefined): SuggestionStatus | undefined {
  if (value === undefined || value === '') return undefined;
  const statuses = Object.values(SuggestionStatus) as string[];
  if (!statuses.includes(value)) throw new BadRequestException(`status must be one of ${statuses.join(', ')}`);
  return value as SuggestionStatus;
}
