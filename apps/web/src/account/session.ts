import {
  api,
  ApiError,
  COOLDOWN_HOURS,
  DEFAULT_COSTS,
  NotEnoughTicketsError,
  PurchaseCooldownError,
  type AttractionId,
  type FinishedRound,
  type Purchase,
  type RideStats,
  type RoundStats,
  type Tickets,
  type User,
} from './api';

type Listener = () => void;

/** If the server can't be reached at boot, look again after these delays (it may still be starting). */
const RETRY_MS = [3_000, 10_000];
/** How many purchases the booth and the account card show. */
const RECENT_PURCHASES = 5;

/**
 * Who's visiting: a member (`user`) or a guest (`null`), and the member's tickets. Everything
 * here is best effort: when the accounts server is down the fair still opens, and the visitor
 * simply walks in as a guest.
 */
class Session {
  private _user: User | null = null;
  private _known = false;
  private _tickets: Tickets | null = null;
  private _stats: RideStats | null = null;
  private _purchases: Purchase[] | null = null;
  private listeners = new Set<Listener>();
  private warned = false;
  private ticketsLoading: { id: string; p: Promise<Tickets | null> } | null = null;

  get user() {
    return this._user;
  }

  /** False until the first check against the server has settled (either way). */
  get known() {
    return this._known;
  }

  /** The member's wallet, once loaded (see `loadTickets`). */
  get tickets() {
    return this._tickets;
  }

  /** How many tickets the member holds, if known yet. */
  get balance() {
    return this._tickets?.balance ?? null;
  }

  /** The member's rounds and bests per attraction, once loaded (see `loadStats`). */
  get stats() {
    return this._stats;
  }

  /** The member's latest purchases, newest first, once loaded (see `loadPurchases`). */
  get purchases() {
    return this._purchases;
  }

  /** What one round of `ride` costs (the server's table once it's in, the usual prices until then). */
  cost(ride: AttractionId) {
    return this._tickets?.costs?.[ride] ?? DEFAULT_COSTS[ride];
  }

  /** Milliseconds until the next pack can be bought: 0 when it can be now, null when unknown. */
  msUntilPurchase(now = Date.now()) {
    const t = this._tickets;
    if (!t) return null;
    const next = t.nextPurchaseAt ? Date.parse(t.nextPurchaseAt) : NaN;
    if (Number.isNaN(next)) return t.canBuy || !t.nextPurchaseAt ? 0 : null;
    return Math.max(0, next - now);
  }

  /** Calls `fn` whenever the user, their tickets or their stats change. Returns an unsubscribe. */
  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Asks the server who we are. Never throws: a 401, or no server at all, means a guest. */
  async refresh(attempt = 0): Promise<User | null> {
    try {
      const { user } = await api.me();
      this.set(user);
    } catch (err) {
      if (err instanceof ApiError && err.unavailable) {
        this.warnOnce(err);
        if (attempt < RETRY_MS.length && !this._user) setTimeout(() => void this.refresh(attempt + 1), RETRY_MS[attempt]);
      }
      if (!this._known || (err instanceof ApiError && err.status === 401)) this.set(null);
    }
    return this._user;
  }

  /** Signing up means accepting the Terms and the Privacy Policy (the dialog's checkbox). */
  async signup(body: { email: string; username: string; password: string }) {
    const { user } = await api.signup({ ...body, acceptTerms: true });
    this.set(user);
    return user;
  }

  async login(body: { email: string; password: string }) {
    const { user } = await api.login(body);
    this.set(user);
    return user;
  }

  /** Logs out here even if the server can't be told (the cookie then expires on its own). */
  async logout() {
    try {
      await api.logout();
    } catch (err) {
      if (err instanceof ApiError) this.warnOnce(err);
    }
    this.set(null);
  }

  /** The server no longer accepts our cookie: carry on as a guest. */
  expire() {
    this.set(null);
  }

  /** Fetches the member's wallet. Resolves to null for guests or when the server is away. */
  loadTickets() {
    const user = this._user;
    if (!user) return Promise.resolve(null);
    // the booth, the HUD and a gate may all ask at once: one request answers them all
    if (this.ticketsLoading?.id === user.id) return this.ticketsLoading.p;
    const p = this.guard(api.tickets())
      .then((tickets) => {
        if (!tickets || this._user?.id !== user.id) return null;
        this._tickets = tickets;
        this.emit();
        return tickets;
      })
      .finally(() => {
        if (this.ticketsLoading?.p === p) this.ticketsLoading = null;
      });
    this.ticketsLoading = { id: user.id, p };
    return p;
  }

