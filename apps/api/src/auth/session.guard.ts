import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from './session.js';

/** A request that passed SessionGuard. */
export interface AuthedRequest extends Request {
  user: User;
}

/** Lets a request through only with a valid session cookie for a user that still exists. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const token: unknown = request.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Sign up or log in first');

    const user = await this.auth.userFromToken(token);
    if (!user) {
      // Drop the dead cookie so the client stops sending it.
      const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
      http.getResponse<Response>().clearCookie(SESSION_COOKIE, sessionCookieOptions(production));
      throw new UnauthorizedException('Your session has expired, please log in again');
    }

    (request as AuthedRequest).user = user;
    return true;
  }
}
