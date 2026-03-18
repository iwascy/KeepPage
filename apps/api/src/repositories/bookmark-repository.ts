import type {
  Bookmark,
  BookmarkSearchResponse,
  CaptureCompleteRequest,
  CaptureInitRequest,
  CaptureInitResponse,
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

export interface BookmarkRepository {
  readonly kind: "memory" | "postgres";
  initCapture(input: CaptureInitRequest): Promise<CaptureInitResponse>;
  completeCapture(input: CaptureCompleteRequest): Promise<CompleteCaptureResult>;
  searchBookmarks(query: BookmarkSearchQuery): Promise<BookmarkSearchResponse>;
}
