import type { PostgresRepositoryCore } from "./core";

export function userCanReadObject(
  core: PostgresRepositoryCore,
  userId: string,
  objectKey: string,
): Promise<boolean> {
  return core.userCanReadObject(userId, objectKey);
}

export function userCanWriteObject(
  core: PostgresRepositoryCore,
  userId: string,
  objectKey: string,
): Promise<boolean> {
  return core.userCanWriteObject(userId, objectKey);
}
