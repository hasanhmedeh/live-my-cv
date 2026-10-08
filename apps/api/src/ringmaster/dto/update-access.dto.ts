import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALLOWLIST_LABEL_MAX } from '../../access/allowlist.js';
import { closedMessage } from './closed-message.js';

/** PATCH /ringmaster/access: private access on or off. */
export class UpdateAccessDto {
  /** True lets only the allowed addresses reach the site; the caller's own is added if it isn't on the list. */
  @IsBoolean()
  enabled!: boolean;
}

/** POST /ringmaster/access/ips: one more address (or range) let in. */
export class AddAllowedIpDto {
  /** An address ("203.0.113.7") or a CIDR range ("203.0.113.0/24"). */
  @IsString()
  @MaxLength(64)
  ip!: string;

  /** Whose it is. Blank (or null) means none. */
  @Transform(closedMessage)
  @IsOptional()
  @IsString()
  @MaxLength(ALLOWLIST_LABEL_MAX)
  label?: string | null;
}
