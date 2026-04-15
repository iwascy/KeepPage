import type { ApiToken } from "@keeppage/domain";
import type { ApiTokenAuthRecord, CreateApiTokenInput } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function createApiToken(
  core: PostgresRepositoryCore,
  userId: string,
  input: CreateApiTokenInput,
): Promise<ApiToken> {
  return core.createApiToken(userId, input);
}

export function listApiTokens(core: PostgresRepositoryCore, userId: string): Promise<ApiToken[]> {
  return core.listApiTokens(userId);
}

export function getApiTokenAuthRecord(
  core: PostgresRepositoryCore,
  tokenId: string,
): Promise<ApiTokenAuthRecord | null> {
  return core.getApiTokenAuthRecord(tokenId);
}

export function revokeApiToken(
  core: PostgresRepositoryCore,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  return core.revokeApiToken(userId, tokenId);
}

export function touchApiToken(
  core: PostgresRepositoryCore,
  tokenId: string,
  usedAt: string,
): Promise<void> {
  return core.touchApiToken(tokenId, usedAt);
}
