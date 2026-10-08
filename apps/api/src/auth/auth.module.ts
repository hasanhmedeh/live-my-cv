import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
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
  ],
  controllers: [AuthController],
  // AuthThrottlerGuard is a provider (one instance, one set of counters) applied per route with
  // @UseGuards: signup, login and account deletion, each asking for a password.
  providers: [AuthService, AccountService, SessionGuard, AuthThrottlerGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
