import type { BookmarkSearchResponse } from "@keeppage/domain";
import type { BookmarkDetail, BookmarkSearchQuery } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function searchPrivateBookmarks(
  core: PostgresRepositoryCore,
  userId: string,
  query: BookmarkSearchQuery,
): Promise<BookmarkSearchResponse> {
  return core.searchPrivateBookmarks(userId, query);
}

export function getPrivateBookmarkDetail(
  core: PostgresRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkDetail | null> {
  return core.getPrivateBookmarkDetail(userId, bookmarkId);
}
