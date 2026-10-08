import type { Gender, Role, User } from '../generated/prisma/client.js';

/** A user as the web client sees them. Never includes the password hash. */
export interface UserJson {
  id: string;
  email: string;
  username: string;
  /** "admin" for staff, who get The Ringmaster's Office. */
  role: Role;
  /** Null for an account made before signup asked: the game asks for it after logging in. */
  gender: Gender | null;
  /** False for an account made with Google: it confirms things with its username instead. */
  hasPassword: boolean;
  /** Linked to a Google account (they can continue with Google). */
  google: boolean;
  /** Null for an account that never accepted them: the game asks after logging in. */
  termsAcceptedAt: string | null;
  createdAt: string;
}

export function toUserJson(user: User): UserJson {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    gender: user.gender,
    hasPassword: user.passwordHash !== null,
    google: user.googleId !== null,
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
