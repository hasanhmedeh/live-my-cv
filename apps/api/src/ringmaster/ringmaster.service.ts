import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Attraction, type Role, type User } from '../generated/prisma/client.js';
import { ParkService, toAttractionRules, type AttractionRules, type ParkRules } from '../park/park.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_TICKET_COSTS } from '../rides/attractions.js';
import { toRoundJson, type RoundJson } from '../rides/round-json.js';
import { toPurchaseJson, type PurchaseJson } from '../tickets/purchase-json.js';
import type { UpdateAttractionDto } from './dto/update-attraction.dto.js';
import type { UpdateParkDto } from './dto/update-park.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

export interface ParkSettingsJson {
  open: boolean;
  closedMessage: string | null;
  packSize: number;
  cooldownHours: number;
  updatedAt: string | null;
}

export interface AttractionJson {
  attraction: Attraction;
  tickets: number;
  open: boolean;
  closedMessage: string | null;
  updatedAt: string | null;
}

export interface AdminUserJson {
  id: string;
  email: string;
  username: string;
  role: Role;
  ticketBalance: number;
  lastPurchaseAt: string | null;
  createdAt: string;
  termsAcceptedAt: string | null;
  rounds: number;
  purchases: number;
}

export interface AdminUserDetail {
  user: AdminUserJson;
  purchases: PurchaseJson[];
  rounds: RoundJson[];
  byRide: Partial<Record<Attraction, { rounds: number; ticketsSpent: number }>>;
}

export interface AdminPurchaseJson extends PurchaseJson {
  provider: string;
  user: { id: string; username: string; email: string };
}

export interface AdminRoundJson extends RoundJson {
  user: { id: string; username: string };
}

export interface AdminActionJson {
  id: string;
  actorName: string;
  action: string;
  target: string | null;
  details: unknown;
  createdAt: string;
}

/** A page of a list: `limit` rows from `offset`, and how many there are in all. */
export interface PageQuery {
  limit: number;
  offset: number;
}

type Tx = Prisma.TransactionClient;

const withCounts = { _count: { select: { rounds: true, purchases: true } } } as const;
type UserWithCounts = Prisma.UserGetPayload<{ include: typeof withCounts }>;

/**
 * The Ringmaster's Office: the park's switches, the attractions, the members and the logbook.
 * Every change is written to admin_actions in the same transaction as the change itself.
 */
