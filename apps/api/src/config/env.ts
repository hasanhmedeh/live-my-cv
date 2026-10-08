/** The API's settings, validated once at startup. See .env.example for what each one does. */
export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  PORT: number;
  /** Origins allowed to call the API cross-site with cookies. */
  WEB_ORIGIN: string[];
  NODE_ENV: 'development' | 'production' | 'test';
  /** Express "trust proxy" value, so req.ip (and rate limiting) sees the visitor behind a proxy. */
  TRUST_PROXY: boolean | number | string;
}

const NODE_ENVS = ['development', 'production', 'test'] as const;
const PLACEHOLDER_SECRET = 'replace-me-with-a-long-random-string';

/**
 * Checks the raw environment and returns typed settings. On any problem it prints every issue
 * at once with a hint, then exits: a stack trace is no help for a missing .env file.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const problems: string[] = [];
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');

  const databaseUrl = str('DATABASE_URL');
  if (!databaseUrl) problems.push('DATABASE_URL is missing.');
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgresql:// connection string.');
  }

  const jwtSecret = str('JWT_SECRET');
  if (!jwtSecret) problems.push('JWT_SECRET is missing.');
  else if (jwtSecret === PLACEHOLDER_SECRET) problems.push('JWT_SECRET is still the placeholder from .env.example.');
  else if (jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters long.');

  const port = Number(str('PORT') || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a whole number between 1 and 65535.');

  const webOrigin = (str('WEB_ORIGIN') || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);
  for (const origin of webOrigin) {
    if (!isOrigin(origin)) problems.push(`WEB_ORIGIN "${origin}" is not an origin like https://example.com (no path).`);
  }

  const nodeEnv = str('NODE_ENV') || 'development';
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnv)) problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}.`);

  if (problems.length > 0) {
    console.error(
      [
        '',
        "The Funfair API can't start, its configuration needs attention:",
        ...problems.map((p) => `  - ${p}`),
        '',
        'Copy apps/api/.env.example to apps/api/.env and fill in the values (or set them in the environment).',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  return {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    PORT: port,
    WEB_ORIGIN: webOrigin,
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    TRUST_PROXY: parseTrustProxy(str('TRUST_PROXY') || 'loopback'),
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
