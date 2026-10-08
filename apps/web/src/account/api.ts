// A small typed client for the fair's accounts API. The session lives in an httpOnly cookie,
// so every request goes out with credentials and the page never sees the token.

/** Every attraction that costs tickets (they match the zone ids in world/layout.ts). */
export const ATTRACTION_IDS = ['coaster', 'falcon', 'rocket', 'ferris', 'flip', 'ship', 'speedway', 'drone', 'crates', 'striker'] as const;
export type AttractionId = (typeof ATTRACTION_IDS)[number];

export const isAttraction = (id: string | null | undefined): id is AttractionId => !!id && (ATTRACTION_IDS as readonly string[]).includes(id);

/** Tickets per round, until the server's own table arrives (GET /tickets sends the live one). */
export const DEFAULT_COSTS: Record<AttractionId, number> = {
  coaster: 1,
  falcon: 5,
  rocket: 1,
  ferris: 5,
  flip: 1,
  ship: 1,
  speedway: 1,
  drone: 1,
  crates: 1,
  striker: 1,
};
/** One free pack per purchase, and one purchase per cool-down. */
export const PACK_SIZE = 20;
export const COOLDOWN_HOURS = 5;

export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
}

/** The member's ticket wallet. `nextPurchaseAt` is null when a pack can be bought right now. */
export interface Tickets {
  balance: number;
  packSize: number;
  cooldownHours: number;
  lastPurchaseAt: string | null;
  nextPurchaseAt: string | null;
  canBuy: boolean;
  costs: Record<AttractionId, number>;
}

export interface Purchase {
  id: string;
  quantity: number;
  priceCents: number;
  currency: string;
  /** Only in the purchase history (GET /tickets/purchases). */
  balanceAfter?: number;
  createdAt: string;
}

/** A round's numbers, keyed as in account/stats.ts. */
export type RoundStats = Record<string, number>;
/** The best value of each stat over the member's earlier completed rounds of one attraction. */
export type Bests = Record<string, { min: number; max: number }>;

export interface Round {
  id: string;
  ride: AttractionId;
  ticketsSpent: number;
  startedAt: string;
  endedAt?: string | null;
  completed?: boolean | null;
  stats?: RoundStats | null;
}

export interface FinishedRound {
  round: Round;
  /** `rounds` counts the completed rounds of this attraction, this one included; `best` leaves it out. */
  history: { rounds: number; best: Bests };
}

export interface AttractionStats {
  rounds: number;
  ticketsSpent: number;
  best: Bests;
  last: { stats: RoundStats | null; endedAt: string } | null;
}

export interface RideStats {
  totalRounds: number;
  ticketsSpent: number;
  byRide: Record<AttractionId, AttractionStats>;
}

const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');
/** Long enough for a cold server, short enough that a button never stays "busy" for good. */
const TIMEOUT_MS = 12_000;

const OFFLINE = "Can't reach the ticket office right now. Check your connection and try again.";

/** A failed request. `status` is 0 when the server couldn't be reached at all; `data` is the error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The server is down, missing or unreachable (as opposed to saying no). */
  get unavailable() {
    return this.status === 0 || this.status === 404 || this.status >= 500;
  }
}

const numberIn = (data: unknown, key: string) => {
  const v = (data as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** 402: the round costs more tickets than the member has left. */
export class NotEnoughTicketsError extends ApiError {
  readonly needed: number | null;
  readonly balance: number | null;

  constructor(message: string, data: unknown) {
    super(402, message, data);
    this.name = 'NotEnoughTicketsError';
    this.needed = numberIn(data, 'needed');
    this.balance = numberIn(data, 'balance');
  }
}

/** 409 on a purchase: the next pack isn't due yet. */
export class PurchaseCooldownError extends ApiError {
  readonly nextPurchaseAt: string | null;

  constructor(message: string, data: unknown) {
    super(409, message, data);
    this.name = 'PurchaseCooldownError';
    const at = (data as { nextPurchaseAt?: unknown } | null)?.nextPurchaseAt;
    this.nextPurchaseAt = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null;
  }
}

/** Nest's error body carries `message` as a string or, for validation, a list of strings. */
function messageOf(body: unknown, status: number) {
  const raw = (body as { message?: unknown } | null)?.message;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  if (status === 429) return 'Too many tries. Take a breather and try again in a minute.';
  if (status === 0 || status === 404 || status >= 500) return OFFLINE;
  if (!list.length) return 'Something went wrong. Please try again.';
  return list.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join('. ');
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = messageOf(data, res.status);
    throw res.status === 402 ? new NotEnoughTicketsError(message, data) : new ApiError(res.status, message, data);
  }
  // a static host may answer 200 with its own HTML page: that isn't the API either
  if (data === null) throw new ApiError(0, OFFLINE);
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/auth/me'),
  signup: (body: { email: string; username: string; password: string; acceptTerms: true }) => request<{ user: User }>('POST', '/auth/signup', body),
  login: (body: { email: string; password: string }) => request<{ user: User }>('POST', '/auth/login', body),
  logout: () => request<void>('POST', '/auth/logout'),
  /** Everything the fair keeps about the member, as one JSON document. */
  exportData: () => request<Record<string, unknown>>('GET', '/auth/me/export'),
  /** Deletes the account and all its purchases and rounds. A wrong password is a 401. */
  deleteAccount: (password: string) => request<void>('DELETE', '/auth/me', { password }),

  tickets: () => request<Tickets>('GET', '/tickets'),
  purchase: () =>
    request<{ balance: number; purchase: Purchase; nextPurchaseAt: string | null; canBuy: boolean }>('POST', '/tickets/purchase').catch((err: unknown) => {
      throw err instanceof ApiError && err.status === 409 ? new PurchaseCooldownError(err.message, err.data) : err;
    }),
  purchases: (limit = 50) => request<{ purchases: Purchase[] }>('GET', `/tickets/purchases?limit=${limit}`),

  /** Pays for one round (the tickets are spent now) and opens it. */
  board: (ride: AttractionId) => request<{ round: Round; balance: number }>('POST', `/rides/${ride}/board`),
  finish: (id: string, body: { completed: boolean; stats: RoundStats }) => request<FinishedRound>('POST', `/rides/rounds/${encodeURIComponent(id)}/finish`, body),
  stats: () => request<RideStats>('GET', '/rides/stats'),
  history: (limit = 20) => request<{ rounds: Round[] }>('GET', `/rides/history?limit=${limit}`),
};
