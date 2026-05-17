import type { BookmarkIcon } from "@keeppage/domain";
import type {
  BookmarkIconRefreshTarget,
  BookmarkIconUpsertInput,
} from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function upsertBookmarkIcon(
  core: InMemoryRepositoryCore,
  input: BookmarkIconUpsertInput,
): Promise<BookmarkIcon> {
  return core.upsertBookmarkIcon(input);
}

export function getBookmarkIconByHostname(
  core: InMemoryRepositoryCore,
  hostname: string,
): Promise<BookmarkIcon | null> {
  return core.getBookmarkIconByHostname(hostname);
}

export function listBookmarkIconRefreshTargets(
  core: InMemoryRepositoryCore,
  userId: string,
): Promise<BookmarkIconRefreshTarget[]> {
  return core.listBookmarkIconRefreshTargets(userId);
}

export function getBookmarkIconRefreshTarget(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkIconRefreshTarget | null> {
  return core.getBookmarkIconRefreshTarget(userId, bookmarkId);
}
