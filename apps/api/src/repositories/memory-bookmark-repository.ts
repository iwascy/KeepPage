import {
  bookmarkSearchResponseSchema,
  createBookmarkId,
  createVersionId,
  type Bookmark,
  type BookmarkVersion,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
} from "@keeppage/domain";
import { hashNormalizedUrl, normalizeSourceUrl } from "../lib/url";
import type { ObjectStorage } from "../storage/object-storage";
import type {
  BookmarkRepository,
  InitCaptureResult,
  BookmarkSearchQuery,
  CompleteCaptureResult,
} from "./bookmark-repository";

type PendingCapture = {
  objectKey: string;
  request: CaptureInitRequest;
};

type InMemoryBookmarkRepositoryOptions = {
  objectStorage: ObjectStorage;
};

export class InMemoryBookmarkRepository implements BookmarkRepository {
  readonly kind = "memory" as const;

  private readonly bookmarks = new Map<string, Bookmark>();
  private readonly versionsByBookmark = new Map<string, BookmarkVersion[]>();
  private readonly pendingByObjectKey = new Map<string, PendingCapture>();
  private readonly versionsByObjectKey = new Map<string, BookmarkVersion>();
  private readonly objectStorage: ObjectStorage;

  constructor(options: InMemoryBookmarkRepositoryOptions) {
    this.objectStorage = options.objectStorage;
  }

  async initCapture(input: CaptureInitRequest): Promise<InitCaptureResult> {
    const normalizedUrl = normalizeSourceUrl(input.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);

    for (const bookmark of this.bookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash !== normalizedUrlHash) {
        continue;
      }

      const versions = this.versionsByBookmark.get(bookmark.id) ?? [];
      const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);
      if (!matchedVersion) {
        continue;
      }

      const existingObjectKey = this.findObjectKeyByVersionId(matchedVersion.id);
      return {
        alreadyExists: true,
        bookmarkId: bookmark.id,
        versionId: matchedVersion.id,
        objectKey: existingObjectKey ?? this.createObjectKey(),
      };
    }

    for (const pendingCapture of this.pendingByObjectKey.values()) {
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

    const objectKey = this.createObjectKey();
    this.pendingByObjectKey.set(objectKey, { objectKey, request: input });
    return { alreadyExists: false, objectKey };
  }

  async completeCapture(input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const pendingCapture = this.pendingByObjectKey.get(input.objectKey);
    const existingByObjectKey = this.versionsByObjectKey.get(input.objectKey);
    if (!pendingCapture && existingByObjectKey) {
      const bookmark = this.findBookmarkByVersionId(existingByObjectKey.id);
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
    const bookmark = this.findBookmarkByNormalizedHash(normalizedUrlHash) ?? this.createBookmark(input, now);
    const versions = this.versionsByBookmark.get(bookmark.id) ?? [];
    const matchedVersion = versions.find((version) => version.htmlSha256 === input.htmlSha256);

    if (matchedVersion) {
      this.pendingByObjectKey.delete(input.objectKey);
      bookmark.latestVersionId = matchedVersion.id;
      bookmark.latestQuality = input.quality;
      bookmark.updatedAt = now;
      this.bookmarks.set(bookmark.id, bookmark);
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
      captureProfile: pendingCapture?.request.profile ?? "standard",
      quality: input.quality,
      createdAt: now,
    };

    versions.push(version);
    this.versionsByBookmark.set(bookmark.id, versions);
    this.versionsByObjectKey.set(input.objectKey, version);
    this.pendingByObjectKey.delete(input.objectKey);

    bookmark.latestVersionId = version.id;
    bookmark.latestQuality = input.quality;
    bookmark.versionCount = versions.length;
    bookmark.updatedAt = now;
    this.bookmarks.set(bookmark.id, bookmark);

    return {
      bookmark,
      versionId: version.id,
      createdNewVersion: true,
      deduplicated: false,
    };
  }

  async searchBookmarks(query: BookmarkSearchQuery) {
    const keyword = query.q?.trim().toLowerCase();
    const filtered = [...this.bookmarks.values()].filter((bookmark) => {
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

    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const paginated = filtered.slice(query.offset, query.offset + query.limit);
    return bookmarkSearchResponseSchema.parse({
      items: paginated,
      total: filtered.length,
    });
  }

  async getBookmarkDetail(bookmarkId: string) {
    const bookmark = this.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return null;
    }

    const versions = [...(this.versionsByBookmark.get(bookmarkId) ?? [])].sort(
      (left, right) => right.versionNo - left.versionNo,
    );

    return {
      bookmark,
      versions,
    };
  }

  private findBookmarkByNormalizedHash(normalizedHash: string) {
    for (const bookmark of this.bookmarks.values()) {
      const bookmarkHash = hashNormalizedUrl(normalizeSourceUrl(bookmark.sourceUrl));
      if (bookmarkHash === normalizedHash) {
        return bookmark;
      }
    }
    return undefined;
  }

  private createBookmark(input: CaptureCompleteRequest, now: string): Bookmark {
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
    this.bookmarks.set(bookmark.id, bookmark);
    return bookmark;
  }

  private findObjectKeyByVersionId(versionId: string) {
    for (const [objectKey, version] of this.versionsByObjectKey.entries()) {
      if (version.id === versionId) {
        return objectKey;
      }
    }
    return undefined;
  }

  private findBookmarkByVersionId(versionId: string) {
    for (const [bookmarkId, versions] of this.versionsByBookmark.entries()) {
      const hasVersion = versions.some((version) => version.id === versionId);
      if (!hasVersion) {
        continue;
      }
      return this.bookmarks.get(bookmarkId);
    }
    return undefined;
  }

  private createObjectKey() {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${day}/${crypto.randomUUID()}.html`;
  }
}
