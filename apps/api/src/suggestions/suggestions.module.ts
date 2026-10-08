import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
