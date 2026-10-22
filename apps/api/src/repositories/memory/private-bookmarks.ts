import type {
  Bookmark,
  BookmarkMetadataUpdateRequest,
  BookmarkSearchResponse,
  BookmarkSidebarStatsResponse,
} from "@keeppage/domain";
import type { BookmarkDetail, BookmarkSearchQuery } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function searchPrivateBookmarks(
  core: InMemoryRepositoryCore,
  userId: string,
  query: BookmarkSearchQuery,
): Promise<BookmarkSearchResponse> {
  return core.searchPrivateBookmarks(userId, query);
}

export function getPrivateBookmarkSidebarStats(
  core: InMemoryRepositoryCore,
  userId: string,
): Promise<BookmarkSidebarStatsResponse> {
  return core.getPrivateBookmarkSidebarStats(userId);
}

export function getPrivateBookmarkDetail(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkDetail | null> {
  return core.getPrivateBookmarkDetail(userId, bookmarkId);
}

export function deletePrivateBookmark(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<boolean> {
  return core.deletePrivateBookmark(userId, bookmarkId);
}

export function updatePrivateBookmarkMetadata(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
  input: BookmarkMetadataUpdateRequest,
): Promise<Bookmark | null> {
  return core.updatePrivateBookmarkMetadata(userId, bookmarkId, input);
}