@Injectable()
export class RingmasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly park: ParkService,
  ) {}

  async parkSettings(): Promise<ParkSettingsJson> {
    return toParkJson(await this.park.rules());
  }

  /** Opens or closes the park, or changes the pack rules. Logged as park.open, park.close or settings.update. */
  async updatePark(actor: User, dto: UpdateParkDto): Promise<ParkSettingsJson> {
    const before = await this.park.rules();
    const data = defined({ open: dto.open, closedMessage: dto.closedMessage, packSize: dto.packSize, cooldownHours: dto.cooldownHours });
    const changed = changes(before, data);
    if (!changed) return toParkJson(before);

    const row = await this.prisma.$transaction(async (tx) => {
      const row = await tx.parkSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
      const action = 'open' in changed.after ? (row.open ? 'park.open' : 'park.close') : 'settings.update';
      await log(tx, actor, action, null, changed);
      return row;
    });
    return toParkJson(row);
  }

  async attractions(): Promise<{ attractions: AttractionJson[] }> {
    return { attractions: (await this.park.attractions()).map(toAttractionJson) };
  }

  /**
   * Changes an attraction's price, or closes it for maintenance (or opens it again). Logged as
   * attraction.open, attraction.close, price.update or attraction.update (just the sign).
   */
  async updateAttraction(actor: User, attraction: Attraction, dto: UpdateAttractionDto): Promise<AttractionJson> {
    const before = await this.park.attraction(attraction);
    const data = defined({ tickets: dto.tickets, open: dto.open, closedMessage: dto.closedMessage });
    const changed = changes(before, data);
    if (!changed) return toAttractionJson(before);

    const row = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attractionSettings.upsert({
        where: { attraction },
        create: { attraction, tickets: DEFAULT_TICKET_COSTS[attraction], ...data },
        update: data,
      });
      const action =
        'open' in changed.after ? (row.open ? 'attraction.open' : 'attraction.close') : 'tickets' in changed.after ? 'price.update' : 'attraction.update';
      await log(tx, actor, action, attraction, changed);
      return row;
    });
    return toAttractionJson(toAttractionRules(attraction, row));
  }

  /** Members, newest first, optionally matching `q` in their email or username. */
  async users({ q, limit, offset }: PageQuery & { q?: string }): Promise<{ users: AdminUserJson[]; total: number }> {
    const term = q?.trim().slice(0, 100);
    const where: Prisma.UserWhereInput = term
      ? { OR: [{ email: { contains: term, mode: 'insensitive' } }, { username: { contains: term, mode: 'insensitive' } }] }
      : {};
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: withCounts, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.prisma.user.count({ where }),
    ]);
    return { users: users.map(toAdminUserJson), total };
  }

  async user(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: withCounts });
    if (!user) throw new NotFoundException('No such member');
    const [purchases, rounds, groups] = await Promise.all([
      this.prisma.ticketPurchase.findMany({ where: { userId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
      this.prisma.rideRound.findMany({ where: { userId: id }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: 30 }),
      this.prisma.rideRound.groupBy({ by: ['ride'], where: { userId: id }, _count: { _all: true }, _sum: { ticketsSpent: true } }),
    ]);
    const byRide: AdminUserDetail['byRide'] = {};
    for (const g of groups) byRide[g.ride] = { rounds: g._count._all, ticketsSpent: g._sum.ticketsSpent ?? 0 };
    return { user: toAdminUserJson(user), purchases: purchases.map(toPurchaseJson), rounds: rounds.map(toRoundJson), byRide };
  }

  /**
   * Sets a member's balance, role, or lets them buy their next pack now. Staff can't change their
   * own role, so the office never locks out the last person who can open it.
   */
  async updateUser(actor: User, id: string, dto: UpdateUserDto): Promise<AdminUserJson> {
    if (dto.role !== undefined && id === actor.id && dto.role !== actor.role) {
      throw new BadRequestException("You can't change your own role. Ask another member of staff.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('No such member');
      const data: Prisma.UserUpdateInput = {};
      if (dto.ticketBalance !== undefined && dto.ticketBalance !== before.ticketBalance) {
        data.ticketBalance = dto.ticketBalance;
        await log(tx, actor, 'user.tickets', before.email, { before: { tickets: before.ticketBalance }, after: { tickets: dto.ticketBalance } });
      }
      if (dto.role !== undefined && dto.role !== before.role) {
        data.role = dto.role;
        await log(tx, actor, 'user.role', before.email, { before: { role: before.role }, after: { role: dto.role } });
      }
      if (dto.resetCooldown && before.lastPurchaseAt) {
        data.lastPurchaseAt = null;
        await log(tx, actor, 'user.cooldown', before.email, { before: { lastPurchaseAt: before.lastPurchaseAt.toISOString() }, after: { lastPurchaseAt: null } });
      }
      return tx.user.update({ where: { id }, data, include: withCounts });
    });
    return toAdminUserJson(updated);
  }

  /** Deletes a member with their purchases and rounds. Not yourself: that's the account card's job. */
  async deleteUser(actor: User, id: string): Promise<void> {
    if (id === actor.id) throw new BadRequestException("You can't delete your own account from the office. Use your account card in the fair.");
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: withCounts });
      if (!user) throw new NotFoundException('No such member');
      await tx.user.delete({ where: { id } });
      await log(tx, actor, 'user.delete', user.email, {
        before: { username: user.username, tickets: user.ticketBalance, rounds: user._count.rounds, purchases: user._count.purchases },
      });
    });
  }

  async purchases({ limit, offset }: PageQuery): Promise<{ purchases: AdminPurchaseJson[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.ticketPurchase.findMany({
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.ticketPurchase.count(),
    ]);
    return { purchases: rows.map((p) => ({ ...toPurchaseJson(p), provider: p.provider, user: p.user })), total };
  }

  async rounds({ ride, limit, offset }: PageQuery & { ride?: Attraction }): Promise<{ rounds: AdminRoundJson[]; total: number }> {
    const where: Prisma.RideRoundWhereInput = ride ? { ride } : {};
    const [rows, total] = await Promise.all([
      this.prisma.rideRound.findMany({
        where,
        include: { user: { select: { id: true, username: true } } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.rideRound.count({ where }),
    ]);
    return { rounds: rows.map((r) => ({ ...toRoundJson(r), user: r.user })), total };
  }

  async actions({ limit, offset }: PageQuery): Promise<{ actions: AdminActionJson[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.adminAction.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.prisma.adminAction.count(),
    ]);
    return {
      actions: rows.map((a) => ({ id: a.id, actorName: a.actorName, action: a.action, target: a.target, details: a.details, createdAt: a.createdAt.toISOString() })),
      total,
    };
  }
}

/** Writes one line in the logbook. */
function log(tx: Tx, actor: User, action: string, target: string | null, details: object) {
  return tx.adminAction.create({
    data: { actorId: actor.id, actorName: actor.username, action, target, details: details as Prisma.InputJsonObject },
  });
}

/** `obj` without its undefined keys (the fields a PATCH left out). */
function defined<T extends Record<string, unknown>>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** The fields of `data` that differ from `current`, before and after; null when nothing changes. */
function changes(current: object, data: Record<string, unknown>) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const was = (current as Record<string, unknown>)[key];
    if (was === value) continue;
    before[key] = was;
    after[key] = value;
  }
  return Object.keys(after).length ? { before, after } : null;
}

function toParkJson(rules: Pick<ParkRules, 'open' | 'closedMessage' | 'packSize' | 'cooldownHours' | 'updatedAt'>): ParkSettingsJson {
  return {
    open: rules.open,
    closedMessage: rules.closedMessage,
    packSize: rules.packSize,
    cooldownHours: rules.cooldownHours,
    updatedAt: rules.updatedAt?.toISOString() ?? null,
  };
}

function toAttractionJson(rules: AttractionRules): AttractionJson {
  return { ...rules, updatedAt: rules.updatedAt?.toISOString() ?? null };
}

function toAdminUserJson(user: UserWithCounts): AdminUserJson {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    ticketBalance: user.ticketBalance,
    lastPurchaseAt: user.lastPurchaseAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    rounds: user._count.rounds,
    purchases: user._count.purchases,
  };
}
