import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SuggestionTopic } from '../../generated/prisma/client.js';
import { SUGGESTION_MAX } from '../suggestion-json.js';
import { tidyText } from './text.js';

/** POST /suggestions: what it's about, and what the member has to say. */
export class CreateSuggestionDto {
  @IsEnum(SuggestionTopic)
  topic!: SuggestionTopic;

  @Transform(tidyText)
  @IsString()
  @IsNotEmpty({ message: 'Write your idea first' })
  @MaxLength(SUGGESTION_MAX, { message: `Keep it to ${SUGGESTION_MAX} characters` })
  message!: string;
}