  /** Fetches the member's rounds and bests. Resolves to null for guests or when the server is away. */
  async loadStats() {
    const id = this._user?.id;
    if (!id) return null;
    const stats = await this.guard(api.stats());
    if (!stats || this._user?.id !== id) return null;
    this._stats = stats;
    this.emit();
    return stats;
  }

  /** Fetches the member's latest purchases. Resolves to null for guests or when the server is away. */
  async loadPurchases() {
    const id = this._user?.id;
    if (!id) return null;
    const res = await this.guard(api.purchases(RECENT_PURCHASES));
    if (!res || this._user?.id !== id) return null;
    this._purchases = res.purchases.slice(0, RECENT_PURCHASES);
    this.emit();
    return this._purchases;
  }

  /**
   * Buys a pack. Throws an ApiError (a PurchaseCooldownError if the next pack isn't due yet, which
   * also updates the countdown here).
   */
  async buy() {
    try {
      const res = await api.purchase();
      const prev = this._tickets;
      this._tickets = {
        balance: res.balance,
        packSize: prev?.packSize ?? res.purchase.quantity,
        cooldownHours: prev?.cooldownHours ?? COOLDOWN_HOURS,
        lastPurchaseAt: res.purchase.createdAt,
        nextPurchaseAt: res.nextPurchaseAt,
        canBuy: res.canBuy,
        costs: prev?.costs ?? DEFAULT_COSTS,
      };
      this._purchases = [{ ...res.purchase, balanceAfter: res.balance }, ...(this._purchases ?? [])].slice(0, RECENT_PURCHASES);
      this.emit();
      return res;
    } catch (err) {
      if (err instanceof PurchaseCooldownError && this._tickets) {
        this._tickets = { ...this._tickets, canBuy: false, nextPurchaseAt: err.nextPurchaseAt ?? this._tickets.nextPurchaseAt };
        this.emit();
      }
      if (err instanceof ApiError && err.status === 401) this.expire();
      throw err;
    }
  }

  /**
   * Pays for a round of `ride` and opens it. Throws an ApiError (a NotEnoughTicketsError when the
   * wallet is short, which also corrects the balance here).
   */
  async board(ride: AttractionId) {
    try {
      const res = await api.board(ride);
      if (this._tickets) this._tickets = { ...this._tickets, balance: res.balance };
      else void this.loadTickets();
      this.emit();
      return res;
    } catch (err) {
      if (err instanceof NotEnoughTicketsError && err.balance !== null && this._tickets) {
        this._tickets = { ...this._tickets, balance: err.balance };
        this.emit();
      }
      throw err;
    }
  }

  /** Closes a round with its stats. Throws an ApiError when it can't be saved. */
  async finish(roundId: string, completed: boolean, stats: RoundStats): Promise<FinishedRound> {
    const res = await api.finish(roundId, { completed, stats });
    // the totals and bests changed: refresh them quietly if anything shows them
    if (this._stats) void this.loadStats();
    return res;
  }

  /** Downloads everything the fair keeps about the member. Throws an ApiError. */
  exportData() {
    return api.exportData();
  }

  /** Deletes the account for good, then carries on as a guest. Throws an ApiError (401 = wrong password). */
  async deleteAccount(password: string) {
    await api.deleteAccount(password);
    this.set(null);
  }

  /** Resolves a member-only request, or null when it fails (a 401 also drops back to guest). */
  private async guard<T>(p: Promise<T>): Promise<T | null> {
    try {
      return await p;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.expire();
      return null;
    }
  }

  private set(user: User | null) {
    const switched = user?.id !== this._user?.id;
    const changed = !this._known || switched || user?.username !== this._user?.username;
    if (switched) {
      this._tickets = null;
      this._stats = null;
      this._purchases = null;
    }
    this._user = user;
    this._known = true;
    if (changed) this.emit();
    // a new member: their wallet shows in the HUD straight away
    if (switched && user) void this.loadTickets();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private warnOnce(err: ApiError) {
    if (this.warned) return;
    this.warned = true;
    console.warn(`The Funfair: the accounts server is unavailable (${err.status || 'offline'}), so the attractions are closed for now.`);
  }
}

export const session = new Session();

/** "03:12:45" for a wait of that long (the booth's countdown to the next pack). */
export function formatWait(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
