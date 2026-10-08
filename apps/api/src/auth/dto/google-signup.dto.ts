import { Transform } from 'class-transformer';
import { Equals, IsEnum, IsString, Length, Matches } from 'class-validator';
import { Gender } from '../../generated/prisma/client.js';
import { trim } from './normalize.js';
import { GENDER_MESSAGE, TERMS_MESSAGE, USERNAME_MESSAGE, USERNAME_RULE } from './signup.dto.js';

/** POST /auth/google/signup: what Google doesn't tell us. The email comes from Google itself. */
export class GoogleSignupDto {
  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(USERNAME_RULE, { message: USERNAME_MESSAGE })
  username: string;

  @IsEnum(Gender, { message: GENDER_MESSAGE })
  gender: Gender;

  @Equals(true, { message: TERMS_MESSAGE })
  acceptTerms: true;
}
