import type {
  Bookmark,
  BookmarkSearchResponse,
  CaptureCompleteRequest,
  CaptureInitRequest,
} from "@keeppage/domain";

export type BookmarkSearchQuery = {
  q?: string;
  quality?: "high" | "medium" | "low";
  domain?: string;
  limit: number;
  offset: number;
};

export type CompleteCaptureResult = {
  bookmark: Bookmark;
  versionId: string;
  createdNewVersion: boolean;
  deduplicated: boolean;
};

export type InitCaptureResult = {
  alreadyExists: boolean;
  bookmarkId?: string;
  versionId?: string;
  objectKey: string;
};

export interface BookmarkRepository {
  readonly kind: "memory" | "postgres";
  initCapture(input: CaptureInitRequest): Promise<InitCaptureResult>;
  completeCapture(input: CaptureCompleteRequest): Promise<CompleteCaptureResult>;
  searchBookmarks(query: BookmarkSearchQuery): Promise<BookmarkSearchResponse>;
}
