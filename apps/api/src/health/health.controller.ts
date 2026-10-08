import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 200 when the API can reach Postgres, 503 when it can't. */
  @Get()
  async check(): Promise<{ ok: true; db: 'up' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return { ok: true, db: 'up' };
  }
}
