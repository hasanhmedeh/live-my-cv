import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Deleting an account asks for the password again, so a forgotten open session can't do it. An
 * account made with Google has no password: it types its username instead.
 */
export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  confirm?: string;
}
