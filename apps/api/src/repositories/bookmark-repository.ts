import type {
  AuthUser,
  Bookmark,
  BookmarkSearchResponse,
  BookmarkVersion,
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

export type BookmarkDetail = {
  bookmark: Bookmark;
  versions: BookmarkVersion[];
};

export type UserAuthRecord = {
  user: AuthUser;
  passwordHash: string;
};

export interface BookmarkRepository {
  readonly kind: "memory" | "postgres";
  createUser(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<UserAuthRecord | null>;
  getUserById(userId: string): Promise<AuthUser | null>;
  initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult>;
  completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult>;
  searchBookmarks(userId: string, query: BookmarkSearchQuery): Promise<BookmarkSearchResponse>;
  getBookmarkDetail(userId: string, bookmarkId: string): Promise<BookmarkDetail | null>;
  userCanReadObject(userId: string, objectKey: string): Promise<boolean>;
  userCanWriteObject(userId: string, objectKey: string): Promise<boolean>;
}
