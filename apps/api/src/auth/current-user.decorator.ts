import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '../generated/prisma/client.js';
import type { AuthedRequest } from './session.guard.js';

/** The signed-in user. Only valid on routes behind SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => context.switchToHttp().getRequest<AuthedRequest>().user,
);
