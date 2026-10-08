import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LiveController } from './live.controller.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
