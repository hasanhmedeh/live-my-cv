import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RidesModule } from './rides/rides.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // apps/api/.env, wherever the process was started from. Real env vars win over the file.
      envFilePath: path.join(import.meta.dirname, '..', '.env'),
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    TicketsModule,
    RidesModule,
    HealthModule,
  ],
})
export class AppModule {}
