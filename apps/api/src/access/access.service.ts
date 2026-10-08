import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AllowedIp } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { allowlist, normalizeIp } from './allowlist.js';

/** Private access as it stands: the switch, the list, and a test against it. */
export interface AccessRules {
  /** Only the addresses on the list may reach the site. */
  on: boolean;
  entries: AllowedIp[];
  allows: (ip: string | null) => boolean;
}

/**
 * How long one read is used on this instance. A change made through this instance (or announced
 * while its live stream listens) is seen at once; elsewhere it takes this long at most.
 */
const CACHE_MS = 5_000;

export const IP_BLOCKED_MESSAGE = 'The fair is private right now: only invited visitors can come in.';

/**
 * The visitor's address. On Vercel the edge sets x-real-ip, overwriting any sent by the browser,
 * and the page middleware reads the same header, so both agree on who's knocking. Elsewhere
 * Express's req.ip, which honours TRUST_PROXY.
 */
export function clientIp(req: Request): string | null {
  const vercel = process.env.VERCEL ? req.headers['x-real-ip'] : undefined;
  return normalizeIp(typeof vercel === 'string' ? vercel : req.ip);
}

/** Private access: whether the site is open to the allowed addresses only, and which those are. */
@Injectable()
export class AccessService {
  private cached: { at: number; rules: Promise<AccessRules> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  rules(): Promise<AccessRules> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.rules;
    const rules = this.read();
    this.cached = { at: Date.now(), rules };
    // a failed read isn't kept: the next request tries again
    rules.catch(() => {
      if (this.cached?.rules === rules) this.cached = null;
    });
    return rules;
  }

  /** The switch or the list changed: read them again next time. */
  forget() {
    this.cached = null;
  }

  /** 403 ip_blocked unless private access is off, or `ip` is on the list. */
  async assertAllowed(ip: string | null): Promise<void> {
    const rules = await this.rules();
    if (rules.on && !rules.allows(ip)) throw blocked(ip);
  }

  private async read(): Promise<AccessRules> {
    const [settings, entries] = await Promise.all([
      this.prisma.parkSettings.findUnique({ where: { id: 1 }, select: { allowlistOnly: true } }),
      this.prisma.allowedIp.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    return { on: settings?.allowlistOnly ?? false, entries, allows: allowlist(entries.map((e) => e.ip)) };
  }
}

/** 403 with a `code` the web client recognises, so it shows the private sign rather than "no access". */
export function blocked(ip: string | null) {
  return new HttpException(
    { ...HttpException.createBody(IP_BLOCKED_MESSAGE, 'Forbidden', HttpStatus.FORBIDDEN), code: 'ip_blocked', ip },
    HttpStatus.FORBIDDEN,
  );
}
