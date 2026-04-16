import {
  type ApiToken,
  createBookmarkId,
  createImportTaskId,
  createImportTaskItemId,
  createVersionId,
  type AuthUser,
  type Bookmark,
  type BookmarkMetadataUpdateRequest,
  type BookmarkVersion,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
  type Folder,
  type FolderCreateRequest,
  type FolderUpdateRequest,
  type IngestBookmarkRequest,
  importTaskDetailResponseSchema,
  importTaskSchema,
  type ImportExecutionOptions,
  type ImportTask,
  type ImportTaskDetailResponse,
  type ImportTaskItem,
  type PrivateVaultSummary,
  type Tag,
  type TagCreateRequest,
  type TagUpdateRequest,
} from "@keeppage/domain";
import { HttpError } from "../../lib/http-error";
import { hashNormalizedUrl, normalizeSourceUrl } from "../../lib/url";
import type { ObjectStorage } from "../../storage/object-storage";
import type {
  ApiTokenAuthRecord,
  BookmarkSearchQuery,
  CreateApiTokenInput,
  CreateImportTaskInput,
  CompleteCaptureResult,
  IngestBookmarkResult,
  ImportBookmarkMatch,
  InitCaptureResult,
  PrivateModeConfigRecord,
  PreparedImportItem,
  UserAuthRecord,
} from "../bookmark-repository";
import {
  deduplicateScopes,
  deriveHtmlObjectKeyFromMediaObjectKey,
  mergeBookmarkMediaFiles,
} from "./shared/helpers";

type PendingCapture = {
  objectKey: string;
  request: CaptureInitRequest;
};

type StoredUser = UserAuthRecord;
type StoredApiToken = ApiTokenAuthRecord;
type StoredPrivateModeConfig = PrivateModeConfigRecord;

type UserBookmarkState = {
  bookmarks: Map<string, Bookmark>;
  versionsByBookmark: Map<string, BookmarkVersion[]>;
  pendingByObjectKey: Map<string, PendingCapture>;
  versionsByObjectKey: Map<string, BookmarkVersion>;
  privateBookmarks: Map<string, Bookmark>;
  privateVersionsByBookmark: Map<string, BookmarkVersion[]>;
  privatePendingByObjectKey: Map<string, PendingCapture>;
  privateVersionsByObjectKey: Map<string, BookmarkVersion>;
  privateModeConfig: StoredPrivateModeConfig | null;
  folders: Map<string, Folder>;
  tags: Map<string, Tag>;
  importTasks: Map<string, ImportTask>;
  importItemsByTaskId: Map<string, ImportTaskItem[]>;
};

export type InMemoryBookmarkRepositoryOptions = {
  objectStorage: ObjectStorage;
};

export class InMemoryRepositoryCore {
  readonly kind = "memory" as const;

  private readonly usersById = new Map<string, StoredUser>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly stateByUserId = new Map<string, UserBookmarkState>();
  private readonly apiTokensById = new Map<string, StoredApiToken>();
  private readonly apiTokenIdsByUserId = new Map<string, Set<string>>();
  private readonly objectStorage: ObjectStorage;

  constructor(options: InMemoryBookmarkRepositoryOptions) {
    this.objectStorage = options.objectStorage;
  }

  async createUser(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<AuthUser> {
    const user: AuthUser = {
      id: crypto.randomUUID(),
      email: input.email,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.usersById.set(user.id, {
      user,
      passwordHash: input.passwordHash,
    });
    this.userIdsByEmail.set(user.email, user.id);
    this.ensureUserState(user.id);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserAuthRecord | null> {
    const userId = this.userIdsByEmail.get(email);
    if (!userId) {
      return null;
    }
    return this.usersById.get(userId) ?? null;
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    return this.usersById.get(userId)?.user ?? null;
  }

  async createApiToken(userId: string, input: CreateApiTokenInput): Promise<ApiToken> {
    const scopes = deduplicateScopes(input.scopes);
    const token: StoredApiToken = {
      id: input.id,
      userId,
      name: input.name,
      tokenPreview: input.tokenPreview,
      tokenHash: input.tokenHash,
      scopes,
      lastUsedAt: undefined,
      expiresAt: input.expiresAt,
      revokedAt: undefined,
      createdAt: new Date().toISOString(),
    };

    this.apiTokensById.set(token.id, token);
    const tokenIds = this.apiTokenIdsByUserId.get(userId) ?? new Set<string>();
    tokenIds.add(token.id);
    this.apiTokenIdsByUserId.set(userId, tokenIds);
    return this.toPublicApiToken(token);
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    const tokenIds = this.apiTokenIdsByUserId.get(userId);
    if (!tokenIds) {
      return [];
    }

    return [...tokenIds]
      .map((tokenId) => this.apiTokensById.get(tokenId))
      .filter((token): token is StoredApiToken => Boolean(token))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((token) => this.toPublicApiToken(token));
  }

  async getApiTokenAuthRecord(tokenId: string): Promise<ApiTokenAuthRecord | null> {
    const token = this.apiTokensById.get(tokenId);
    if (!token) {
      return null;
    }
    return {
      ...token,
      scopes: [...token.scopes],
    };
  }

  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    const token = this.apiTokensById.get(tokenId);
    if (!token || token.userId !== userId) {
      return false;
    }
    if (!token.revokedAt) {
      token.revokedAt = new Date().toISOString();
      this.apiTokensById.set(token.id, token);
    }
    return true;
  }

  async touchApiToken(tokenId: string, usedAt: string): Promise<void> {
    const token = this.apiTokensById.get(tokenId);
    if (!token) {
      return;
    }
    token.lastUsedAt = usedAt;
    this.apiTokensById.set(token.id, token);
  }

  async getPrivateModeConfig(userId: string): Promise<PrivateModeConfigRecord | null> {
    const state = this.ensureUserState(userId);
    return state.privateModeConfig;
  }

  async enablePrivateMode(input: {
    userId: string;
    passwordHash: string;
    passwordAlgo: string;
  }): Promise<PrivateModeConfigRecord> {
    const state = this.ensureUserState(input.userId);
    const now = new Date().toISOString();
    const nextConfig: PrivateModeConfigRecord = {
      userId: input.userId,
      passwordHash: input.passwordHash,
      passwordAlgo: input.passwordAlgo,
      enabledAt: state.privateModeConfig?.enabledAt ?? now,
      passwordUpdatedAt: now,
    };
    state.privateModeConfig = nextConfig;
    return nextConfig;
  }

  async getPrivateVaultSummary(userId: string): Promise<PrivateVaultSummary> {
    const state = this.ensureUserState(userId);
    const latestUpdatedAt = [...state.privateBookmarks.values()]
      .map((bookmark) => bookmark.updatedAt)
      .sort((left, right) => right.localeCompare(left))[0];
    return {
      enabled: Boolean(state.privateModeConfig),
      unlocked: false,
      autoLock: "browser",
      totalItems: state.privateBookmarks.size,
      pendingSyncCount: state.privatePendingByObjectKey.size,
      syncEnabled: true,
      lastUpdatedAt: latestUpdatedAt,
    };
  }

  async initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    const state = this.ensureUserState(userId);
    const normalizedUrl = normalizeSourceUrl(input.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);

    for (const bookmark of state.bookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash !== normalizedUrlHash) {
        continue;
      }

      const versions = state.versionsByBookmark.get(bookmark.id) ?? [];
      const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);
      if (!matchedVersion) {
        continue;
      }

      const existingObjectKey = this.findObjectKeyByVersionId(state, matchedVersion.id);
      return {
        alreadyExists: true,
        bookmarkId: bookmark.id,
        versionId: matchedVersion.id,
        objectKey: existingObjectKey ?? this.createObjectKey(userId),
      };
    }

