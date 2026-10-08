import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { normalizeEmail, trim } from './normalize.js';

export class SignupDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'username may only contain letters, numbers and underscores' })
  username: string;

  @IsString()
  @Length(8, 72)
  password: string;

  /** The signup form's checkbox for the Terms of Service and Privacy Policy (and the age rule in them). Must be literally true. */
  @Equals(true, { message: 'You must accept the Terms of Service and Privacy Policy' })
  acceptTerms: true;
}
