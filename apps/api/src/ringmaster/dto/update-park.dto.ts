import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CLOSED_MESSAGE_MAX, COOLDOWN_HOURS_RANGE, PACK_SIZE_RANGE } from '../../rides/attractions.js';
import { closedMessage } from './closed-message.js';

/** PATCH /ringmaster/park: any of the park's switches. Left out means unchanged. */
export class UpdateParkDto {
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  /** The sign on the gate while closed. Blank (or null) means the default wording. */
  @Transform(closedMessage)
  @IsOptional()
  @IsString()
  @MaxLength(CLOSED_MESSAGE_MAX)
  closedMessage?: string | null;

  @IsOptional()
  @IsInt()
  @Min(PACK_SIZE_RANGE.min)
  @Max(PACK_SIZE_RANGE.max)
  packSize?: number;

  @IsOptional()
  @IsInt()
  @Min(COOLDOWN_HOURS_RANGE.min)
  @Max(COOLDOWN_HOURS_RANGE.max)
  cooldownHours?: number;
}
