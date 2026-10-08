import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Env, GoogleConfig } from '../config/env.js';
import type { GoogleIdentity } from './auth.service.js';
import {
  GOOGLE_SIGNUP_TTL_SECONDS,
  GOOGLE_STATE_TTL_SECONDS,
  type GoogleSignupPayload,
  type GoogleStatePayload,
} from './session.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TIMEOUT_MS = 8_000;

/** Something went wrong on the way back from Google; `message` is safe to show the visitor. */
export class GoogleSignInError extends Error {
  override name = 'GoogleSignInError';
}

/**
 * "Continue with Google": OpenID Connect's authorization code flow, with PKCE and a state value
 * held in a signed cookie. The ID token comes straight from Google's token endpoint over TLS, so
 * (as OpenID Connect allows for that case) its claims are checked rather than its signature.
 */
@Injectable()
export class GoogleService {
  private readonly config: GoogleConfig | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
  ) {
    this.config = config.get('GOOGLE', { infer: true });
  }

  get enabled() {
    return this.config !== null;
  }

  /**
   * Where Google sends people back: GOOGLE_REDIRECT_URI, or this site's own callback, as the browser
   * sees the site (behind the Vite proxy or Vercel, the forwarded host). A forged header gains
   * nothing: Google only redirects to URIs registered with the client.
   */
  redirectUri(req: Request): string {
    if (this.config?.redirectUri) return this.config.redirectUri;
    const first = (h: string | undefined) => h?.split(',')[0]?.trim() || undefined;
    const proto = first(req.get('x-forwarded-proto')) ?? req.protocol;
    const host = first(req.get('x-forwarded-host')) ?? req.get('host');
    return `${proto}://${host}/api/auth/google/callback`;
  }

  /** The Google sign-in page to send the visitor to, and the signed state for the cookie. */
  async start(redirectUri: string, popup: boolean): Promise<{ url: string; state: string }> {
    const config = this.require();
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      // let people with several Google accounts pick one, rather than signing in with the last one
      prompt: 'select_account',
    }).toString();
    const payload: GoogleStatePayload = { typ: 'google-state', state, verifier, redirectUri, popup };
    return { url: url.toString(), state: await this.jwt.signAsync(payload, { expiresIn: GOOGLE_STATE_TTL_SECONDS }) };
  }

  /** The state cookie's contents, or null if it is missing, forged or expired. */
  async readState(token: unknown): Promise<GoogleStatePayload | null> {
    const p = await this.verify<GoogleStatePayload>(token);
    return p?.typ === 'google-state' ? p : null;
  }

  /** Trades the code Google sent back for who the visitor is. Throws a GoogleSignInError. */
  async identify(code: string, state: GoogleStatePayload): Promise<GoogleIdentity> {
    const config = this.require();
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: state.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: state.verifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GoogleSignInError("Couldn't reach Google. Please try again.");
    }
    const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
    if (!res.ok || typeof body?.id_token !== 'string') {
      console.error(`Google token exchange failed (${res.status}): ${String(body?.error ?? 'no id_token')}`);
      throw new GoogleSignInError('Google sign-in didn’t go through. Please try again.');
    }

    const claims = decodeClaims(body.id_token);
    const now = Date.now() / 1000;
    const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (
      !claims ||
      !ISSUERS.includes(String(claims.iss)) ||
      !audience.includes(config.clientId) ||
      typeof claims.exp !== 'number' ||
      claims.exp < now - 60 ||
      typeof claims.sub !== 'string' ||
      !claims.sub
    ) {
      throw new GoogleSignInError('Google sign-in didn’t go through. Please try again.');
    }
    if (typeof claims.email !== 'string' || !claims.email || (claims.email_verified !== true && claims.email_verified !== 'true'))
      throw new GoogleSignInError('Your Google account needs a verified email address to sign in here.');
    const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null;
    return { googleId: claims.sub, email: claims.email.trim().toLowerCase(), name };
  }

  /** The cookie for a Google identity that has no account yet. */
  signSignup(identity: GoogleIdentity): Promise<string> {
    const payload: GoogleSignupPayload = { typ: 'google-signup', ...identity };
    return this.jwt.signAsync(payload, { expiresIn: GOOGLE_SIGNUP_TTL_SECONDS });
  }

  /** The pending signup's identity, or null if the cookie is missing, forged or expired. */
  async readSignup(token: unknown): Promise<GoogleSignupPayload | null> {
    const p = await this.verify<GoogleSignupPayload>(token);
    return p?.typ === 'google-signup' && typeof p.googleId === 'string' && typeof p.email === 'string' ? p : null;
  }

  private async verify<T extends object>(token: unknown): Promise<T | null> {
    if (typeof token !== 'string' || !token) return null;
    try {
      return await this.jwt.verifyAsync<T>(token);
    } catch {
      return null;
    }
  }

  private require(): GoogleConfig {
    if (!this.config) throw new GoogleSignInError('Signing in with Google isn’t available yet.');
    return this.config;
  }
}

/** The claims in a JWT's payload (not verified: see the class comment). */
function decodeClaims(jwt: string): Record<string, unknown> | null {
  try {
    const claims: unknown = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
