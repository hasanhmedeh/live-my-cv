// Private access for the pages: the Vercel middleware (apps/web/middleware.js) asks here before
// serving the game, the legal pages or The Ringmaster's Office. The API guards itself (AccessGuard);
// this is the same rule for the files the CDN serves without it. Plain pg, no Nest: it runs in the
// middleware, before any function.
import pg from 'pg';
import { allowlist, normalizeIp } from './allowlist.js';

/** How long one read of the switch and the list is used. A change in the office takes this long at most to reach the pages. */
const CACHE_MS = 5_000;

interface Rules {
  on: boolean;
  allows: (ip: string | null) => boolean;
}

let pool: pg.Pool | null = null;
let cached: { at: number; rules: Rules } | null = null;
let loading: Promise<Rules> | null = null;

/**
 * Whether the visitor at `ip` may come in: always while private access is off, and only from an
 * address on the list while it's on. If the database can't be read the last known rules hold, and
 * with none yet the visitor is let in: the API (which can't answer without the database either)
 * still turns them away.
 */
export async function admits(rawIp: string | null): Promise<{ allowed: boolean; ip: string | null }> {
  const ip = normalizeIp(rawIp);
  const rules = await current();
  return { allowed: !rules?.on || rules.allows(ip), ip };
}

async function current(): Promise<Rules | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules;
  loading ??= read().finally(() => (loading = null));
  try {
    const rules = await loading;
    cached = { at: Date.now(), rules };
    return rules;
  } catch (err) {
    console.error(`Private access: can't read the allowlist: ${err instanceof Error ? err.message : String(err)}`);
    return cached?.rules ?? null;
  }
}

async function read(): Promise<Rules> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3_000 });
  const [settings, ips] = await Promise.all([
    pool.query<{ allowlist_only: boolean }>('SELECT allowlist_only FROM park_settings WHERE id = 1'),
    pool.query<{ ip: string }>('SELECT ip FROM allowed_ips'),
  ]);
  return { on: settings.rows[0]?.allowlist_only ?? false, allows: allowlist(ips.rows.map((r) => r.ip)) };
}
