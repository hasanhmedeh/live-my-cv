import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type User } from '../generated/prisma/client.js';
import { announceQuietly } from '../live/announce.js';
import { ParkService } from '../park/park.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SHOP_ITEMS, shopItem, type ShopItem, type ShopItemJson } from './catalog.js';

export interface SouvenirJson {
  item: string;
  equipped: boolean;
  acquiredAt: string;
}

export interface ShopOrderJson {
  id: string;
  item: string;
  ticketsSpent: number;
  balanceAfter: number;
  createdAt: string;
}

export interface BuyResult {
  /** Tickets left after paying. */
  balance: number;
  order: ShopOrderJson;
  /** Every souvenir the member owns now (a new one is worn straight away). */
  souvenirs: SouvenirJson[];
}

/**
 * The Ticket Booth's shop: treats and souvenirs, paid for in tickets. The catalog is public; buying
 * and wearing need an account. Not while the park is closed (staff excepted), like the tickets.
 * Prices and stock are set in The Ringmaster's Office (shop_item_settings).
 */
@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly park: ParkService,
  ) {}

  /** Every catalog item at today's price, with what's left of it. */
  async catalog(): Promise<{ items: ShopItemJson[] }> {
    const rows = new Map((await this.prisma.shopItemSettings.findMany()).map((r) => [r.item, r]));
    return { items: SHOP_ITEMS.map((i) => toItemJson(i, rows.get(i.id))) };
  }

  async souvenirs(userId: string): Promise<{ souvenirs: SouvenirJson[] }> {
    return { souvenirs: await this.owned(this.prisma, userId) };
  }

  /** The member's own orders, newest first, and how many there are in all. */
  async orders(userId: string, limit: number): Promise<{ orders: ShopOrderJson[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.shopOrder.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit }),
      this.prisma.shopOrder.count({ where: { userId } }),
    ]);
    return { orders: rows.map(toOrderJson), total };
  }

  /**
   * Buys one item. The balance check and the payment are one conditional UPDATE (like boarding), so
   * two quick buys can't spend the same tickets twice; taking one from the stock is another, so the
   * last one can't be sold twice either. The order (and a souvenir) is written in the same
   * transaction. 402 when the balance is short, 409 for a souvenir already owned, 409 with code
   * 'sold_out' when there are none left.
   */
  async buy(user: User, itemId: string): Promise<BuyResult> {
    const item = shopItem(itemId);
    if (!item) throw new BadRequestException('There is no such item at the booth');
    this.park.assertParkOpen(await this.park.rules(), user);
    const userId = user.id;

    let result: { done: BuyResult; stocked: boolean } | { short: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        if (item.kind === 'souvenir' && (await tx.souvenir.count({ where: { userId, item: item.id } }))) {
          throw new ConflictException(`You already have the ${item.name}`);
        }
        const settings = await tx.shopItemSettings.findUnique({ where: { item: item.id } });
        if (settings?.stock === 0) throw soldOut(item);
        const cost = settings?.tickets ?? item.tickets;
        const { count } = await tx.user.updateMany({ where: { id: userId, ticketBalance: { gte: cost } }, data: { ticketBalance: { decrement: cost } } });
        if (count === 0) return { short: cost };
        if (settings) {
          // one off the stock, if it has one (null stays null): none left now rolls the payment back
          const { count: taken } = await tx.shopItemSettings.updateMany({
            where: { item: item.id, OR: [{ stock: null }, { stock: { gte: 1 } }] },
            data: { stock: { decrement: 1 } },
          });
          if (taken === 0) throw soldOut(item);
        }
        const { ticketBalance } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { ticketBalance: true } });
        const order = await tx.shopOrder.create({ data: { userId, item: item.id, ticketsSpent: cost, balanceAfter: ticketBalance } });
        if (item.kind === 'souvenir') {
          // a new souvenir is worn straight away, in place of whatever was in its slot
          await this.unequipSlot(tx, userId, item);
          await tx.souvenir.create({ data: { userId, item: item.id, equipped: true } });
        }
        return {
          done: { balance: ticketBalance, order: toOrderJson(order), souvenirs: await this.owned(tx, userId) },
          stocked: settings?.stock !== null && settings?.stock !== undefined,
        };
      });
    } catch (err) {
      // the same souvenir bought twice at once: the second insert hits the primary key
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`You already have the ${item.name}`);
      throw err;
    }

    if ('short' in result) {
      const fresh = await this.prisma.user.findUnique({ where: { id: userId }, select: { ticketBalance: true } });
      throw new HttpException(
        { ...HttpException.createBody('Not enough tickets', 'Payment Required', HttpStatus.PAYMENT_REQUIRED), needed: result.short, balance: fresh?.ticketBalance ?? 0 },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    await announceQuietly(this.prisma, { t: 'office', kind: 'purchases' });
    // one fewer on the shelf: every open shop shows what's left
    if (result.stocked) await announceQuietly(this.prisma, { t: 'shop' });
    return result.done;
  }

  /** Puts a souvenir on (taking off whatever shares its slot) or takes it off. */
  async wear(userId: string, itemId: string, equipped: boolean): Promise<{ souvenirs: SouvenirJson[] }> {
    const item = shopItem(itemId);
    if (!item || item.kind !== 'souvenir') throw new NotFoundException('No such souvenir');
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.souvenir.findUnique({ where: { userId_item: { userId, item: item.id } } });
      if (!owned) throw new NotFoundException(`You don't have the ${item.name} yet`);
      if (equipped) await this.unequipSlot(tx, userId, item);
      await tx.souvenir.update({ where: { userId_item: { userId, item: item.id } }, data: { equipped } });
      return { souvenirs: await this.owned(tx, userId) };
    });
  }

  private unequipSlot(tx: Prisma.TransactionClient, userId: string, item: ShopItem) {
    const sameSlot = SHOP_ITEMS.filter((i) => i.kind === 'souvenir' && i.slot === item.slot && i.id !== item.id).map((i) => i.id);
    return tx.souvenir.updateMany({ where: { userId, item: { in: sameSlot } }, data: { equipped: false } });
  }

  private async owned(db: Pick<Prisma.TransactionClient, 'souvenir'>, userId: string): Promise<SouvenirJson[]> {
    const rows = await db.souvenir.findMany({ where: { userId }, orderBy: { acquiredAt: 'asc' } });
    return rows.map((s) => ({ item: s.item, equipped: s.equipped, acquiredAt: s.acquiredAt.toISOString() }));
  }
}

/** 409 with code 'sold_out', so the game can tell it from a souvenir already owned. */
function soldOut(item: ShopItem) {
  return new HttpException(
    { ...HttpException.createBody(`The ${item.name} is sold out`, 'Conflict', HttpStatus.CONFLICT), code: 'sold_out', item: item.id },
    HttpStatus.CONFLICT,
  );
}

/** An item at the price set in the office (its catalog price without a row), and its stock. */
export function toItemJson(item: ShopItem, settings: { tickets: number; stock: number | null } | undefined): ShopItemJson {
  return { ...item, tickets: settings?.tickets ?? item.tickets, stock: settings?.stock ?? null };
}

export function toOrderJson(o: { id: string; item: string; ticketsSpent: number; balanceAfter: number; createdAt: Date }): ShopOrderJson {
  return { id: o.id, item: o.item, ticketsSpent: o.ticketsSpent, balanceAfter: o.balanceAfter, createdAt: o.createdAt.toISOString() };
}
