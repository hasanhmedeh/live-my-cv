import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import type { SessionPayload } from './session.js';
import { TERMS_VERSION } from './terms.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup({ email, username, password }: SignupDto): Promise<User> {
    const usernameKey = username.toLowerCase();
    await this.assertAvailable(email, usernameKey);
    const passwordHash = await hashPassword(password);
    try {
      // SignupDto only lets acceptTerms === true through, so reaching here means they were accepted.
      return await this.prisma.user.create({
        data: { email, username, usernameKey, passwordHash, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
      });
    } catch (error) {
      // Someone grabbed the email or username between the check and the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.assertAvailable(email, usernameKey);
      }
      throw error;
    }
  }

  async login({ email, password }: LoginDto): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Unknown emails still pay for a hash check, so timing doesn't reveal which accounts exist.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');
    return user;
  }

  /** Signs a session token for the user. Expiry and algorithm come from the JwtModule config. */
  issueToken(user: User): Promise<string> {
    return this.jwt.signAsync({ sub: user.id } satisfies SessionPayload);
  }

  /** The user a session token belongs to, or null if it is invalid, expired or the user is gone. */
  async userFromToken(token: string): Promise<User | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return null;
    }
    if (typeof payload.sub !== 'string') return null;
    return this.prisma.user.findUnique({ where: { id: payload.sub } });
  }

  private async assertAvailable(email: string, usernameKey: string): Promise<void> {
    // At most two rows: one owning the email, one owning the username.
    const taken = await this.prisma.user.findMany({
      where: { OR: [{ email }, { usernameKey }] },
      select: { email: true },
      take: 2,
    });
    if (taken.length === 0) return;
    throw new ConflictException(
      taken.some((u) => u.email === email) ? 'That email is already registered' : 'That username is taken',
    );
  }
}
