import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { isStaff } from '../park/park.service.js';
import type { AuthedRequest } from '../auth/session.guard.js';

/** After SessionGuard: lets staff (role admin) through, and answers 403 to everyone else. */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthedRequest>();
    if (user && isStaff(user)) return true;
    throw new ForbiddenException("Staff only: this is The Ringmaster's Office");
  }
}
