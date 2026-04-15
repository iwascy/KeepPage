import type {
  ApiToken,
  AuthUser,
  Bookmark,
  BookmarkMetadataUpdateRequest,
  BookmarkSearchResponse,
  BookmarkSidebarStatsResponse,
  CaptureCompleteRequest,
  CaptureInitRequest,
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  IngestBookmarkRequest,
  ImportTask,
  ImportTaskDetailResponse,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import type {
  ApiTokenAuthRecord,
  BookmarkDetail,
  BookmarkRepository,
  BookmarkSearchQuery,
  CompleteCaptureResult,
  CreateApiTokenInput,
  CreateImportTaskInput,
  ImportBookmarkMatch,
  IngestBookmarkResult,
  InitCaptureResult,
  UserAuthRecord,
} from "./bookmark-repository";
import * as apiTokensRepository from "./postgres/api-tokens";
import * as authRepository from "./postgres/auth";
import * as bookmarksRepository from "./postgres/bookmarks";
import { PostgresRepositoryCore, type PostgresBookmarkRepositoryOptions } from "./postgres/core";
import * as capturesRepository from "./postgres/captures";
import * as importsRepository from "./postgres/imports";
import * as objectsRepository from "./postgres/objects";
import * as taxonomyRepository from "./postgres/taxonomy";

export class PostgresBookmarkRepository implements BookmarkRepository {
  readonly kind = "postgres" as const;
  private readonly core: PostgresRepositoryCore;

  constructor(options: PostgresBookmarkRepositoryOptions) {
    this.core = new PostgresRepositoryCore(options);
  }

  async createUser(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<AuthUser> {
    return authRepository.createUser(this.core, input);
  }

  async findUserByEmail(email: string): Promise<UserAuthRecord | null> {
    return authRepository.findUserByEmail(this.core, email);
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    return authRepository.getUserById(this.core, userId);
  }

  async createApiToken(userId: string, input: CreateApiTokenInput): Promise<ApiToken> {
    return apiTokensRepository.createApiToken(this.core, userId, input);
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    return apiTokensRepository.listApiTokens(this.core, userId);
  }

  async getApiTokenAuthRecord(tokenId: string): Promise<ApiTokenAuthRecord | null> {
    return apiTokensRepository.getApiTokenAuthRecord(this.core, tokenId);
  }

  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    return apiTokensRepository.revokeApiToken(this.core, userId, tokenId);
  }

  async touchApiToken(tokenId: string, usedAt: string): Promise<void> {
    return apiTokensRepository.touchApiToken(this.core, tokenId, usedAt);
  }

  async initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    return capturesRepository.initCapture(this.core, userId, input);
  }

  async completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    return capturesRepository.completeCapture(this.core, userId, input);
  }

  async ingestBookmark(userId: string, input: IngestBookmarkRequest): Promise<IngestBookmarkResult> {
    return bookmarksRepository.ingestBookmark(this.core, userId, input);
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery): Promise<BookmarkSearchResponse> {
    return bookmarksRepository.searchBookmarks(this.core, userId, query);
  }

  async getBookmarkSidebarStats(userId: string): Promise<BookmarkSidebarStatsResponse> {
    return bookmarksRepository.getBookmarkSidebarStats(this.core, userId);
  }

  async getBookmarkDetail(userId: string, bookmarkId: string): Promise<BookmarkDetail | null> {
    return bookmarksRepository.getBookmarkDetail(this.core, userId, bookmarkId);
  }

  async deleteBookmark(userId: string, bookmarkId: string): Promise<boolean> {
    return bookmarksRepository.deleteBookmark(this.core, userId, bookmarkId);
  }

  async updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ): Promise<Bookmark | null> {
    return bookmarksRepository.updateBookmarkMetadata(this.core, userId, bookmarkId, input);
  }

  async listFolders(userId: string): Promise<Folder[]> {
    return taxonomyRepository.listFolders(this.core, userId);
  }

  async createFolder(userId: string, input: FolderCreateRequest): Promise<Folder> {
    return taxonomyRepository.createFolder(this.core, userId, input);
  }

  async updateFolder(userId: string, folderId: string, input: FolderUpdateRequest): Promise<Folder | null> {
    return taxonomyRepository.updateFolder(this.core, userId, folderId, input);
  }

  async deleteFolder(userId: string, folderId: string): Promise<boolean> {
    return taxonomyRepository.deleteFolder(this.core, userId, folderId);
  }

  async listTags(userId: string): Promise<Tag[]> {
    return taxonomyRepository.listTags(this.core, userId);
  }

  async createTag(userId: string, input: TagCreateRequest): Promise<Tag> {
    return taxonomyRepository.createTag(this.core, userId, input);
  }

  async updateTag(userId: string, tagId: string, input: TagUpdateRequest): Promise<Tag | null> {
    return taxonomyRepository.updateTag(this.core, userId, tagId, input);
  }

  async deleteTag(userId: string, tagId: string): Promise<boolean> {
    return taxonomyRepository.deleteTag(this.core, userId, tagId);
  }

  async findImportBookmarkMatches(userId: string, normalizedUrlHashes: string[]): Promise<ImportBookmarkMatch[]> {
    return importsRepository.findImportBookmarkMatches(this.core, userId, normalizedUrlHashes);
  }

  async createImportTask(userId: string, input: CreateImportTaskInput): Promise<ImportTaskDetailResponse> {
    return importsRepository.createImportTask(this.core, userId, input);
  }

  async listImportTasks(userId: string): Promise<ImportTask[]> {
    return importsRepository.listImportTasks(this.core, userId);
  }

  async getImportTaskDetail(userId: string, taskId: string): Promise<ImportTaskDetailResponse | null> {
    return importsRepository.getImportTaskDetail(this.core, userId, taskId);
  }

  async userCanReadObject(userId: string, objectKey: string): Promise<boolean> {
    return objectsRepository.userCanReadObject(this.core, userId, objectKey);
  }

  async userCanWriteObject(userId: string, objectKey: string): Promise<boolean> {
    return objectsRepository.userCanWriteObject(this.core, userId, objectKey);
  }
}
