import { Controller, Get } from '@nestjs/common';
import { ParkService, type PublicPark } from './park.service.js';

/** The gates: open or closed, what is under maintenance, and the prices. No account needed. */
@Controller('park')
export class ParkController {
  constructor(private readonly park: ParkService) {}

  @Get()
  status(): Promise<PublicPark> {
    return this.park.publicPark();
  }
}
