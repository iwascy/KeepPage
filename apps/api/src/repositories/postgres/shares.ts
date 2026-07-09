import type { PublicShareResponse, Share, ShareDetail } from "@keeppage/domain";
import type { CreateShareRecordInput, UpdateShareRecordInput } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function countActiveShares(core: PostgresRepositoryCore, userId: string): Promise<number> {
  return core.countActiveShares(userId);
}

export function findMissingOwnedBookmarkIds(
  core: PostgresRepositoryCore,
  userId: string,
  bookmarkIds: string[],
): Promise<string[]> {
  return core.findMissingOwnedBookmarkIds(userId, bookmarkIds);
}

export function createShare(
  core: PostgresRepositoryCore,
  userId: string,
  input: CreateShareRecordInput,
): Promise<Share> {
  return core.createShare(userId, input);
}

export function listShares(core: PostgresRepositoryCore, userId: string): Promise<Share[]> {
  return core.listShares(userId);
}

export function getShareDetail(
  core: PostgresRepositoryCore,
  userId: string,
  shareId: string,
): Promise<ShareDetail | null> {
  return core.getShareDetail(userId, shareId);
}

export function updateShare(
  core: PostgresRepositoryCore,
  userId: string,
  shareId: string,
  input: UpdateShareRecordInput,
): Promise<ShareDetail | null> {
  return core.updateShare(userId, shareId, input);
}

export function revokeShare(
  core: PostgresRepositoryCore,
  userId: string,
  shareId: string,
): Promise<Share | null> {
  return core.revokeShare(userId, shareId);
}

export function getPublicShareByToken(
  core: PostgresRepositoryCore,
  token: string,
): Promise<PublicShareResponse | null> {
  return core.getPublicShareByToken(token);
}