    for (const pendingCapture of state.pendingByObjectKey.values()) {
      const pendingHash = hashNormalizedUrl(normalizeSourceUrl(pendingCapture.request.url));
      if (
        pendingHash === normalizedUrlHash &&
        pendingCapture.request.htmlSha256 === input.htmlSha256
      ) {
        return {
          alreadyExists: false,
          objectKey: pendingCapture.objectKey,
        };
      }
    }

    const objectKey = this.createObjectKey(userId);
    state.pendingByObjectKey.set(objectKey, { objectKey, request: input });
    return { alreadyExists: false, objectKey };
  }

  async initPrivateCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    const state = this.ensureUserState(userId);
    const normalizedUrl = normalizeSourceUrl(input.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);

    for (const bookmark of state.privateBookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash !== normalizedUrlHash) {
        continue;
      }

      const versions = state.privateVersionsByBookmark.get(bookmark.id) ?? [];
      const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);
      if (!matchedVersion) {
        continue;
      }

      return {
        alreadyExists: true,
        bookmarkId: bookmark.id,
        versionId: matchedVersion.id,
        objectKey: matchedVersion.htmlObjectKey,
      };
    }

    for (const pendingCapture of state.privatePendingByObjectKey.values()) {
      const pendingHash = hashNormalizedUrl(normalizeSourceUrl(pendingCapture.request.url));
      if (
        pendingHash === normalizedUrlHash &&
        pendingCapture.request.htmlSha256 === input.htmlSha256
      ) {
        return {
          alreadyExists: false,
          objectKey: pendingCapture.objectKey,
        };
      }
    }

    const objectKey = this.createPrivateObjectKey(userId);
    state.privatePendingByObjectKey.set(objectKey, { objectKey, request: input });
    return { alreadyExists: false, objectKey };
  }

  async completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const state = this.ensureUserState(userId);
    const pendingCapture = state.pendingByObjectKey.get(input.objectKey);
    const existingByObjectKey = state.versionsByObjectKey.get(input.objectKey);
    if (!pendingCapture && existingByObjectKey) {
      await this.persistReaderArchive(state, existingByObjectKey, input.readerHtml);
      existingByObjectKey.mediaFiles = mergeBookmarkMediaFiles(
        existingByObjectKey.mediaFiles,
        input.mediaFiles,
      );
      for (const mediaFile of existingByObjectKey.mediaFiles ?? []) {
        state.versionsByObjectKey.set(mediaFile.objectKey, existingByObjectKey);
      }
      const bookmark = this.findBookmarkByVersionId(state, existingByObjectKey.id);
      if (!bookmark) {
        throw new Error("Existing version not linked to bookmark.");
      }
      const versions = state.versionsByBookmark.get(bookmark.id) ?? [];
      const now = new Date().toISOString();
      bookmark.sourceUrl = input.source.url;
      bookmark.canonicalUrl = input.source.canonicalUrl;
      bookmark.title = input.source.title;
      bookmark.domain = input.source.domain;
      bookmark.faviconUrl = input.source.faviconUrl;
      bookmark.coverImageUrl = input.source.coverImageUrl;
      bookmark.latestVersionId = existingByObjectKey.id;
      bookmark.latestQuality = input.quality;
      bookmark.updatedAt = now;
      bookmark.versionCount = versions.length;
      state.bookmarks.set(bookmark.id, bookmark);
      return {
        bookmark,
        versionId: existingByObjectKey.id,
        createdNewVersion: false,
        deduplicated: true,
      };
    }
    if (!pendingCapture) {
      throw new Error("Pending capture not found for object key.");
    }
    if (!(await this.objectStorage.hasObject(input.objectKey))) {
      throw new Error("Uploaded archive object not found.");
    }

    const normalizedUrl = normalizeSourceUrl(input.source.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);
    const now = new Date().toISOString();
    const bookmark = this.findBookmarkByNormalizedHash(state, normalizedUrlHash) ?? this.createBookmark(
      state,
      input,
      now,
    );
    const versions = state.versionsByBookmark.get(bookmark.id) ?? [];
    const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);

    if (matchedVersion) {
      await this.persistReaderArchive(state, matchedVersion, input.readerHtml);
      matchedVersion.mediaFiles = mergeBookmarkMediaFiles(matchedVersion.mediaFiles, input.mediaFiles);
      for (const mediaFile of matchedVersion.mediaFiles ?? []) {
        state.versionsByObjectKey.set(mediaFile.objectKey, matchedVersion);
      }
      state.pendingByObjectKey.delete(input.objectKey);
      bookmark.sourceUrl = input.source.url;
      bookmark.canonicalUrl = input.source.canonicalUrl;
      bookmark.title = input.source.title;
      bookmark.domain = input.source.domain;
      bookmark.faviconUrl = input.source.faviconUrl;
      bookmark.coverImageUrl = input.source.coverImageUrl;
      bookmark.latestVersionId = matchedVersion.id;
      bookmark.latestQuality = input.quality;
      bookmark.updatedAt = now;
      bookmark.versionCount = versions.length;
      state.bookmarks.set(bookmark.id, bookmark);
      return {
        bookmark,
        versionId: matchedVersion.id,
        createdNewVersion: false,
        deduplicated: true,
      };
    }

    const version: BookmarkVersion = {
      id: createVersionId(),
      bookmarkId: bookmark.id,
      versionNo: versions.length + 1,
      htmlObjectKey: input.objectKey,
      readerHtmlObjectKey: undefined,
      htmlSha256: input.htmlSha256,
      textSha256: input.textSha256,
      textSimhash: input.textSimhash,
      mediaFiles: input.mediaFiles ?? [],
      captureProfile: pendingCapture.request.profile ?? "standard",
      quality: input.quality,
      createdAt: now,
    };

    await this.persistReaderArchive(state, version, input.readerHtml);
    versions.push(version);
    state.versionsByBookmark.set(bookmark.id, versions);
    state.versionsByObjectKey.set(input.objectKey, version);
    if (version.readerHtmlObjectKey) {
      state.versionsByObjectKey.set(version.readerHtmlObjectKey, version);
    }
    for (const mediaFile of version.mediaFiles ?? []) {
      state.versionsByObjectKey.set(mediaFile.objectKey, version);
    }
    state.pendingByObjectKey.delete(input.objectKey);

    bookmark.latestVersionId = version.id;
    bookmark.latestQuality = input.quality;
    bookmark.sourceUrl = input.source.url;
    bookmark.canonicalUrl = input.source.canonicalUrl;
    bookmark.title = input.source.title;
    bookmark.domain = input.source.domain;
    bookmark.faviconUrl = input.source.faviconUrl;
    bookmark.coverImageUrl = input.source.coverImageUrl;
    bookmark.versionCount = versions.length;
    bookmark.updatedAt = now;
    state.bookmarks.set(bookmark.id, bookmark);

    return {
      bookmark,
      versionId: version.id,
      createdNewVersion: true,
      deduplicated: false,
    };
  }

  async completePrivateCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const state = this.ensureUserState(userId);
    const pendingCapture = state.privatePendingByObjectKey.get(input.objectKey);
    const existingByObjectKey = state.privateVersionsByObjectKey.get(input.objectKey);
    if (!pendingCapture && existingByObjectKey) {
      await this.persistReaderArchive(state, existingByObjectKey, input.readerHtml);
      existingByObjectKey.mediaFiles = mergeBookmarkMediaFiles(
        existingByObjectKey.mediaFiles,
        input.mediaFiles,
      );
      for (const mediaFile of existingByObjectKey.mediaFiles ?? []) {
        state.privateVersionsByObjectKey.set(mediaFile.objectKey, existingByObjectKey);
      }
      const bookmark = state.privateBookmarks.get(existingByObjectKey.bookmarkId);
      if (!bookmark) {
        throw new Error("Existing private version not linked to bookmark.");
      }
      const versions = state.privateVersionsByBookmark.get(bookmark.id) ?? [];
      const now = new Date().toISOString();
      bookmark.sourceUrl = input.source.url;
      bookmark.canonicalUrl = input.source.canonicalUrl;
      bookmark.title = input.source.title;
      bookmark.domain = input.source.domain;
      bookmark.faviconUrl = input.source.faviconUrl;
      bookmark.coverImageUrl = input.source.coverImageUrl;
      bookmark.latestVersionId = existingByObjectKey.id;
      bookmark.latestQuality = input.quality;
      bookmark.updatedAt = now;
      bookmark.versionCount = versions.length;
      state.privateBookmarks.set(bookmark.id, bookmark);
      return {
        bookmark,
        versionId: existingByObjectKey.id,
        createdNewVersion: false,
        deduplicated: true,
      };
    }
    if (!pendingCapture) {
      throw new Error("Pending private capture not found for object key.");
    }
    if (!(await this.objectStorage.hasObject(input.objectKey))) {
      throw new Error("Uploaded private archive object not found.");
    }

    const normalizedUrl = normalizeSourceUrl(input.source.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);
    const now = new Date().toISOString();
    const bookmark = this.findPrivateBookmarkByNormalizedHash(state, normalizedUrlHash)
      ?? this.createPrivateBookmark(state, input, now);
    const versions = state.privateVersionsByBookmark.get(bookmark.id) ?? [];
    const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);

    if (matchedVersion) {
      await this.persistReaderArchive(state, matchedVersion, input.readerHtml);
      matchedVersion.mediaFiles = mergeBookmarkMediaFiles(matchedVersion.mediaFiles, input.mediaFiles);
      for (const mediaFile of matchedVersion.mediaFiles ?? []) {
        state.privateVersionsByObjectKey.set(mediaFile.objectKey, matchedVersion);
      }
      state.privatePendingByObjectKey.delete(input.objectKey);
      bookmark.sourceUrl = input.source.url;
      bookmark.canonicalUrl = input.source.canonicalUrl;
      bookmark.title = input.source.title;
      bookmark.domain = input.source.domain;
      bookmark.faviconUrl = input.source.faviconUrl;
      bookmark.coverImageUrl = input.source.coverImageUrl;
      bookmark.latestVersionId = matchedVersion.id;
      bookmark.latestQuality = input.quality;
      bookmark.updatedAt = now;
      bookmark.versionCount = versions.length;
      state.privateBookmarks.set(bookmark.id, bookmark);
      return {
        bookmark,
        versionId: matchedVersion.id,
        createdNewVersion: false,
        deduplicated: true,
      };
    }

    const version: BookmarkVersion = {
      id: createVersionId(),
      bookmarkId: bookmark.id,
      versionNo: versions.length + 1,
      htmlObjectKey: input.objectKey,
      readerHtmlObjectKey: undefined,
      htmlSha256: input.htmlSha256,
      textSha256: input.textSha256,
      textSimhash: input.textSimhash,
      mediaFiles: input.mediaFiles ?? [],
      captureProfile: pendingCapture.request.profile ?? "standard",
      quality: input.quality,
      createdAt: now,
    };

    await this.persistReaderArchive(state, version, input.readerHtml);
    versions.push(version);
    state.privateVersionsByBookmark.set(bookmark.id, versions);
    state.privateVersionsByObjectKey.set(input.objectKey, version);
    if (version.readerHtmlObjectKey) {
      state.privateVersionsByObjectKey.set(version.readerHtmlObjectKey, version);
    }
    for (const mediaFile of version.mediaFiles ?? []) {
      state.privateVersionsByObjectKey.set(mediaFile.objectKey, version);
    }
    state.privatePendingByObjectKey.delete(input.objectKey);

    bookmark.latestVersionId = version.id;
    bookmark.latestQuality = input.quality;
    bookmark.sourceUrl = input.source.url;
    bookmark.canonicalUrl = input.source.canonicalUrl;
    bookmark.title = input.source.title;
    bookmark.domain = input.source.domain;
    bookmark.faviconUrl = input.source.faviconUrl;
    bookmark.coverImageUrl = input.source.coverImageUrl;
    bookmark.versionCount = versions.length;
    bookmark.updatedAt = now;
    state.privateBookmarks.set(bookmark.id, bookmark);

    return {
      bookmark,
      versionId: version.id,
      createdNewVersion: true,
      deduplicated: false,
    };
  }

  async ingestBookmark(userId: string, input: IngestBookmarkRequest): Promise<IngestBookmarkResult> {
    const state = this.ensureUserState(userId);
    const normalizedUrl = normalizeSourceUrl(input.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);
    const existing = this.findBookmarkByNormalizedHash(state, normalizedUrlHash);

    if (existing) {
      if (input.dedupeStrategy === "skip") {
        return {
          bookmark: existing,
          status: "skipped",
          deduplicated: true,
        };
      }

      const now = new Date().toISOString();
      const title = input.title?.trim();
      if (title) {
        existing.title = title;
      }
      if (input.note !== undefined) {
        existing.note = input.note;
      }
      if (input.folderPath?.trim()) {
        const folder = this.ensureFolderPath(state, input.folderPath);
        existing.folder = folder ? { ...folder } : undefined;
      }
      if (input.tags?.length) {
        const mergedTags = new Map(existing.tags.map((tag) => [tag.id, tag]));
        for (const tag of this.ensureTagsByName(state, input.tags)) {
          mergedTags.set(tag.id, tag);
        }
        existing.tags = [...mergedTags.values()].sort((left, right) => left.name.localeCompare(right.name));
      }
      existing.updatedAt = now;
      state.bookmarks.set(existing.id, existing);
      return {
        bookmark: existing,
        status: "merged",
        deduplicated: true,
      };
    }

    const now = new Date().toISOString();
    const folder = input.folderPath?.trim()
      ? this.ensureFolderPath(state, input.folderPath)
      : undefined;
    const bookmark: Bookmark = {
      id: createBookmarkId(),
      sourceUrl: normalizedUrl,
      canonicalUrl: undefined,
      title: this.resolveIngestTitle(input.title, normalizedUrl),
      domain: new URL(normalizedUrl).hostname,
      note: input.note ?? "",
      isFavorite: false,
      tags: this.ensureTagsByName(state, input.tags ?? []),
      folder: folder ? { ...folder } : undefined,
      latestVersionId: undefined,
      versionCount: 0,
      latestQuality: undefined,
      createdAt: now,
      updatedAt: now,
    };

    state.bookmarks.set(bookmark.id, bookmark);
    state.versionsByBookmark.set(bookmark.id, []);
    return {
      bookmark,
      status: "created",
      deduplicated: false,
    };
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery) {
    const state = this.ensureUserState(userId);
    const keyword = query.q?.trim().toLowerCase();
    const folderIds = query.folderId ? this.collectFolderSubtreeIds(state, query.folderId) : null;
    const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = [...state.bookmarks.values()].filter((bookmark) => {
      if (query.view === "favorites" && !bookmark.isFavorite) {
        return false;
      }

      if (query.view === "recent" && new Date(bookmark.updatedAt).getTime() < recentThreshold) {
        return false;
      }

      if (query.domain && bookmark.domain !== query.domain) {
        return false;
      }

      if (query.quality && bookmark.latestQuality?.grade !== query.quality) {
        return false;
      }

      if (query.tagId && !bookmark.tags.some((tag) => tag.id === query.tagId)) {
        return false;
      }

      if (folderIds) {
        if (!bookmark.folder || !folderIds.has(bookmark.folder.id)) {
          return false;
        }
      }

      if (!keyword) {
        return true;
      }

      const searchable = [
        bookmark.title,
        bookmark.sourceUrl,
        bookmark.domain,
        bookmark.note,
        bookmark.folder?.path ?? "",
        ...bookmark.tags.map((tag) => tag.name),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });

    filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
    };
  }

  async getBookmarkSidebarStats(userId: string) {
    const state = this.ensureUserState(userId);
    const folderCounts = new Map<string, number>();

    for (const bookmark of state.bookmarks.values()) {
      const folderId = bookmark.folder?.id;
      if (!folderId) {
        continue;
      }
      folderCounts.set(folderId, (folderCounts.get(folderId) ?? 0) + 1);
    }

    return {
      folderCounts: [...folderCounts.entries()].map(([folderId, count]) => ({
        folderId,
        count,
      })),
    };
  }

  async getBookmarkDetail(userId: string, bookmarkId: string) {
    const state = this.ensureUserState(userId);
    const bookmark = state.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return null;
    }

    const versions = [...(state.versionsByBookmark.get(bookmarkId) ?? [])].sort(
      (left, right) => right.versionNo - left.versionNo,
    );

    return {
      bookmark,
      versions,
    };
  }

  async searchPrivateBookmarks(userId: string, query: BookmarkSearchQuery) {
    const state = this.ensureUserState(userId);
    const keyword = query.q?.trim().toLowerCase();
    const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = [...state.privateBookmarks.values()].filter((bookmark) => {
      if (query.view === "favorites" && !bookmark.isFavorite) {
        return false;
      }

      if (query.view === "recent" && new Date(bookmark.updatedAt).getTime() < recentThreshold) {
        return false;
      }

      if (query.domain && bookmark.domain !== query.domain) {
        return false;
      }

      if (query.quality && bookmark.latestQuality?.grade !== query.quality) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const searchable = [
        bookmark.title,
        bookmark.sourceUrl,
        bookmark.domain,
        bookmark.note,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });

    filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
    };
  }

  async getPrivateBookmarkDetail(userId: string, bookmarkId: string) {
    const state = this.ensureUserState(userId);
    const bookmark = state.privateBookmarks.get(bookmarkId);
    if (!bookmark) {
      return null;
    }

    const versions = [...(state.privateVersionsByBookmark.get(bookmarkId) ?? [])].sort(
      (left, right) => right.versionNo - left.versionNo,
    );

    return {
      bookmark,
      versions,
    };
  }

  async deleteBookmark(userId: string, bookmarkId: string) {
    const state = this.ensureUserState(userId);
    const bookmark = state.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return false;
    }

    const versions = state.versionsByBookmark.get(bookmarkId) ?? [];
    for (const version of versions) {
      state.versionsByObjectKey.delete(version.htmlObjectKey);
      if (version.readerHtmlObjectKey) {
        state.versionsByObjectKey.delete(version.readerHtmlObjectKey);
      }
      for (const mediaFile of version.mediaFiles ?? []) {
        state.versionsByObjectKey.delete(mediaFile.objectKey);
      }
    }

    state.versionsByBookmark.delete(bookmarkId);
    state.bookmarks.delete(bookmarkId);
    return true;
  }

  async updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ) {
    const state = this.ensureUserState(userId);
    const bookmark = state.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return null;
    }

    const now = new Date().toISOString();
    if (input.note !== undefined) {
      bookmark.note = input.note;
    }

    if (input.isFavorite !== undefined) {
      bookmark.isFavorite = input.isFavorite;
    }

    if (input.folderPath !== undefined) {
      const folder = this.ensureFolderPath(state, input.folderPath);
      if (!folder) {
        bookmark.folder = undefined;
      } else {
        bookmark.folder = { ...folder };
      }
    } else if (input.folderId !== undefined) {
      if (input.folderId === null) {
        bookmark.folder = undefined;
      } else {
        const folder = state.folders.get(input.folderId);
        if (!folder) {
          throw new HttpError(404, "FolderNotFound", "Folder not found.");
        }
        bookmark.folder = { ...folder };
      }
    }

    if (input.tags !== undefined) {
      bookmark.tags = this.ensureTagsByName(state, input.tags);
    } else if (input.tagIds !== undefined) {
      const nextTags = this.resolveTagIds(state, input.tagIds);
      bookmark.tags = nextTags;
    }

    bookmark.updatedAt = now;
    state.bookmarks.set(bookmark.id, bookmark);
    return bookmark;
  }

  async listFolders(userId: string) {
    const state = this.ensureUserState(userId);
    return [...state.folders.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async createFolder(userId: string, input: FolderCreateRequest) {
    const state = this.ensureUserState(userId);
    const parent = input.parentId ? state.folders.get(input.parentId) : undefined;
    if (input.parentId && !parent) {
      throw new HttpError(404, "FolderNotFound", "Parent folder not found.");
    }

    const path = this.buildFolderPath(parent?.path, input.name);
    this.assertUniqueFolderPath(state, path);
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: input.name,
      path,
      parentId: parent?.id ?? null,
    };
    state.folders.set(folder.id, folder);
    return folder;
  }

  async updateFolder(userId: string, folderId: string, input: FolderUpdateRequest) {
    const state = this.ensureUserState(userId);
    const current = state.folders.get(folderId);
    if (!current) {
      return null;
    }

    const nextName = input.name ?? current.name;
    const nextParentId = input.parentId !== undefined ? input.parentId : current.parentId ?? null;
    if (nextParentId === folderId) {
      throw new HttpError(400, "InvalidFolderMove", "Folder cannot be its own parent.");
    }

    const descendants = this.collectFolderSubtree(state, current.path);
    const descendantIds = new Set(descendants.map((folder) => folder.id));
    if (nextParentId && descendantIds.has(nextParentId)) {
      throw new HttpError(400, "InvalidFolderMove", "Folder cannot be moved into its child.");
    }

    const parent = nextParentId ? state.folders.get(nextParentId) : undefined;
    if (nextParentId && !parent) {
      throw new HttpError(404, "FolderNotFound", "Parent folder not found.");
    }

    const nextPath = this.buildFolderPath(parent?.path, nextName);
    const nextPaths = new Map<string, string>();
    for (const folder of descendants) {
      const candidatePath = folder.id === folderId
        ? nextPath
        : `${nextPath}${folder.path.slice(current.path.length)}`;
      nextPaths.set(folder.id, candidatePath);
    }
    this.assertFolderPathSetAvailable(state, nextPaths, descendantIds);

    for (const folder of descendants) {
      const candidatePath = nextPaths.get(folder.id);
      if (!candidatePath) {
        continue;
      }
      if (folder.id === folderId) {
        folder.name = nextName;
        folder.parentId = nextParentId;
      }
      folder.path = candidatePath;
      state.folders.set(folder.id, folder);
    }

    this.syncBookmarksForFolders(state, descendantIds, new Date().toISOString());
    return state.folders.get(folderId) ?? null;
  }

  async deleteFolder(userId: string, folderId: string) {
    const state = this.ensureUserState(userId);
    const current = state.folders.get(folderId);
    if (!current) {
      return false;
    }

    const subtree = this.collectFolderSubtree(state, current.path);
    const subtreeIds = new Set(subtree.map((folder) => folder.id));
    const parentPath = current.parentId
      ? state.folders.get(current.parentId)?.path
      : undefined;
    const nextPaths = new Map<string, string>();
    for (const folder of subtree) {
      if (folder.id === folderId) {
        continue;
      }
      const relativePath = folder.path.slice(current.path.length + 1);
      const candidatePath = parentPath ? `${parentPath}/${relativePath}` : relativePath;
      nextPaths.set(folder.id, candidatePath);
    }
    this.assertFolderPathSetAvailable(state, nextPaths, subtreeIds);

    for (const folder of subtree) {
      if (folder.id === folderId) {
        continue;
      }
      const nextPath = nextPaths.get(folder.id);
      if (!nextPath) {
        continue;
      }
      if (folder.parentId === folderId) {
        folder.parentId = current.parentId ?? null;
      }
      folder.path = nextPath;
      state.folders.set(folder.id, folder);
    }

    state.folders.delete(folderId);

    const now = new Date().toISOString();
    for (const bookmark of state.bookmarks.values()) {
      if (!bookmark.folder) {
        continue;
      }
      if (bookmark.folder.id === folderId) {
        bookmark.folder = undefined;
        bookmark.updatedAt = now;
        continue;
      }
      if (subtreeIds.has(bookmark.folder.id)) {
        const folder = state.folders.get(bookmark.folder.id);
        if (folder) {
          bookmark.folder = { ...folder };
          bookmark.updatedAt = now;
        }
      }
    }

    return true;
  }

  async listTags(userId: string) {
    const state = this.ensureUserState(userId);
    return [...state.tags.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async createTag(userId: string, input: TagCreateRequest) {
    const state = this.ensureUserState(userId);
    this.assertUniqueTagName(state, input.name);
    const tag: Tag = {
      id: crypto.randomUUID(),
      name: input.name,
      color: input.color,
    };
    state.tags.set(tag.id, tag);
    return tag;
  }

  async updateTag(userId: string, tagId: string, input: TagUpdateRequest) {
    const state = this.ensureUserState(userId);
    const current = state.tags.get(tagId);
    if (!current) {
      return null;
    }

    const nextName = input.name ?? current.name;
    const nextColor = input.color === undefined ? current.color : input.color ?? undefined;
    this.assertUniqueTagName(state, nextName, tagId);
    current.name = nextName;
    current.color = nextColor;
    state.tags.set(tagId, current);

    const now = new Date().toISOString();
    for (const bookmark of state.bookmarks.values()) {
      const index = bookmark.tags.findIndex((tag) => tag.id === tagId);
      if (index < 0) {
        continue;
      }
      bookmark.tags[index] = { ...current };
      bookmark.updatedAt = now;
    }

    return current;
  }

  async deleteTag(userId: string, tagId: string) {
    const state = this.ensureUserState(userId);
    const existed = state.tags.delete(tagId);
    if (!existed) {
      return false;
    }

    const now = new Date().toISOString();
    for (const bookmark of state.bookmarks.values()) {
      const nextTags = bookmark.tags.filter((tag) => tag.id !== tagId);
      if (nextTags.length === bookmark.tags.length) {
        continue;
      }
      bookmark.tags = nextTags;
      bookmark.updatedAt = now;
    }

    return true;
  }

  async findImportBookmarkMatches(userId: string, normalizedUrlHashes: string[]) {
    const state = this.ensureUserState(userId);
    const targetHashes = new Set(normalizedUrlHashes);
    const matches: ImportBookmarkMatch[] = [];

    for (const bookmark of state.bookmarks.values()) {
      const normalizedUrlHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (!targetHashes.has(normalizedUrlHash)) {
        continue;
      }
      matches.push({
        normalizedUrlHash,
        bookmarkId: bookmark.id,
        title: bookmark.title,
        hasArchive: (bookmark.versionCount ?? 0) > 0,
        latestVersionId: bookmark.latestVersionId,
      });
    }

    return matches;
  }

  async createImportTask(userId: string, input: CreateImportTaskInput): Promise<ImportTaskDetailResponse> {
    const state = this.ensureUserState(userId);
    const now = new Date().toISOString();
    const taskId = createImportTaskId();
    const existingMatches = await this.findImportBookmarkMatches(
      userId,
      input.items
        .map((item) => item.normalizedUrlHash)
        .filter((value): value is string => Boolean(value)),
    );
    const matchMap = new Map(existingMatches.map((match) => [match.normalizedUrlHash, match]));
    const items: ImportTaskItem[] = [];

    let createdCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of input.items) {
      const itemNow = new Date().toISOString();
      if (!item.valid) {
        items.push(this.createImportTaskItem(taskId, item, {
          status: "skipped",
          dedupeResult: "invalid_input",
          reason: item.reason ?? "无法解析的链接。",
          createdAt: itemNow,
          updatedAt: itemNow,
        }));
        skippedCount += 1;
        continue;
      }

      if (item.duplicateInFile) {
        items.push(this.createImportTaskItem(taskId, item, {
          status: "skipped",
          dedupeResult: "skipped_duplicate",
          reason: item.reason ?? "与本次导入中的更早条目重复。",
          createdAt: itemNow,
          updatedAt: itemNow,
        }));
        skippedCount += 1;
        continue;
      }

      const existing = item.normalizedUrlHash ? matchMap.get(item.normalizedUrlHash) : undefined;
      if (existing) {
        if (input.options.dedupeStrategy === "update_metadata") {
          const existingBookmark = state.bookmarks.get(existing.bookmarkId);
          if (existingBookmark) {
            existingBookmark.title = this.pickImportTitle(existingBookmark.title, item, input.options);
            existingBookmark.folder = this.resolveFolder(state, item, input.options);
            existingBookmark.updatedAt = itemNow;
            state.bookmarks.set(existingBookmark.id, existingBookmark);
          }
        }

        if (input.options.dedupeStrategy === "skip") {
          items.push(this.createImportTaskItem(taskId, item, {
            status: "skipped",
            dedupeResult: "skipped_existing",
            reason: "站内已存在同一链接，按当前策略跳过。",
            bookmarkId: existing.bookmarkId,
            hasArchive: existing.hasArchive,
            archivedVersionId: existing.latestVersionId,
            createdAt: itemNow,
            updatedAt: itemNow,
          }));
          skippedCount += 1;
        } else {
          items.push(this.createImportTaskItem(taskId, item, {
            status: "deduplicated",
            dedupeResult: "merged_existing",
            reason: existing.hasArchive ? "已合并到现有书签，且该书签已有归档。" : "已合并到现有书签。",
            bookmarkId: existing.bookmarkId,
            hasArchive: existing.hasArchive,
            archivedVersionId: existing.latestVersionId,
            createdAt: itemNow,
            updatedAt: itemNow,
          }));
          mergedCount += 1;
        }
        continue;
      }

      try {
        const bookmark = this.createImportedBookmark(state, item, input.taskName, input.options, itemNow);
        items.push(this.createImportTaskItem(taskId, item, {
          status: "created_bookmark",
          dedupeResult: "created_bookmark",
          reason: input.options.mode === "links_only" ? "已完成轻导入。" : "已完成轻导入，云端存档已排队。",
          bookmarkId: bookmark.id,
          hasArchive: false,
          createdAt: itemNow,
          updatedAt: itemNow,
        }));
        createdCount += 1;
      } catch (error) {
        items.push(this.createImportTaskItem(taskId, item, {
          status: "failed",
          dedupeResult: "none",
          reason: error instanceof Error ? error.message : "导入时发生未知错误。",
          createdAt: itemNow,
          updatedAt: itemNow,
        }));
        failedCount += 1;
      }
    }

    const taskStatus = failedCount > 0 || input.preview.summary.invalidCount > 0
      ? "partial_failed"
      : "completed";
    const task = importTaskSchema.parse({
      id: taskId,
      name: input.taskName,
      sourceType: input.sourceType,
      mode: input.options.mode,
      status: taskStatus,
      fileName: input.fileName,
      totalCount: input.preview.summary.totalCount,
      validCount: input.preview.summary.validCount,
      invalidCount: input.preview.summary.invalidCount,
      duplicateInFileCount: input.preview.summary.duplicateInFileCount,
      duplicateExistingCount: input.preview.summary.duplicateExistingCount,
      createdCount,
      mergedCount,
      skippedCount,
      failedCount,
      archiveQueuedCount: 0,
      archiveSuccessCount: 0,
      archiveFailedCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    state.importTasks.set(task.id, task);
    state.importItemsByTaskId.set(task.id, items);

    return importTaskDetailResponseSchema.parse({
      task,
      items,
    });
  }

  async listImportTasks(userId: string) {
    const state = this.ensureUserState(userId);
    return [...state.importTasks.values()].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
  }

  async getImportTaskDetail(userId: string, taskId: string) {
    const state = this.ensureUserState(userId);
    const task = state.importTasks.get(taskId);
    if (!task) {
      return null;
    }
    return importTaskDetailResponseSchema.parse({
      task,
      items: state.importItemsByTaskId.get(taskId) ?? [],
    });
  }

  async userCanReadObject(userId: string, objectKey: string) {
    const state = this.ensureUserState(userId);
    if (state.versionsByObjectKey.has(objectKey)) {
      return true;
    }
    if (state.privateVersionsByObjectKey.has(objectKey)) {
      return true;
    }

    const ownerObjectKey = deriveHtmlObjectKeyFromMediaObjectKey(objectKey);
    return ownerObjectKey
      ? state.versionsByObjectKey.has(ownerObjectKey) || state.privateVersionsByObjectKey.has(ownerObjectKey)
      : false;
  }

  async userCanWriteObject(userId: string, objectKey: string) {
    const state = this.ensureUserState(userId);
    if (state.pendingByObjectKey.has(objectKey) || state.versionsByObjectKey.has(objectKey)) {
      return true;
    }
    if (state.privatePendingByObjectKey.has(objectKey) || state.privateVersionsByObjectKey.has(objectKey)) {
      return true;
    }

    const ownerObjectKey = deriveHtmlObjectKeyFromMediaObjectKey(objectKey);
    return ownerObjectKey
      ? state.pendingByObjectKey.has(ownerObjectKey)
        || state.versionsByObjectKey.has(ownerObjectKey)
        || state.privatePendingByObjectKey.has(ownerObjectKey)
        || state.privateVersionsByObjectKey.has(ownerObjectKey)
      : false;
  }

  private ensureUserState(userId: string): UserBookmarkState {
    const existing = this.stateByUserId.get(userId);
    if (existing) {
      return existing;
    }
    const created: UserBookmarkState = {
      bookmarks: new Map(),
      versionsByBookmark: new Map(),
      pendingByObjectKey: new Map(),
      versionsByObjectKey: new Map(),
      privateBookmarks: new Map(),
      privateVersionsByBookmark: new Map(),
      privatePendingByObjectKey: new Map(),
      privateVersionsByObjectKey: new Map(),
      privateModeConfig: null,
      folders: new Map(),
      tags: new Map(),
      importTasks: new Map(),
      importItemsByTaskId: new Map(),
    };
    this.stateByUserId.set(userId, created);
    return created;
  }

  private buildFolderPath(parentPath: string | undefined, name: string) {
    return parentPath ? `${parentPath}/${name}` : name;
  }

  private collectFolderSubtree(state: UserBookmarkState, rootPath: string) {
    return [...state.folders.values()]
      .filter((folder) => folder.path === rootPath || folder.path.startsWith(`${rootPath}/`))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private collectFolderSubtreeIds(state: UserBookmarkState, folderId: string) {
    const folder = state.folders.get(folderId);
    if (!folder) {
      return new Set<string>();
    }
    return new Set(this.collectFolderSubtree(state, folder.path).map((item) => item.id));
  }

  private assertUniqueFolderPath(
    state: UserBookmarkState,
    path: string,
    excludeFolderId?: string,
  ) {
    for (const folder of state.folders.values()) {
      if (folder.id === excludeFolderId) {
        continue;
      }
      if (folder.path === path) {
        throw new HttpError(409, "FolderPathConflict", "Folder path already exists.");
      }
    }
  }

  private assertFolderPathSetAvailable(
    state: UserBookmarkState,
    nextPaths: Map<string, string>,
    ignoredFolderIds: Set<string>,
  ) {
    const seen = new Set<string>();
    for (const nextPath of nextPaths.values()) {
      if (seen.has(nextPath)) {
        throw new HttpError(409, "FolderPathConflict", "Folder path already exists.");
      }
      seen.add(nextPath);
    }

    for (const folder of state.folders.values()) {
      if (ignoredFolderIds.has(folder.id)) {
        continue;
      }
      if (seen.has(folder.path)) {
        throw new HttpError(409, "FolderPathConflict", "Folder path already exists.");
      }
    }
  }

  private assertUniqueTagName(state: UserBookmarkState, name: string, excludeTagId?: string) {
    for (const tag of state.tags.values()) {
      if (tag.id === excludeTagId) {
        continue;
      }
      if (tag.name === name) {
        throw new HttpError(409, "TagNameConflict", "Tag name already exists.");
      }
    }
  }

  private resolveTagIds(state: UserBookmarkState, tagIds: string[]) {
    const deduplicatedIds = [...new Set(tagIds)];
    return deduplicatedIds.map((tagId) => {
      const tag = state.tags.get(tagId);
      if (!tag) {
        throw new HttpError(404, "TagNotFound", "Tag not found.");
      }
      return { ...tag };
    });
  }

  private syncBookmarksForFolders(state: UserBookmarkState, folderIds: Set<string>, now: string) {
    for (const bookmark of state.bookmarks.values()) {
      if (!bookmark.folder || !folderIds.has(bookmark.folder.id)) {
        continue;
      }
      const folder = state.folders.get(bookmark.folder.id);
      if (!folder) {
        bookmark.folder = undefined;
      } else {
        bookmark.folder = { ...folder };
      }
      bookmark.updatedAt = now;
    }
  }

  private findBookmarkByNormalizedHash(state: UserBookmarkState, normalizedHash: string) {
    for (const bookmark of state.bookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash === normalizedHash) {
        return bookmark;
      }
    }
    return undefined;
  }

  private createBookmark(
    state: UserBookmarkState,
    input: CaptureCompleteRequest,
    now: string,
  ): Bookmark {
    const bookmark: Bookmark = {
      id: createBookmarkId(),
      sourceUrl: input.source.url,
      canonicalUrl: input.source.canonicalUrl,
      title: input.source.title,
      domain: input.source.domain,
      faviconUrl: input.source.faviconUrl,
      coverImageUrl: input.source.coverImageUrl,
      note: "",
      isFavorite: false,
      tags: [],
      versionCount: 1,
      latestQuality: input.quality,
      createdAt: now,
      updatedAt: now,
    };
    state.bookmarks.set(bookmark.id, bookmark);
    return bookmark;
  }

  private findPrivateBookmarkByNormalizedHash(state: UserBookmarkState, normalizedHash: string) {
    for (const bookmark of state.privateBookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash === normalizedHash) {
        return bookmark;
      }
    }
    return undefined;
  }

  private createPrivateBookmark(
    state: UserBookmarkState,
    input: CaptureCompleteRequest,
    now: string,
  ): Bookmark {
    const bookmark: Bookmark = {
      id: createBookmarkId(),
      sourceUrl: input.source.url,
      canonicalUrl: input.source.canonicalUrl,
      title: input.source.title,
      domain: input.source.domain,
      faviconUrl: input.source.faviconUrl,
      coverImageUrl: input.source.coverImageUrl,
      note: "",
      isFavorite: false,
      tags: [],
      versionCount: 1,
      latestQuality: input.quality,
      createdAt: now,
      updatedAt: now,
    };
    state.privateBookmarks.set(bookmark.id, bookmark);
    return bookmark;
  }

  private findObjectKeyByVersionId(state: UserBookmarkState, versionId: string) {
    for (const [objectKey, version] of state.versionsByObjectKey.entries()) {
      if (version.id === versionId) {
        return objectKey;
      }
    }
    return undefined;
  }

  private findBookmarkByVersionId(state: UserBookmarkState, versionId: string) {
    for (const [bookmarkId, versions] of state.versionsByBookmark.entries()) {
      const hasVersion = versions.some((version) => version.id === versionId);
      if (!hasVersion) {
        continue;
      }
      return state.bookmarks.get(bookmarkId);
    }
    return undefined;
  }

  private createImportedBookmark(
    state: UserBookmarkState,
    item: PreparedImportItem,
    taskName: string,
    options: ImportExecutionOptions,
    now: string,
  ) {
    if (!item.url || !item.domain) {
      throw new Error("导入条目缺少有效 URL。");
    }

    const bookmark: Bookmark = {
      id: createBookmarkId(),
      sourceUrl: item.url,
      canonicalUrl: undefined,
      title: this.pickImportTitle(item.url, item, options),
      domain: item.domain,
      note: "",
      isFavorite: false,
      tags: this.resolveTags(state, item, taskName, options),
      folder: this.resolveFolder(state, item, options),
      latestVersionId: undefined,
      versionCount: 0,
      latestQuality: undefined,
      createdAt: now,
      updatedAt: now,
    };

    state.bookmarks.set(bookmark.id, bookmark);
    state.versionsByBookmark.set(bookmark.id, []);
    return bookmark;
  }

  private pickImportTitle(
    fallbackTitle: string,
    item: PreparedImportItem,
    options: ImportExecutionOptions,
  ) {
    if (options.titleStrategy === "prefer_page_title") {
      return fallbackTitle;
    }
    const candidate = item.title.trim();
    return candidate || fallbackTitle;
  }

  private resolveFolder(
    state: UserBookmarkState,
    item: PreparedImportItem,
    options: ImportExecutionOptions,
  ) {
    if (options.targetFolderMode === "flatten") {
      return undefined;
    }

    const folderPath = options.targetFolderMode === "specific"
      ? options.targetFolderPath?.trim()
      : item.folderPath?.trim();
    if (!folderPath) {
      return undefined;
    }
    return this.ensureFolderPath(state, folderPath);
  }

  private resolveTags(
    state: UserBookmarkState,
    item: PreparedImportItem,
    _taskName: string,
    options: ImportExecutionOptions,
  ) {
    const names = new Set<string>();
    if (options.tagStrategy === "keep_source_tags") {
      for (const tagName of item.sourceTags) {
        names.add(tagName);
      }
    }

    return [...names].map((tagName) => {
      const existing = [...state.tags.values()].find((tag) => tag.name === tagName);
      if (existing) {
        return existing;
      }
      const created: Tag = {
        id: crypto.randomUUID(),
        name: tagName,
      };
      state.tags.set(created.id, created);
      return created;
    });
  }

  private ensureFolderPath(state: UserBookmarkState, folderPath: string) {
    const segments = folderPath.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }

    let currentPath = "";
    let parent: Folder | undefined;
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = [...state.folders.values()].find((folder) => folder.path === currentPath);
      if (existing) {
        parent = existing;
        continue;
      }

      const created: Folder = {
        id: crypto.randomUUID(),
        name: segment,
        path: currentPath,
        parentId: parent?.id ?? null,
      };
      state.folders.set(created.id, created);
      parent = created;
    }

    return parent;
  }

  private ensureTagsByName(state: UserBookmarkState, names: string[]) {
    const deduplicated = [...new Set(
      names
        .map((name) => name.trim())
        .filter(Boolean),
    )];

    return deduplicated
      .map((tagName) => {
        const existing = [...state.tags.values()].find((tag) => tag.name === tagName);
        if (existing) {
          return { ...existing };
        }

        const created: Tag = {
          id: crypto.randomUUID(),
          name: tagName,
        };
        state.tags.set(created.id, created);
        return { ...created };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private resolveIngestTitle(inputTitle: string | undefined, normalizedUrl: string) {
    const title = inputTitle?.trim();
    return title || normalizedUrl;
  }

  private toPublicApiToken(token: StoredApiToken): ApiToken {
    return {
      id: token.id,
      name: token.name,
      tokenPreview: token.tokenPreview,
      scopes: [...token.scopes],
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
    };
  }

  private createImportTaskItem(
    taskId: string,
    item: PreparedImportItem,
    overrides: Partial<Omit<ImportTaskItem, "id" | "taskId" | "index" | "title" | "url" | "domain" | "folderPath">>,
  ) {
    return {
      id: createImportTaskItemId(),
      taskId,
      index: item.index,
      title: item.title,
      url: item.url,
      domain: item.domain,
      folderPath: item.folderPath,
      status: "pending",
      dedupeResult: "none",
      hasArchive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    } satisfies ImportTaskItem;
  }

  private createObjectKey(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${userId}/${day}/${crypto.randomUUID()}.html`;
  }

  private createPrivateObjectKey(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `private-captures/${userId}/${day}/${crypto.randomUUID()}.html`;
  }

  private createReaderObjectKey(objectKey: string) {
    return objectKey.endsWith(".html")
      ? objectKey.replace(/\.html$/i, ".reader.html")
      : `${objectKey}.reader.html`;
  }

  private async persistReaderArchive(
    state: UserBookmarkState,
    version: BookmarkVersion,
    readerHtml?: string,
  ) {
    const normalizedReaderHtml = readerHtml?.trim();
    if (!normalizedReaderHtml || version.readerHtmlObjectKey) {
      return;
    }

    const readerObjectKey = this.createReaderObjectKey(version.htmlObjectKey);
    await this.objectStorage.putObject(
      readerObjectKey,
      Buffer.from(normalizedReaderHtml),
      {
        contentType: "text/html;charset=utf-8",
      },
    );
    version.readerHtmlObjectKey = readerObjectKey;
    if (state.bookmarks.has(version.bookmarkId)) {
      state.versionsByObjectKey.set(readerObjectKey, version);
      return;
    }
    state.privateVersionsByObjectKey.set(readerObjectKey, version);
  }
}
