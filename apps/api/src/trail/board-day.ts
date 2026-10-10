/**
 * The Rally Trail's leaderboard days. A board runs from noon to noon, Beirut time, and is named for
 * the date it started on: at 10:00 on 10 October in Beirut, the board open is 2026-10-09's (from
 * noon on the 9th to noon on the 10th). Lebanon moves its clocks at midnight, never near noon, so a
 * board is always 24 hours long except across a clock change, when it's 23 or 25.
 */
export const BOARD_TIME_ZONE = 'Asia/Beirut';
export const BOARD_RESET_HOUR = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOARD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** What the clocks in Beirut read at `at`. */
function wall(at: Date) {
  const parts = Object.fromEntries(wallClock.formatToParts(at).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second };
}

/** Beirut's offset from UTC at `at`, in milliseconds (+2 h in winter, +3 h in summer). */
function offsetMs(at: Date) {
  const w = wall(at);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The board open at `at`: "2026-10-09". */
export function boardDay(at: Date = new Date()): string {
  const w = wall(at);
  const date = Date.UTC(w.y, w.m - 1, w.d);
  return iso(w.h < BOARD_RESET_HOUR ? date - DAY_MS : date);
}

/** The day after (or `n` days after, or before) `day`. */
export const addDays = (day: string, n: number) => iso(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** When `day`'s board opened: noon in Beirut on that date. */
export function boardStart(day: string): Date {
  const noon = Date.parse(`${day}T${String(BOARD_RESET_HOUR).padStart(2, '0')}:00:00Z`);
  // the offset at about that moment, then once more at the moment it gives (exact, clock changes and all)
  const first = noon - offsetMs(new Date(noon));
  return new Date(noon - offsetMs(new Date(first)));
}

/** When `day`'s board closes (and the next one opens). */
export const boardEnd = (day: string) => boardStart(addDays(day, 1));

/** `day` as the value of a DATE column (midnight UTC, as Prisma reads and writes them). */
export const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** True for a well-formed "YYYY-MM-DD" that is a real date. */
export function isDay(value: string) {
  const m = DAY.exec(value);
  return !!m && iso(Date.UTC(+m[1], +m[2] - 1, +m[3])) === value;
}
