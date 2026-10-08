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

// ---------- Continue with Google ----------
// Two short-lived cookies, signed like the session but typed (`typ`) and without `sub`, so neither
// can ever pass for a session.

/** Holds the state and PKCE verifier between leaving for Google and coming back. */
export const GOOGLE_STATE_COOKIE = 'funfair_google_state';
export const GOOGLE_STATE_TTL_SECONDS = 10 * 60;

export interface GoogleStatePayload {
  typ: 'google-state';
  state: string;
  verifier: string;
  redirectUri: string;
  /** Started from a popup: the callback answers with a page that tells the game and closes. */
  popup: boolean;
}

/** A Google account with no fair account yet: who it is, until they pick a username and finish. */
export const GOOGLE_SIGNUP_COOKIE = 'funfair_google_signup';
export const GOOGLE_SIGNUP_TTL_SECONDS = 30 * 60;

export interface GoogleSignupPayload {
  typ: 'google-signup';
  googleId: string;
  email: string;
  name: string | null;
}

/** Only sent to the Google routes. */
export function googleCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/api/auth/google', secure: production };
}
