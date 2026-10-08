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
/** One free pack per purchase, and one purchase per cool-down (until GET /park sends the live rules). */
export const PACK_SIZE = 20;
export const COOLDOWN_HOURS = 5;

/** Staff (`admin`) can open the Ringmaster's Office and can still ride while the park is closed. */
export type Role = 'player' | 'admin';

export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  /** Missing from an older server: a player. */
  role?: Role;
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
}

/** GET /park: whether the gates are open, and the rules every visitor sees (guests too). */
export interface Park {
  open: boolean;
  /** Only when closed: what the sign on the gate says (null for the default wording). */
  message: string | null;
  /** Tickets per round; an attraction without a price yet is left out. */
  costs: Partial<Record<AttractionId, number>>;
  packSize: number;
  cooldownHours: number;
  /** Attractions closed for maintenance, each with its sign (null for the default wording). Open ones are left out. */
  maintenance: Partial<Record<AttractionId, string | null>>;
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

// ---------- The Ringmaster's Office (staff only) ----------

/** The park's settings row, as staff see and edit it. */
export interface ParkSettings {
  open: boolean;
  closedMessage: string | null;
  packSize: number;
  cooldownHours: number;
  updatedAt: string | null;
}

/** Days the overview can look back over. */
export const OVERVIEW_DAYS = [7, 30, 90] as const;
export type OverviewDays = (typeof OVERVIEW_DAYS)[number];

export interface RideAnalytics {
  rounds: number;
  roundsInRange: number;
  completed: number;
  abandoned: number;
  ticketsSpent: number;
  ticketsSpentInRange: number;
  /** Members who ever played it. */
  players: number;
  /** Average length of a completed round, in seconds. */
  avgSeconds: number | null;
  price: number;
  open: boolean;
}

export interface StatRecord {
  value: number;
  username: string;
  at: string | null;
}

/** GET /ringmaster/overview: the numbers across every member. Days are UTC days. */
export interface Overview {
  generatedAt: string;
  days: OverviewDays;
  /** First day of the range, YYYY-MM-DD. */
  since: string;
  users: { total: number; admins: number; newToday: number; newInRange: number; activeToday: number; activeInRange: number };
  tickets: {
    purchases: number;
    purchasesToday: number;
    purchasesInRange: number;
    ticketsSold: number;
    ticketsSoldInRange: number;
    ticketsSpent: number;
    ticketsSpentInRange: number;
    inCirculation: number;
  };
  rounds: { total: number; today: number; inRange: number; completed: number; abandoned: number; open: number };
  byRide: Record<AttractionId, RideAnalytics>;
  /** One row per day of the range, oldest first, today included and zero-filled. */
  daily: { date: string; signups: number; purchases: number; ticketsSold: number; rounds: number; players: number; ticketsSpent: number }[];
  /** Rounds started in the range per hour of the day (UTC), 0 to 23. */
  hours: number[];
  topPlayers: { id: string; username: string; rounds: number; ticketsSpent: number; favourite: AttractionId | null }[];
  /** Per attraction and stat key, the highest and lowest value ever reported. */
  records: Partial<Record<AttractionId, Record<string, { max: StatRecord; min: StatRecord }>>>;
  park: ParkSettings;
}

/** An attraction's settings: its price, and whether it is running. */
export interface AttractionSettings {
  attraction: AttractionId;
  tickets: number;
  open: boolean;
  /** The sign while it is closed (null for the default wording). */
  closedMessage: string | null;
  updatedAt: string | null;
}

/** A member as the Ringmaster's Office lists them. */
export interface AdminUser {
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
  user: AdminUser;
  purchases: Purchase[];
  rounds: Round[];
  byRide: Partial<Record<AttractionId, { rounds: number; ticketsSpent: number }>>;
}

export interface AdminPurchase extends Purchase {
  provider: string;
  user: { id: string; username: string; email: string };
}

export interface AdminRound extends Round {
  user: { id: string; username: string };
}

export interface AdminAction {
  id: string;
  actorName: string;
  action: string;
  target: string | null;
  details: unknown;
  createdAt: string;
}

/** One page of a list: `limit` rows from `offset`. */
export interface Page {
  limit: number;
  offset: number;
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

/** 503 with code 'park_closed': the park is closed, so no boarding and no packs (staff excepted). */
export class ParkClosedError extends ApiError {
  constructor(message: string, data: unknown) {
    super(503, message, data);
    this.name = 'ParkClosedError';
  }

