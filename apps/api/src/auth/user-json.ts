import type { Role, User } from '../generated/prisma/client.js';

/** A user as the web client sees them. Never includes the password hash. */
export interface UserJson {
  id: string;
  email: string;
  username: string;
  /** "admin" for staff, who get The Ringmaster's Office. */
  role: Role;
  createdAt: string;
}

export function toUserJson(user: User): UserJson {
  return { id: user.id, email: user.email, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() };
}
