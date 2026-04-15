import type { ApiToken } from "@keeppage/domain";
import type { ApiTokenAuthRecord, CreateApiTokenInput } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function createApiToken(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CreateApiTokenInput,
): Promise<ApiToken> {
  return core.createApiToken(userId, input);
}

export function listApiTokens(core: InMemoryRepositoryCore, userId: string): Promise<ApiToken[]> {
  return core.listApiTokens(userId);
}

export function getApiTokenAuthRecord(
  core: InMemoryRepositoryCore,
  tokenId: string,
): Promise<ApiTokenAuthRecord | null> {
  return core.getApiTokenAuthRecord(tokenId);
}

export function revokeApiToken(
  core: InMemoryRepositoryCore,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  return core.revokeApiToken(userId, tokenId);
}

export function touchApiToken(
  core: InMemoryRepositoryCore,
  tokenId: string,
  usedAt: string,
): Promise<void> {
  return core.touchApiToken(tokenId, usedAt);
}
