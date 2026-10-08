import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { minutes, ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SESSION_TTL_SECONDS } from './session.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // Applied per route with @UseGuards(AuthThrottlerGuard): signup, login and account deletion
    // (each asks for a password), 10 a minute per IP each.
    // Left unnamed so the 429 carries the standard Retry-After header (named ones get a suffix).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: minutes(1), limit: 10 }] }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccountService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
