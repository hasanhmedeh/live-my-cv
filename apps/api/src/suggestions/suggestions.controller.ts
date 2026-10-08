import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { User } from '../generated/prisma/client.js';
import { CreateSuggestionDto } from './dto/create-suggestion.dto.js';
import type { SuggestionJson } from './suggestion-json.js';
import { SuggestionsService } from './suggestions.service.js';

/** The Idea Box: members leave suggestions for the park, and see staff's answers. Members only. */
@Controller('suggestions')
@UseGuards(SessionGuard)
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** The member's own suggestions, newest first, with `unread`: how many have news from staff. */
  @Get()
  mine(@CurrentUser() user: User): Promise<{ suggestions: SuggestionJson[]; total: number; unread: number }> {
    return this.suggestions.mine(user.id);
  }

  /** Leaves a suggestion. 429 with code 'suggestion_limit' (and `nextAt`) after a few in a day. */
  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateSuggestionDto): Promise<SuggestionJson> {
    return this.suggestions.create(user, body);
  }

  /** The member has seen staff's answers: nothing is unread any more. */
  @Post('seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  seen(@CurrentUser() user: User): Promise<void> {
    return this.suggestions.markSeen(user.id);
  }
}
