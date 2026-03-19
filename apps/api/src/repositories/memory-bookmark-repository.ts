import {
  createBookmarkId,
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
  type Tag,
  type TagCreateRequest,
  type TagUpdateRequest,
} from "@keeppage/domain";
import { HttpError } from "../lib/http-error";
import { hashNormalizedUrl, normalizeSourceUrl } from "../lib/url";
import type { ObjectStorage } from "../storage/object-storage";
import type {
  BookmarkRepository,
  BookmarkSearchQuery,
  CompleteCaptureResult,
  InitCaptureResult,
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
  folders: Map<string, Folder>;
  tags: Map<string, Tag>;
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
    const folderIds = query.folderId ? this.collectFolderSubtreeIds(state, query.folderId) : null;
    const filtered = [...state.bookmarks.values()].filter((bookmark) => {
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

    if (input.folderId !== undefined) {
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

    if (input.tagIds !== undefined) {
      const nextTags = this.resolveTags(state, input.tagIds);
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
      folders: new Map(),
      tags: new Map(),
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

  private resolveTags(state: UserBookmarkState, tagIds: string[]) {
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

  private createObjectKey(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${userId}/${day}/${crypto.randomUUID()}.html`;
  }
}
