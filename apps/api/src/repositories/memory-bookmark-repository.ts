import type {
  ApiToken,
  AuthUser,
  Bookmark,
  BookmarkIcon,
  BookmarkMetadataUpdateRequest,
  PrivateVaultSummary,
  BookmarkSearchResponse,
  BookmarkSidebarStatsResponse,
  CaptureCompleteRequest,
  CaptureInitRequest,
  ExtensionDevice,
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  IngestBookmarkRequest,
  ImportTask,
  ImportTaskDetailResponse,
  PublicShareResponse,
  Share,
  ShareDetail,
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
  BookmarkIconRefreshTarget,
  BookmarkIconUpsertInput,
  CreateApiTokenInput,
  CreateExtensionDeviceInput,
  CreateImportTaskInput,
  CreateShareRecordInput,
  ExtensionDeviceAuthRecord,
  ImportBookmarkMatch,
  IngestBookmarkResult,
  InitCaptureResult,
  PrivateModeConfigRecord,
  UpdateShareRecordInput,
  UserAuthRecord,
} from "./bookmark-repository";
import * as apiTokensRepository from "./memory/api-tokens";
import * as authRepository from "./memory/auth";
import * as bookmarksRepository from "./memory/bookmarks";
import { InMemoryRepositoryCore, type InMemoryBookmarkRepositoryOptions } from "./memory/core";
import * as capturesRepository from "./memory/captures";
import * as extensionDevicesRepository from "./memory/extension-devices";
import * as iconsRepository from "./memory/icons";
import * as importsRepository from "./memory/imports";
import * as objectsRepository from "./memory/objects";
import * as privateBookmarksRepository from "./memory/private-bookmarks";
import * as privateCapturesRepository from "./memory/private-captures";
import * as privateModeRepository from "./memory/private-mode";
import * as sharesRepository from "./memory/shares";
import * as taxonomyRepository from "./memory/taxonomy";

export class InMemoryBookmarkRepository implements BookmarkRepository {
  readonly kind = "memory" as const;
  private readonly core: InMemoryRepositoryCore;

  constructor(options: InMemoryBookmarkRepositoryOptions) {
    this.core = new InMemoryRepositoryCore(options);
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

  async createExtensionDevice(userId: string, input: CreateExtensionDeviceInput): Promise<ExtensionDevice> {
    return extensionDevicesRepository.createExtensionDevice(this.core, userId, input);
  }

  async listExtensionDevices(userId: string): Promise<ExtensionDevice[]> {
    return extensionDevicesRepository.listExtensionDevices(this.core, userId);
  }

  async getExtensionDeviceAuthRecord(deviceId: string): Promise<ExtensionDeviceAuthRecord | null> {
    return extensionDevicesRepository.getExtensionDeviceAuthRecord(this.core, deviceId);
  }

  async revokeExtensionDevice(userId: string, deviceId: string): Promise<boolean> {
    return extensionDevicesRepository.revokeExtensionDevice(this.core, userId, deviceId);
  }

  async touchExtensionDevice(deviceId: string, usedAt: string): Promise<void> {
    return extensionDevicesRepository.touchExtensionDevice(this.core, deviceId, usedAt);
  }

  async getPrivateModeConfig(userId: string): Promise<PrivateModeConfigRecord | null> {
    return privateModeRepository.getPrivateModeConfig(this.core, userId);
  }

  async enablePrivateMode(input: {
    userId: string;
    passwordHash: string;
    passwordAlgo: string;
  }): Promise<PrivateModeConfigRecord> {
    return privateModeRepository.enablePrivateMode(this.core, input);
  }

  async getPrivateVaultSummary(userId: string): Promise<PrivateVaultSummary> {
    return privateModeRepository.getPrivateVaultSummary(this.core, userId);
  }

  async initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    return capturesRepository.initCapture(this.core, userId, input);
  }

  async completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    return capturesRepository.completeCapture(this.core, userId, input);
  }

  async initPrivateCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    return privateCapturesRepository.initPrivateCapture(this.core, userId, input);
  }

  async completePrivateCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    return privateCapturesRepository.completePrivateCapture(this.core, userId, input);
  }

  async upsertBookmarkIcon(input: BookmarkIconUpsertInput): Promise<BookmarkIcon> {
    return iconsRepository.upsertBookmarkIcon(this.core, input);
  }

  async getBookmarkIconByHostname(hostname: string): Promise<BookmarkIcon | null> {
    return iconsRepository.getBookmarkIconByHostname(this.core, hostname);
  }

  async listBookmarkIconRefreshTargets(userId: string): Promise<BookmarkIconRefreshTarget[]> {
    return iconsRepository.listBookmarkIconRefreshTargets(this.core, userId);
  }

  async getBookmarkIconRefreshTarget(userId: string, bookmarkId: string): Promise<BookmarkIconRefreshTarget | null> {
    return iconsRepository.getBookmarkIconRefreshTarget(this.core, userId, bookmarkId);
  }

  async ingestBookmark(userId: string, input: IngestBookmarkRequest): Promise<IngestBookmarkResult> {
    return bookmarksRepository.ingestBookmark(this.core, userId, input);
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery): Promise<BookmarkSearchResponse> {
    return bookmarksRepository.searchBookmarks(this.core, userId, query);
  }

  async findBookmarkByUrl(userId: string, url: string): Promise<Bookmark | null> {
    return bookmarksRepository.findBookmarkByUrl(this.core, userId, url);
  }

  async getBookmarkSidebarStats(userId: string): Promise<BookmarkSidebarStatsResponse> {
    return bookmarksRepository.getBookmarkSidebarStats(this.core, userId);
  }

  async getBookmarkDetail(userId: string, bookmarkId: string): Promise<BookmarkDetail | null> {
    return bookmarksRepository.getBookmarkDetail(this.core, userId, bookmarkId);
  }

  async searchPrivateBookmarks(userId: string, query: BookmarkSearchQuery): Promise<BookmarkSearchResponse> {
    return privateBookmarksRepository.searchPrivateBookmarks(this.core, userId, query);
  }

  async getPrivateBookmarkDetail(userId: string, bookmarkId: string): Promise<BookmarkDetail | null> {
    return privateBookmarksRepository.getPrivateBookmarkDetail(this.core, userId, bookmarkId);
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

  async countActiveShares(userId: string): Promise<number> {
    return sharesRepository.countActiveShares(this.core, userId);
  }

  async findMissingOwnedBookmarkIds(userId: string, bookmarkIds: string[]): Promise<string[]> {
    return sharesRepository.findMissingOwnedBookmarkIds(this.core, userId, bookmarkIds);
  }

  async createShare(userId: string, input: CreateShareRecordInput): Promise<Share> {
    return sharesRepository.createShare(this.core, userId, input);
  }

  async listShares(userId: string): Promise<Share[]> {
    return sharesRepository.listShares(this.core, userId);
  }

  async getShareDetail(userId: string, shareId: string): Promise<ShareDetail | null> {
    return sharesRepository.getShareDetail(this.core, userId, shareId);
  }

  async updateShare(
    userId: string,
    shareId: string,
    input: UpdateShareRecordInput,
  ): Promise<ShareDetail | null> {
    return sharesRepository.updateShare(this.core, userId, shareId, input);
  }

  async revokeShare(userId: string, shareId: string): Promise<Share | null> {
    return sharesRepository.revokeShare(this.core, userId, shareId);
  }

  async getPublicShareByToken(token: string): Promise<PublicShareResponse | null> {
    return sharesRepository.getPublicShareByToken(this.core, token);
  }
}