  /** The server answered on purpose: it isn't down. */
  override get unavailable() {
    return false;
  }
}

/** 503 with code 'ride_closed': the attraction is closed for maintenance (staff excepted). */
export class RideClosedError extends ApiError {
  readonly ride: AttractionId | null;

  constructor(message: string, data: unknown) {
    super(503, message, data);
    this.name = 'RideClosedError';
    const ride = (data as { ride?: unknown } | null)?.ride;
    this.ride = typeof ride === 'string' && isAttraction(ride) ? ride : null;
  }

  override get unavailable() {
    return false;
  }
}

const closedCode = (status: number, data: unknown) => (status === 503 ? (data as { code?: unknown } | null)?.code : undefined);

/** The server's own words, as they are (the closed sign is written by staff). */
const rawMessage = (data: unknown) => {
  const m = (data as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : null;
};

/** Nest's error body carries `message` as a string or, for validation, a list of strings. */
function messageOf(body: unknown, status: number) {
  const raw = (body as { message?: unknown } | null)?.message;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  if (status === 429) return 'Too many tries. Take a breather and try again in a minute.';
  if (status === 0 || status === 404 || status >= 500) return OFFLINE;
  if (!list.length) return 'Something went wrong. Please try again.';
  return list.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join('. ');
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
    const code = closedCode(res.status, data);
    if (code === 'park_closed') throw new ParkClosedError(rawMessage(data) ?? 'The park is closed right now.', data);
    if (code === 'ride_closed') throw new RideClosedError(rawMessage(data) ?? 'Under maintenance. Back soon!', data);
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

  /** Open or closed, what is under maintenance, the prices and the pack rules. No account needed. */
  park: () => request<Park>('GET', '/park'),
};

/** `?a=1&b=x` from the values that are set. */
const query = (params: Record<string, string | number | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** The Ringmaster's Office: staff only (a guest gets a 401, a player a 403). The server logs every change. */
export const ringmaster = {
  overview: (days: OverviewDays) => request<Overview>('GET', `/ringmaster/overview${query({ days })}`),
  park: () => request<ParkSettings>('GET', '/ringmaster/park'),
  updatePark: (body: Partial<Pick<ParkSettings, 'open' | 'closedMessage' | 'packSize' | 'cooldownHours'>>) => request<ParkSettings>('PATCH', '/ringmaster/park', body),
  attractions: () => request<{ attractions: AttractionSettings[] }>('GET', '/ringmaster/attractions'),
  updateAttraction: (attraction: AttractionId, body: Partial<Pick<AttractionSettings, 'tickets' | 'open' | 'closedMessage'>>) =>
    request<AttractionSettings>('PATCH', `/ringmaster/attractions/${attraction}`, body),
  users: (p: Page & { q?: string }) =>
    request<{ users: AdminUser[]; total: number }>('GET', `/ringmaster/users${query({ q: p.q?.trim(), limit: p.limit, offset: p.offset })}`),
  user: (id: string) => request<AdminUserDetail>('GET', `/ringmaster/users/${encodeURIComponent(id)}`),
  updateUser: (id: string, body: { ticketBalance?: number; role?: Role; resetCooldown?: true }) =>
    request<AdminUser>('PATCH', `/ringmaster/users/${encodeURIComponent(id)}`, body),
  deleteUser: (id: string) => request<void>('DELETE', `/ringmaster/users/${encodeURIComponent(id)}`),
  purchases: (p: Page) => request<{ purchases: AdminPurchase[]; total: number }>('GET', `/ringmaster/purchases${query({ limit: p.limit, offset: p.offset })}`),
  rounds: (p: Page & { ride?: AttractionId | null }) =>
    request<{ rounds: AdminRound[]; total: number }>('GET', `/ringmaster/rounds${query({ ride: p.ride, limit: p.limit, offset: p.offset })}`),
  actions: (p: Page) => request<{ actions: AdminAction[]; total: number }>('GET', `/ringmaster/actions${query({ limit: p.limit, offset: p.offset })}`),
};
