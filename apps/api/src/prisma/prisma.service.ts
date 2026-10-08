import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** host:port/database, for log messages (never the password). */
  private readonly target: string;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('DATABASE_URL', { infer: true });
    super({
      adapter: new PrismaPg({
        connectionString: url,
        // Fail fast (health check -> 503) instead of hanging when Postgres is down.
        connectionTimeoutMillis: 5_000,
      }),
    });
    const { host, pathname } = new URL(url);
    this.target = host + pathname;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // The pg adapter connects lazily, so ping once: a wrong DATABASE_URL shows up at startup rather
    // than on the first request. Not fatal, the API recovers once Postgres is reachable.
    try {
      await this.$queryRaw`SELECT 1`;
    } catch {
      this.logger.warn(
        `Can't reach PostgreSQL at ${this.target}. Is it running, and is DATABASE_URL in apps/api/.env right? ` +
          '/api/health answers 503 until it is.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
