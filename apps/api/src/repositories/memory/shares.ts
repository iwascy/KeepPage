import type { PublicShareResponse, Share, ShareDetail } from "@keeppage/domain";
import type { CreateShareRecordInput, UpdateShareRecordInput } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function countActiveShares(core: InMemoryRepositoryCore, userId: string): Promise<number> {
  return core.countActiveShares(userId);
}

export function findMissingOwnedBookmarkIds(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkIds: string[],
): Promise<string[]> {
  return core.findMissingOwnedBookmarkIds(userId, bookmarkIds);
}

export function createShare(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CreateShareRecordInput,
): Promise<Share> {
  return core.createShare(userId, input);
}

export function listShares(core: InMemoryRepositoryCore, userId: string): Promise<Share[]> {
  return core.listShares(userId);
}

export function getShareDetail(
  core: InMemoryRepositoryCore,
  userId: string,
  shareId: string,
): Promise<ShareDetail | null> {
  return core.getShareDetail(userId, shareId);
}

export function updateShare(
  core: InMemoryRepositoryCore,
  userId: string,
  shareId: string,
  input: UpdateShareRecordInput,
): Promise<ShareDetail | null> {
  return core.updateShare(userId, shareId, input);
}

export function revokeShare(
  core: InMemoryRepositoryCore,
  userId: string,
  shareId: string,
): Promise<Share | null> {
  return core.revokeShare(userId, shareId);
}

export function getPublicShareByToken(
  core: InMemoryRepositoryCore,
  token: string,
): Promise<PublicShareResponse | null> {
  return core.getPublicShareByToken(token);
}
