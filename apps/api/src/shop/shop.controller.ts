import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ParseLimitPipe } from '../common/parse-limit.pipe.js';
import type { User } from '../generated/prisma/client.js';
import type { ShopItemJson } from './catalog.js';
import { BuyDto } from './dto/buy.dto.js';
import { WearDto } from './dto/wear.dto.js';
import { ShopService, type BuyResult, type ShopOrderJson, type SouvenirJson } from './shop.service.js';

/** The Ticket Booth's shop. Anyone can look; buying and wearing need an account. */
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  /** Everything for sale, at today's prices, with how many are left of each (null: no limit). */
  @Get()
  catalog(): Promise<{ items: ShopItemJson[] }> {
    return this.shop.catalog();
  }

  /** The member's own orders, newest first. */
  @Get('orders')
  @UseGuards(SessionGuard)
  orders(@CurrentUser() user: User, @Query('limit', new ParseLimitPipe(10, 50)) limit: number): Promise<{ orders: ShopOrderJson[]; total: number }> {
    return this.shop.orders(user.id, limit);
  }

  @Get('souvenirs')
  @UseGuards(SessionGuard)
  souvenirs(@CurrentUser() user: User): Promise<{ souvenirs: SouvenirJson[] }> {
    return this.shop.souvenirs(user.id);
  }

  /** Pays for one item in tickets. 402 { needed, balance } when short, 409 for a souvenir already owned (or code 'sold_out'), 503 while the park is closed. */
  @Post('buy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  buy(@CurrentUser() user: User, @Body() body: BuyDto): Promise<BuyResult> {
    return this.shop.buy(user, body.item);
  }

  @Patch('souvenirs/:item')
  @UseGuards(SessionGuard)
  wear(@CurrentUser() user: User, @Param('item') item: string, @Body() body: WearDto): Promise<{ souvenirs: SouvenirJson[] }> {
    return this.shop.wear(user.id, item, body.equipped);
  }
}
