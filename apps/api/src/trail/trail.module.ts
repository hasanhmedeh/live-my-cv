import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TrailController } from './trail.controller.js';
import { TrailService } from './trail.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TrailController],
  providers: [TrailService],
  exports: [TrailService],
})
export class TrailModule {}
