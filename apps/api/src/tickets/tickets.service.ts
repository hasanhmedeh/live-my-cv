import { ConflictException, HttpStatus, Injectable } from '@nestjs/common';
import type { Attraction, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  COOLDOWN_HOURS,
  COOLDOWN_MS,
  PACK_CURRENCY,
  PACK_PRICE_CENTS,
  PACK_PROVIDER,
  PACK_SIZE,
  TICKET_COSTS,
} from '../rides/attractions.js';
import { toPurchaseJson, type PurchaseJson } from './purchase-json.js';

export interface TicketStatus {
  balance: number;
  packSize: number;
  cooldownHours: number;
  lastPurchaseAt: string | null;
  /** Null when a purchase is allowed now. */
  nextPurchaseAt: string | null;
  canBuy: boolean;
  costs: Record<Attraction, number>;
}

export interface PurchaseResult {
  balance: number;
  purchase: Pick<PurchaseJson, 'id' | 'quantity' | 'priceCents' | 'currency' | 'createdAt'>;
  nextPurchaseAt: string;
  canBuy: false;
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Balance, prices and whether a pack can be bought now. `user` is fresh: SessionGuard just loaded it. */
  status(user: User): TicketStatus {
    const next = nextPurchaseAt(user.lastPurchaseAt, new Date());
    return {
      balance: user.ticketBalance,
      packSize: PACK_SIZE,
      cooldownHours: COOLDOWN_HOURS,
      lastPurchaseAt: user.lastPurchaseAt?.toISOString() ?? null,
      nextPurchaseAt: next?.toISOString() ?? null,
      canBuy: next === null,
      costs: { ...TICKET_COSTS },
    };
  }

  /**
   * Adds one pack to the balance, at most once per cooldown. The cooldown check, the increment and
   * the new lastPurchaseAt are a single conditional UPDATE: of two concurrent purchases, the second
   * waits on the row lock, then re-checks the condition against the updated row and matches nothing.
   * The purchase row is written in the same transaction, so the two never disagree.
   */
  async purchase(userId: string): Promise<PurchaseResult> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, OR: [{ lastPurchaseAt: null }, { lastPurchaseAt: { lte: new Date(now.getTime() - COOLDOWN_MS) } }] },
        data: { ticketBalance: { increment: PACK_SIZE }, lastPurchaseAt: now },
      });
      if (count === 0) return null;
      // Still inside the transaction that holds the row lock, so this is the balance this purchase produced.
      const { ticketBalance } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { ticketBalance: true } });
      const purchase = await tx.ticketPurchase.create({
        data: {
          userId,
          quantity: PACK_SIZE,
          priceCents: PACK_PRICE_CENTS,
          currency: PACK_CURRENCY,
          provider: PACK_PROVIDER,
          balanceAfter: ticketBalance,
          createdAt: now,
        },
      });
      return { purchase, balance: ticketBalance };
    });

    if (!result) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { lastPurchaseAt: true } });
      const next = nextPurchaseAt(user?.lastPurchaseAt ?? null, new Date()) ?? new Date();
      throw new ConflictException({
        ...ConflictException.createBody('You can buy your next pack later', 'Conflict', HttpStatus.CONFLICT),
        nextPurchaseAt: next.toISOString(),
      });
    }

    const { purchase, balance } = result;
    return {
      balance,
      purchase: {
        id: purchase.id,
        quantity: purchase.quantity,
        priceCents: purchase.priceCents,
        currency: purchase.currency,
        createdAt: purchase.createdAt.toISOString(),
      },
      nextPurchaseAt: new Date(now.getTime() + COOLDOWN_MS).toISOString(),
      canBuy: false,
    };
  }

  /** The user's latest purchases, newest first. */
  async purchases(userId: string, limit: number): Promise<{ purchases: PurchaseJson[] }> {
    const purchases = await this.prisma.ticketPurchase.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return { purchases: purchases.map(toPurchaseJson) };
  }
}

/** When the cooldown after `lastPurchaseAt` ends, or null if it already has (or there was no purchase). */
function nextPurchaseAt(lastPurchaseAt: Date | null, now: Date): Date | null {
  if (!lastPurchaseAt) return null;
  const next = new Date(lastPurchaseAt.getTime() + COOLDOWN_MS);
  return next > now ? next : null;
}
