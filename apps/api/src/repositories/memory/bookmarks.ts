import type {
  Bookmark,
  BookmarkMetadataUpdateRequest,
  BookmarkSearchResponse,
  IngestBookmarkRequest,
} from "@keeppage/domain";
import type {
  BookmarkDetail,
  BookmarkSearchQuery,
  IngestBookmarkResult,
} from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function ingestBookmark(
  core: InMemoryRepositoryCore,
  userId: string,
  input: IngestBookmarkRequest,
): Promise<IngestBookmarkResult> {
  return core.ingestBookmark(userId, input);
}

export function searchBookmarks(
  core: InMemoryRepositoryCore,
  userId: string,
  query: BookmarkSearchQuery,
): Promise<BookmarkSearchResponse> {
  return core.searchBookmarks(userId, query);
}

export function getBookmarkDetail(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkDetail | null> {
  return core.getBookmarkDetail(userId, bookmarkId);
}

export function deleteBookmark(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
): Promise<boolean> {
  return core.deleteBookmark(userId, bookmarkId);
}

export function updateBookmarkMetadata(
  core: InMemoryRepositoryCore,
  userId: string,
  bookmarkId: string,
  input: BookmarkMetadataUpdateRequest,
): Promise<Bookmark | null> {
  return core.updateBookmarkMetadata(userId, bookmarkId, input);
}
