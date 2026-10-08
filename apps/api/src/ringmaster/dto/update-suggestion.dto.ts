import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SuggestionStatus } from '../../generated/prisma/client.js';
import { tidyText } from '../../suggestions/dto/text.js';
import { SUGGESTION_MAX } from '../../suggestions/suggestion-json.js';

/** PATCH /ringmaster/suggestions/:id: where it stands, and staff's answer. Left out means unchanged. */
export class UpdateSuggestionDto {
  /** Can be changed as often as needed (accepted, then in development, then done). */
  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;

  /** The answer to the member. Only once: a suggestion already answered gets a 409. */
  @Transform(tidyText)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Write the reply first' })
  @MaxLength(SUGGESTION_MAX, { message: `Keep the reply to ${SUGGESTION_MAX} characters` })
  reply?: string;
}
