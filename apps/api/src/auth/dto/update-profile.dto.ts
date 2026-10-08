import { Equals, IsEnum, IsOptional } from 'class-validator';
import { Gender } from '../../generated/prisma/client.js';
import { GENDER_MESSAGE, TERMS_MESSAGE } from './signup.dto.js';

/** PATCH /auth/me: fills in what an older (or Google-linked) account is missing. Left out means unchanged. */
export class UpdateProfileDto {
  @IsOptional()
  @IsEnum(Gender, { message: GENDER_MESSAGE })
  gender?: Gender;

  /** Accepting the current Terms and Privacy Policy, for an account that never did. */
  @IsOptional()
  @Equals(true, { message: TERMS_MESSAGE })
  acceptTerms?: true;
}
