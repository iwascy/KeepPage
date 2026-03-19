import {
  createBookmarkId,
  createImportTaskId,
  createImportTaskItemId,
  createVersionId,
  type AuthUser,
  type Bookmark,
  type BookmarkVersion,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
  importTaskDetailResponseSchema,
  importTaskSchema,
  type Folder,
  type ImportExecutionOptions,
  type ImportTask,
  type ImportTaskDetailResponse,
  type ImportTaskItem,
  type Tag,
} from "@keeppage/domain";
import { hashNormalizedUrl, normalizeSourceUrl } from "../lib/url";
import type { ObjectStorage } from "../storage/object-storage";
import type {
  BookmarkRepository,
  BookmarkSearchQuery,
  CreateImportTaskInput,
  CompleteCaptureResult,
  ImportBookmarkMatch,
  InitCaptureResult,
  PreparedImportItem,
  UserAuthRecord,
} from "./bookmark-repository";

type PendingCapture = {
  objectKey: string;
  request: CaptureInitRequest;
};

type StoredUser = UserAuthRecord;

type UserBookmarkState = {
  bookmarks: Map<string, Bookmark>;
  versionsByBookmark: Map<string, BookmarkVersion[]>;
  pendingByObjectKey: Map<string, PendingCapture>;
  versionsByObjectKey: Map<string, BookmarkVersion>;
  foldersByPath: Map<string, Folder>;
  tagsByName: Map<string, Tag>;
  importTasks: Map<string, ImportTask>;
  importItemsByTaskId: Map<string, ImportTaskItem[]>;
};

type InMemoryBookmarkRepositoryOptions = {
  objectStorage: ObjectStorage;
};

export class InMemoryBookmarkRepository implements BookmarkRepository {
  readonly kind = "memory" as const;

  private readonly usersById = new Map<string, StoredUser>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly stateByUserId = new Map<string, UserBookmarkState>();
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
    this.userIdsByEmail.set(input.email, user.id);
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

  async completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const state = this.ensureUserState(userId);
    const pendingCapture = state.pendingByObjectKey.get(input.objectKey);
    const existingByObjectKey = state.versionsByObjectKey.get(input.objectKey);
    if (!pendingCapture && existingByObjectKey) {
      const bookmark = this.findBookmarkByVersionId(state, existingByObjectKey.id);
      if (!bookmark) {
        throw new Error("Existing version not linked to bookmark.");
      }
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
      state.pendingByObjectKey.delete(input.objectKey);
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
      htmlSha256: input.htmlSha256,
      textSha256: input.textSha256,
      textSimhash: input.textSimhash,
      captureProfile: pendingCapture.request.profile ?? "standard",
      quality: input.quality,
      createdAt: now,
    };

    versions.push(version);
    state.versionsByBookmark.set(bookmark.id, versions);
    state.versionsByObjectKey.set(input.objectKey, version);
    state.pendingByObjectKey.delete(input.objectKey);

    bookmark.latestVersionId = version.id;
    bookmark.latestQuality = input.quality;
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

  async searchBookmarks(userId: string, query: BookmarkSearchQuery) {
    const state = this.ensureUserState(userId);
    const keyword = query.q?.trim().toLowerCase();
    const filtered = [...state.bookmarks.values()].filter((bookmark) => {
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
          reason: input.options.mode === "links_only" ? "已完成轻导入。" : "已完成轻导入，批量归档将在后续版本接入。",
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
    return state.versionsByObjectKey.has(objectKey);
  }

  async userCanWriteObject(userId: string, objectKey: string) {
    const state = this.ensureUserState(userId);
    return state.pendingByObjectKey.has(objectKey) || state.versionsByObjectKey.has(objectKey);
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
      foldersByPath: new Map(),
      tagsByName: new Map(),
      importTasks: new Map(),
      importItemsByTaskId: new Map(),
    };
    this.stateByUserId.set(userId, created);
    return created;
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
      note: "",
      tags: [],
      versionCount: 1,
      latestQuality: input.quality,
      createdAt: now,
      updatedAt: now,
    };
    state.bookmarks.set(bookmark.id, bookmark);
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

    const existing = state.foldersByPath.get(folderPath);
    if (existing) {
      return existing;
    }

    const segments = folderPath.split("/").map((segment) => segment.trim()).filter(Boolean);
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: segments[segments.length - 1] ?? folderPath,
      path: folderPath,
    };
    state.foldersByPath.set(folderPath, folder);
    return folder;
  }

  private resolveTags(
    state: UserBookmarkState,
    item: PreparedImportItem,
    taskName: string,
    options: ImportExecutionOptions,
  ) {
    const names = new Set<string>();
    if (options.tagStrategy === "keep_source_tags") {
      for (const tagName of item.sourceTags) {
        names.add(tagName);
      }
    }
    if (options.tagStrategy === "append_batch_tag") {
      names.add(`导入批次:${taskName}`);
    }

    return [...names].map((tagName) => {
      const existing = state.tagsByName.get(tagName);
      if (existing) {
        return existing;
      }
      const created: Tag = {
        id: crypto.randomUUID(),
        name: tagName,
      };
      state.tagsByName.set(tagName, created);
      return created;
    });
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
}
