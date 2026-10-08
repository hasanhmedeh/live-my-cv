import type { User } from '../generated/prisma/client.js';

/** A user as the web client sees them. Never includes the password hash. */
export interface UserJson {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export function toUserJson(user: User): UserJson {
  return { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt.toISOString() };
}
