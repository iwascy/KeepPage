import type { AuthUser } from "@keeppage/domain";
import type { UserAuthRecord } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function createUser(
  core: PostgresRepositoryCore,
  input: { email: string; name?: string; passwordHash: string },
): Promise<AuthUser> {
  return core.createUser(input);
}

export function findUserByEmail(
  core: PostgresRepositoryCore,
  email: string,
): Promise<UserAuthRecord | null> {
  return core.findUserByEmail(email);
}

export function getUserById(core: PostgresRepositoryCore, userId: string): Promise<AuthUser | null> {
  return core.getUserById(userId);
}
