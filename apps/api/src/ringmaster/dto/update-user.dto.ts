import { Equals, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '../../generated/prisma/client.js';

/** PATCH /ringmaster/users/:id. Left out means unchanged. */
export class UpdateUserDto {
  /** Sets the balance outright (not a delta), 0 to 100 000. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  ticketBalance?: number;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /** Lets them buy their next pack right away. */
  @IsOptional()
  @Equals(true)
  resetCooldown?: true;
}
