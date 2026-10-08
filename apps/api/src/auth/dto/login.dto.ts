import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from './normalize.js';

export class LoginDto {
  /** The email address or the username (told apart by the @). */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter your email or username' })
  @MaxLength(254)
  login: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
