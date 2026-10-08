import { createParamDecorator, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessService, clientIp } from './access.service.js';

const OPEN_TO_ALL = 'access:open-to-all';

/** A route anyone may reach even while the site is private (the health check, for uptime monitors). */
export const OpenToAll = () => SetMetadata(OPEN_TO_ALL, true);

/** The caller's address, as private access sees it (see clientIp). */
export const ClientIp = createParamDecorator((_: unknown, context: ExecutionContext) => clientIp(context.switchToHttp().getRequest<Request>()));

/**
 * Runs before every route (registered globally by AccessModule): while the site is private, a
 * visitor whose address isn't on the list gets a 403 ip_blocked, staff or not.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly access: AccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(OPEN_TO_ALL, [context.getHandler(), context.getClass()])) return true;
    await this.access.assertAllowed(clientIp(context.switchToHttp().getRequest<Request>()));
    return true;
  }
}
