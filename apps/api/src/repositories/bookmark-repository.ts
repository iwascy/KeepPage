import type {
  ApiToken,
  ApiTokenScope,
  AuthUser,
  Bookmark,
  BookmarkListView,
  BookmarkMetadataUpdateRequest,
  BookmarkSearchResponse,
  BookmarkVersion,
  CaptureCompleteRequest,
  CaptureInitRequest,
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  IngestBookmarkRequest,
  IngestBookmarkStatus,
  ImportExecutionOptions,
  ImportPreviewResponse,
  ImportSource,
  ImportTask,
  ImportTaskDetailResponse,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";

export type BookmarkSearchQuery = {
  q?: string;
  quality?: "high" | "medium" | "low";
  view?: BookmarkListView;
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

export type ImportBookmarkMatch = {
  normalizedUrlHash: string;
  bookmarkId: string;
  title: string;
  hasArchive: boolean;
  latestVersionId?: string;
};

export type PreparedImportItem = {
  index: number;
  title: string;
  url?: string;
  normalizedUrl?: string;
  normalizedUrlHash?: string;
  domain?: string;
  folderPath?: string;
  sourceTags: string[];
  valid: boolean;
  duplicateInFile: boolean;
  reason?: string;
};

export type CreateImportTaskInput = {
  taskName: string;
  sourceType: ImportSource;
  fileName?: string;
  options: ImportExecutionOptions;
  preview: ImportPreviewResponse;
  items: PreparedImportItem[];
};

export type UserAuthRecord = {
  user: AuthUser;
  passwordHash: string;
};

export type ApiTokenAuthRecord = ApiToken & {
  userId: string;
  tokenHash: string;
};

export type CreateApiTokenInput = {
  id: string;
  name: string;
  tokenPreview: string;
  tokenHash: string;
  scopes: ApiTokenScope[];
  expiresAt?: string;
};

export type IngestBookmarkResult = {
  bookmark: Bookmark;
  status: IngestBookmarkStatus;
  deduplicated: boolean;
};

export interface RepositoryInfo {
  readonly kind: "memory" | "postgres";
}

export interface AuthRepository extends RepositoryInfo {
  createUser(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<UserAuthRecord | null>;
  getUserById(userId: string): Promise<AuthUser | null>;
}

export interface ApiTokenRepository extends RepositoryInfo {
  createApiToken(userId: string, input: CreateApiTokenInput): Promise<ApiToken>;
  listApiTokens(userId: string): Promise<ApiToken[]>;
  getApiTokenAuthRecord(tokenId: string): Promise<ApiTokenAuthRecord | null>;
  revokeApiToken(userId: string, tokenId: string): Promise<boolean>;
  touchApiToken(tokenId: string, usedAt: string): Promise<void>;
}

export interface CaptureRepository extends RepositoryInfo {
  initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult>;
  completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult>;
}

export interface IngestRepository extends RepositoryInfo {
  ingestBookmark(userId: string, input: IngestBookmarkRequest): Promise<IngestBookmarkResult>;
}

export interface BookmarkReadRepository extends RepositoryInfo {
  searchBookmarks(userId: string, query: BookmarkSearchQuery): Promise<BookmarkSearchResponse>;
  getBookmarkDetail(userId: string, bookmarkId: string): Promise<BookmarkDetail | null>;
}

export interface BookmarkWriteRepository extends RepositoryInfo {
  deleteBookmark(userId: string, bookmarkId: string): Promise<boolean>;
  updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ): Promise<Bookmark | null>;
}

export interface TaxonomyRepository extends RepositoryInfo {
  listFolders(userId: string): Promise<Folder[]>;
  createFolder(userId: string, input: FolderCreateRequest): Promise<Folder>;
  updateFolder(userId: string, folderId: string, input: FolderUpdateRequest): Promise<Folder | null>;
  deleteFolder(userId: string, folderId: string): Promise<boolean>;
  listTags(userId: string): Promise<Tag[]>;
  createTag(userId: string, input: TagCreateRequest): Promise<Tag>;
  updateTag(userId: string, tagId: string, input: TagUpdateRequest): Promise<Tag | null>;
  deleteTag(userId: string, tagId: string): Promise<boolean>;
}

export interface ImportRepository extends RepositoryInfo {
  findImportBookmarkMatches(
    userId: string,
    normalizedUrlHashes: string[],
  ): Promise<ImportBookmarkMatch[]>;
  createImportTask(userId: string, input: CreateImportTaskInput): Promise<ImportTaskDetailResponse>;
  listImportTasks(userId: string): Promise<ImportTask[]>;
  getImportTaskDetail(userId: string, taskId: string): Promise<ImportTaskDetailResponse | null>;
}

export interface ObjectAccessRepository extends RepositoryInfo {
  userCanReadObject(userId: string, objectKey: string): Promise<boolean>;
  userCanWriteObject(userId: string, objectKey: string): Promise<boolean>;
}

export type BookmarkRepository =
  & AuthRepository
  & ApiTokenRepository
  & CaptureRepository
  & IngestRepository
  & BookmarkReadRepository
  & BookmarkWriteRepository
  & TaxonomyRepository
  & ImportRepository
  & ObjectAccessRepository;
