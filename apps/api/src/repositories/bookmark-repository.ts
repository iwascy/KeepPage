import type {
  AuthUser,
  Bookmark,
  BookmarkMetadataUpdateRequest,
  BookmarkSearchResponse,
  BookmarkVersion,
  CaptureCompleteRequest,
  CaptureInitRequest,
  FolderCreateRequest,
  FolderUpdateRequest,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
  Folder,
} from "@keeppage/domain";

export type BookmarkSearchQuery = {
  q?: string;
  quality?: "high" | "medium" | "low";
  domain?: string;
  folderId?: string;
  tagId?: string;
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
  updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ): Promise<Bookmark | null>;
  listFolders(userId: string): Promise<Folder[]>;
  createFolder(userId: string, input: FolderCreateRequest): Promise<Folder>;
  updateFolder(userId: string, folderId: string, input: FolderUpdateRequest): Promise<Folder | null>;
  deleteFolder(userId: string, folderId: string): Promise<boolean>;
  listTags(userId: string): Promise<Tag[]>;
  createTag(userId: string, input: TagCreateRequest): Promise<Tag>;
  updateTag(userId: string, tagId: string, input: TagUpdateRequest): Promise<Tag | null>;
  deleteTag(userId: string, tagId: string): Promise<boolean>;
  userCanReadObject(userId: string, objectKey: string): Promise<boolean>;
  userCanWriteObject(userId: string, objectKey: string): Promise<boolean>;
}
