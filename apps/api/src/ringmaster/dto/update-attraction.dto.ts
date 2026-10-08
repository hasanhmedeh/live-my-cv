import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CLOSED_MESSAGE_MAX, TICKETS_RANGE } from '../../rides/attractions.js';
import { closedMessage } from './closed-message.js';

/** PATCH /ringmaster/attractions/:ride: its price, and whether it is running. Left out means unchanged. */
export class UpdateAttractionDto {
  /** Tickets per round. Rounds already played keep what they cost. */
  @IsOptional()
  @IsInt()
  @Min(TICKETS_RANGE.min)
  @Max(TICKETS_RANGE.max)
  tickets?: number;

  /** False closes it for maintenance. */
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  /** The sign shown while it is closed. Blank (or null) means the default wording. */
  @Transform(closedMessage)
  @IsOptional()
  @IsString()
  @MaxLength(CLOSED_MESSAGE_MAX)
  closedMessage?: string | null;
}
