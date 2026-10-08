import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toRoundJson, type RoundJson } from '../rides/round-json.js';
import { toPurchaseJson, type PurchaseJson } from '../tickets/purchase-json.js';
import { verifyPassword } from './password.js';

/** Everything stored about a user, as handed out by GET /auth/me/export. Never the password hash. */
export interface AccountExport {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
    termsAcceptedAt: string | null;
    termsVersion: string | null;
  };
  tickets: { balance: number; lastPurchaseAt: string | null };
  purchases: (PurchaseJson & { provider: string })[];
  rounds: RoundJson[];
}

/** The user's data rights: a copy of their data, and deleting it. */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** `user` comes straight from SessionGuard, so it is current. Purchases and rounds oldest first. */
  async export(user: User): Promise<AccountExport> {
    const [purchases, rounds] = await Promise.all([
      this.prisma.ticketPurchase.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.rideRound.findMany({ where: { userId: user.id }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt.toISOString(),
        termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
        termsVersion: user.termsVersion,
      },
      tickets: { balance: user.ticketBalance, lastPurchaseAt: user.lastPurchaseAt?.toISOString() ?? null },
      purchases: purchases.map((purchase) => ({ ...toPurchaseJson(purchase), provider: purchase.provider })),
      rounds: rounds.map(toRoundJson),
    };
  }

  /** Deletes the account after checking the password. Purchases and rounds go with it (ON DELETE CASCADE). */
  async delete(user: User, password: string): Promise<void> {
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException('Wrong password');
    // deleteMany: a concurrent delete of the same account is not an error, the outcome is the same.
    await this.prisma.user.deleteMany({ where: { id: user.id } });
  }
}
