import { Global, Module } from '@nestjs/common';
import { ParkController } from './park.controller.js';
import { ParkService } from './park.service.js';

/** Global: boarding, the Ticket Booth and The Ringmaster's Office all read the live rules. */
@Global()
@Module({
  controllers: [ParkController],
  providers: [ParkService],
  exports: [ParkService],
})
export class ParkModule {}
