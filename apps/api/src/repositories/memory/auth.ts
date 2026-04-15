import type { AuthUser } from "@keeppage/domain";
import type { UserAuthRecord } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function createUser(
  core: InMemoryRepositoryCore,
  input: { email: string; name?: string; passwordHash: string },
): Promise<AuthUser> {
  return core.createUser(input);
}

export function findUserByEmail(
  core: InMemoryRepositoryCore,
  email: string,
): Promise<UserAuthRecord | null> {
  return core.findUserByEmail(email);
}

export function getUserById(core: InMemoryRepositoryCore, userId: string): Promise<AuthUser | null> {
  return core.getUserById(userId);
}
