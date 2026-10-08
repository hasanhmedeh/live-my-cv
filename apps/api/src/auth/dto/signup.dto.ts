import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsEnum, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Gender } from '../../generated/prisma/client.js';
import { normalizeEmail, trim } from './normalize.js';

/** The username rules, shared with finishing a Google signup. */
export const USERNAME_RULE = /^[a-zA-Z0-9_]+$/;
export const USERNAME_MESSAGE = 'username may only contain letters, numbers and underscores';
export const GENDER_MESSAGE = 'Pick one of the options for gender';
export const TERMS_MESSAGE = 'You must accept the Terms of Service and Privacy Policy';

export class SignupDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(USERNAME_RULE, { message: USERNAME_MESSAGE })
  username: string;

  @IsString()
  @Length(8, 72)
  password: string;

  @IsEnum(Gender, { message: GENDER_MESSAGE })
  gender: Gender;

  /** The signup form's checkbox for the Terms of Service and Privacy Policy (and the age rule in them). Must be literally true. */
  @Equals(true, { message: TERMS_MESSAGE })
  acceptTerms: true;
}
