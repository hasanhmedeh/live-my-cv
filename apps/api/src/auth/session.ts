import type { CookieOptions } from 'express';

/** The httpOnly cookie that carries the session JWT. */
export const SESSION_COOKIE = 'funfair_session';

/** Sessions (the JWT and the cookie alike) last 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Shared by set and clear: a cookie only clears when name, path and flags match. */
export function sessionCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: production };
}

/** The JWT body: just the user id. */
export interface SessionPayload {
  sub: string;
}
