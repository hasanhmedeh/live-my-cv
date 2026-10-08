import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { AccessService } from './access.service.js';

/** Global: the guard runs before every route, and the office and the live stream read the list too. */
@Global()
@Module({
  providers: [AccessService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [AccessService],
})
export class AccessModule {}
