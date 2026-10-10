// The Rally Trail's daily leaderboard, as the game shows it: today's top ten and where the member
// stands, on the trail's boards, its HUD and its card. A board runs from noon to noon, Beirut time,
// and a new one starts empty at 12:00 (the old ones stay on the server, for the office). The board
// is fetched again when someone posts a time (the live stream says so), when it turns over, and
// when someone signs in or out (so "you" is right).
import { api, type TrailBoard, type TrailEntry } from './api';
import { session } from './session';
import { trailTime } from './stats';
import { escapeHtml } from '../world/ui';

/** A burst of new times (or the stream's word arriving twice) is one fetch at most this often. */
const MIN_GAP_MS = 1500;
/** After the turnover, ask a moment late so the server's clock is past it too. */
const TURNOVER_SLACK_MS = 1500;
/** The server couldn't be reached (with no board yet, or only one that has turned over): ask again after this long, then less often. */
const RETRY_MS = [5_000, 10_000, 30_000, 60_000];

/**
 * How far the server's clock is ahead of this one (ms): the turnover and every countdown follow the
 * server's, so a visitor whose clock is off neither sees yesterday's board nor asks for it in a loop.
 */
let skew = 0;
/** Milliseconds from now (on the server's clock) until `iso`, never below 0. */
export const msUntil = (iso: string) => Math.max(0, Date.parse(iso) - (Date.now() + skew));

type Listener = (board: TrailBoard | null) => void;

class Leaderboard {
  private _board: TrailBoard | null = null;
  private listeners = new Set<Listener>();
  private inFlight: Promise<TrailBoard | null> | null = null;
  private again = false;
  private lastAt = 0;
  private later: ReturnType<typeof setTimeout> | null = null;
  private turnover: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private userId: string | null | undefined = undefined;

  constructor() {
    session.onLeaderboard(() => void this.load());
    session.onChange(() => {
      const id = session.user?.id ?? null;
      if (id === this.userId) return;
      const first = this.userId === undefined;
      this.userId = id;
      if (!first && this._board) void this.load();
    });
  }

  /** Today's board, once it's in (null while the server is away). */
  get board() {
    return this._board;
  }

  /** Calls `fn` with each new board. Returns an unsubscribe. */
  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Fetches the board (never throws: an unreachable server keeps the last one). */
  load(): Promise<TrailBoard | null> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const wait = this.lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      this.later ??= setTimeout(() => {
        this.later = null;
        void this.load();
      }, wait);
      return Promise.resolve(this._board);
    }
    this.lastAt = Date.now();
    const p = api
      .trailBoard()
      .then(
        (board) => this.set(board),
        () => {
          // nothing to show (the server's away, or starting), or the board on show has turned over: look again in a while
          if (!this._board || this.msUntilReset() === 0) this.askAgainLater();
          return this._board;
        },
      )
      .finally(() => {
        this.inFlight = null;
        if (this.again) {
          this.again = false;
          void this.load();
        }
      });
    return (this.inFlight = p);
  }

  /** Milliseconds until the board turns over (null before it's in). */
  msUntilReset() {
    return this._board ? msUntil(this._board.resetsAt) : null;
  }

  /** Another try after a growing pause (5 s, 10 s, 30 s, then every minute). */
  private askAgainLater() {
    this.retry ??= setTimeout(() => {
      this.retry = null;
      void this.load();
    }, RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)]);
  }

  private set(board: TrailBoard) {
    if (board.now) skew = Date.parse(board.now) - Date.now();
    this._board = board;
    if (this.turnover) clearTimeout(this.turnover);
    const ms = msUntil(board.resetsAt);
    if (ms > 0) {
      // a fresh, empty board at noon (Beirut): fetch it then, without waiting for someone to post a time
      this.retries = 0;
      this.turnover = setTimeout(() => void this.load(), Math.min(ms, 2 ** 31 - 1) + TURNOVER_SLACK_MS);
    } else this.askAgainLater(); // still the old one (the server's a moment behind): ask again shortly, not in a loop
    for (const fn of this.listeners) fn(board);
    return board;
  }
}

export const leaderboard = new Leaderboard();

export { trailTime };

/** How long until the board turns over: "3 h 12 min", "12 min", "under a minute". */
export function resetIn(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

/** "12:00 Beirut" and what that is on the visitor's own clock, e.g. "(13:00 your time)" (left out when it's the same). */
export function resetClock(board: TrailBoard) {
  const at = new Date(board.resetsAt);
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const there = at.toLocaleTimeString('en-GB', { ...opts, timeZone: board.timeZone });
  const here = at.toLocaleTimeString('en-GB', opts);
  return here === there ? `${there} Beirut time` : `${there} Beirut time (${here} your time)`;
}

const MEDALS = ['🥇', '🥈', '🥉'];
export const medal = (rank: number) => MEDALS[rank - 1] ?? `${rank}.`;

/**
 * The board as a list: the top `limit`, and the member's own row under it when they're further
 * down. `mine` marks a time not on the board yet (a run just finished, before the server has it).
 */
export function boardListHtml(board: TrailBoard | null, limit = 10, empty = 'No times yet today. Be the first! 🏁') {
  if (!board) return `<p class="lb-empty">The leaderboard is on its way…</p>`;
  const row = (e: TrailEntry) =>
    `<li class="${e.me ? 'is-me' : ''}"><b>${medal(e.rank)}</b><span>${escapeHtml(e.username)}${e.me ? ' (you)' : ''}</span><em>${trailTime(e.timeMs)}</em></li>`;
  const top = board.entries.slice(0, limit);
  if (!top.length) return `<p class="lb-empty">${empty}</p>`;
  const me = board.me && board.me.rank > limit ? `<li class="lb-gap" aria-hidden="true">⋯</li>${row({ ...board.me, me: true })}` : '';
  return `<ol class="lb-list">${top.map(row).join('')}${me}</ol>`;
}

/** Where `ms` would land on the board as it stands (1 = fastest), counting the member's own best only once. */
export function rankFor(board: TrailBoard, ms: number) {
  const others = board.entries.filter((e) => !e.me && e.timeMs <= ms).length;
  // past the top ten, all we know is that it's further down
  return others >= board.entries.filter((e) => !e.me).length && board.players > board.entries.length ? null : others + 1;
}
