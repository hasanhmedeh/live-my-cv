import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TrailModule } from '../trail/trail.module.js';
import { RidesController } from './rides.controller.js';
import { RidesService } from './rides.service.js';

@Module({
  imports: [AuthModule, TrailModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
