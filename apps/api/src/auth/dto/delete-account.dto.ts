import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Deleting an account asks for the password again, so a forgotten open session can't do it. */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password: string;
}
