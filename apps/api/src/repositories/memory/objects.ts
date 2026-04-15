import type { InMemoryRepositoryCore } from "./core";

export function userCanReadObject(
  core: InMemoryRepositoryCore,
  userId: string,
  objectKey: string,
): Promise<boolean> {
  return core.userCanReadObject(userId, objectKey);
}

export function userCanWriteObject(
  core: InMemoryRepositoryCore,
  userId: string,
  objectKey: string,
): Promise<boolean> {
  return core.userCanWriteObject(userId, objectKey);
}
