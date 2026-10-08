import type { RideRound } from '../generated/prisma/client.js';

/**
 * Round statistics: a flat object of named numbers, e.g. { "topSpeedKmh": 92.4, "maxG": 3.1 }.
 * The game measures them in the browser, so they are informational only.
 */
export type Stats = Record<string, number>;

/** Per stat key, the lowest and highest value over a set of rounds. */
export type StatBests = Record<string, { min: number; max: number }>;

export const MAX_STAT_KEYS = 16;
export const STAT_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
export const MAX_STAT_MAGNITUDE = 1e9;

/**
 * Why `value` is not a valid stats object, or null when it is. Checks own keys only (symbols and
 * non-enumerable ones included) on a plain object, so arrays, class instances, nested objects,
 * numeric strings and NaN/Infinity are all refused.
 */
export function statsProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object of numbers';
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return 'must be a plain object';

  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_STAT_KEYS) return `may have at most ${MAX_STAT_KEYS} keys`;
  for (const key of keys) {
    if (typeof key !== 'string' || !STAT_KEY.test(key)) {
      return `key "${String(key).slice(0, 40)}" must start with a letter and contain only letters and digits (32 at most)`;
    }
    const stat: unknown = (value as Record<string, unknown>)[key];
    if (typeof stat !== 'number' || !Number.isFinite(stat)) return `value of "${key}" must be a finite number`;
    if (Math.abs(stat) > MAX_STAT_MAGNITUDE) return `value of "${key}" must be between -1e9 and 1e9`;
  }
  return null;
}

/** A round's stats column as written by finish, or null for rounds without any (abandoned, legacy). */
export function roundStats(round: Pick<RideRound, 'stats'>): Stats | null {
  return round.stats === null ? null : (round.stats as Stats);
}
