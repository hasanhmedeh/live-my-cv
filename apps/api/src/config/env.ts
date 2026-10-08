/** The API's settings, validated once at startup. See .env.example for what each one does. */
export interface Env {
  DATABASE_URL: string;
  /**
   * A direct (unpooled) connection, for LISTEN: live updates need a session, which a transaction
   * pooler like Neon's doesn't keep. Falls back to DATABASE_URL.
   */
  DATABASE_URL_UNPOOLED: string;
  JWT_SECRET: string;
  PORT: number;
  /** Origins allowed to call the API cross-site with cookies. */
  WEB_ORIGIN: string[];
  NODE_ENV: 'development' | 'production' | 'test';
  /** Express "trust proxy" value, so req.ip (and rate limiting) sees the visitor behind a proxy. */
  TRUST_PROXY: boolean | number | string;
  /** "Continue with Google", or null while it isn't set up (the button stays hidden). */
  GOOGLE: GoogleConfig | null;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Where Google sends people back. Null: worked out from each request (https://<host>/api/auth/google/callback). */
  redirectUri: string | null;
}

const NODE_ENVS = ['development', 'production', 'test'] as const;
const PLACEHOLDER_SECRET = 'replace-me-with-a-long-random-string';

/** Every configuration problem at once, so they can all be fixed in one go. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        "The Funfair API can't start, its configuration needs attention:",
        ...problems.map((p) => `  - ${p}`),
        '',
        'Copy apps/api/.env.example to apps/api/.env and fill in the values (or set them in the environment).',
      ].join('\n'),
    );
    this.name = 'EnvError';
  }
}

/** Checks the raw environment and returns typed settings, or throws an EnvError listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');

  const databaseUrl = str('DATABASE_URL');
  if (!databaseUrl) problems.push('DATABASE_URL is missing.');
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgresql:// connection string.');
  }

  const unpooledUrl = str('DATABASE_URL_UNPOOLED');
  if (unpooledUrl && !/^postgres(ql)?:\/\//.test(unpooledUrl)) problems.push('DATABASE_URL_UNPOOLED must be a postgresql:// connection string.');

  const jwtSecret = str('JWT_SECRET');
  if (!jwtSecret) problems.push('JWT_SECRET is missing.');
  else if (jwtSecret === PLACEHOLDER_SECRET) problems.push('JWT_SECRET is still the placeholder from .env.example.');
  else if (jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters long.');

  const port = Number(str('PORT') || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a whole number between 1 and 65535.');

  const webOrigin = (str('WEB_ORIGIN') || 'http://localhost:5173').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  for (const origin of webOrigin) {
    if (!isOrigin(origin)) problems.push(`WEB_ORIGIN "${origin}" is not an origin like https://example.com (no path).`);
  }

  const nodeEnv = str('NODE_ENV') || 'development';
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnv)) problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}.`);

  const googleId = str('GOOGLE_CLIENT_ID');
  const googleSecret = str('GOOGLE_CLIENT_SECRET');
  const googleRedirect = str('GOOGLE_REDIRECT_URI');
  if (!!googleId !== !!googleSecret) problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together: set both, or neither.');
  if (googleRedirect && !/^https?:\/\/[^/]+\/.*\/auth\/google\/callback$/.test(googleRedirect))
    problems.push('GOOGLE_REDIRECT_URI must be a full URL ending in /api/auth/google/callback.');

  if (problems.length > 0) throw new EnvError(problems);

  return {
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: unpooledUrl || databaseUrl,
    JWT_SECRET: jwtSecret,
    PORT: port,
    WEB_ORIGIN: webOrigin,
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    TRUST_PROXY: parseTrustProxy(str('TRUST_PROXY') || 'loopback'),
    GOOGLE: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret, redirectUri: googleRedirect || null } : null,
  };
}

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** "true"/"false" -> boolean, "2" -> hop count, anything else (addresses, "loopback") passes through. */
function parseTrustProxy(value: string): Env['TRUST_PROXY'] {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
