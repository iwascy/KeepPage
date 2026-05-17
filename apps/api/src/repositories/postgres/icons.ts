import type { BookmarkIcon } from "@keeppage/domain";
import type {
  BookmarkIconRefreshTarget,
  BookmarkIconUpsertInput,
} from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function upsertBookmarkIcon(
  core: PostgresRepositoryCore,
  input: BookmarkIconUpsertInput,
): Promise<BookmarkIcon> {
  return core.upsertBookmarkIcon(input);
}

export function getBookmarkIconByHostname(
  core: PostgresRepositoryCore,
  hostname: string,
): Promise<BookmarkIcon | null> {
  return core.getBookmarkIconByHostname(hostname);
}

export function listBookmarkIconRefreshTargets(
  core: PostgresRepositoryCore,
  userId: string,
): Promise<BookmarkIconRefreshTarget[]> {
  return core.listBookmarkIconRefreshTargets(userId);
}

export function getBookmarkIconRefreshTarget(
  core: PostgresRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkIconRefreshTarget | null> {
  return core.getBookmarkIconRefreshTarget(userId, bookmarkId);
}
