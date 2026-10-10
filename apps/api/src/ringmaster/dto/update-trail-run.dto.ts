import { IsBoolean } from 'class-validator';

/** PATCH /ringmaster/trail/runs/:id: take a run off its leaderboard, or put it back. */
export class UpdateTrailRunDto {
  @IsBoolean()
  disqualified: boolean;
}
