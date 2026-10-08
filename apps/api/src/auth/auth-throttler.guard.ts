import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** ThrottlerGuard, answering 429 with Nest's usual { statusCode, message, error } body and a readable message. */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      HttpException.createBody('Too many attempts. Wait a minute and try again.', 'Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
