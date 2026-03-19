import {
  createBookmarkId,
  createVersionId,
  type AuthUser,
  type Bookmark,
  type BookmarkVersion,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
} from "@keeppage/domain";
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

  private createObjectKey(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${userId}/${day}/${crypto.randomUUID()}.html`;
  }
}
