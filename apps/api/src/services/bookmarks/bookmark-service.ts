import {
  bookmarkDetailResponseSchema,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  type BookmarkMetadataUpdateRequest,
} from "@keeppage/domain";
import { HttpError } from "../../lib/http-error";
import type {
  BookmarkReadRepository,
  BookmarkWriteRepository,
  BookmarkSearchQuery,
} from "../../repositories/bookmark-repository";
import type { ObjectStorage } from "../../storage/object-storage";

type BookmarkServiceOptions = {
  repository: BookmarkReadRepository & BookmarkWriteRepository;
  objectStorage: ObjectStorage;
};

export class BookmarkService {
  private readonly repository: BookmarkReadRepository & BookmarkWriteRepository;
  private readonly objectStorage: ObjectStorage;

  constructor(options: BookmarkServiceOptions) {
    this.repository = options.repository;
    this.objectStorage = options.objectStorage;
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery) {
    const result = await this.repository.searchBookmarks(userId, query);
    return bookmarkSearchResponseSchema.parse(result);
  }

  async getBookmarkDetail(userId: string, bookmarkId: string) {
    const detail = await this.requireBookmarkDetail(userId, bookmarkId);
    const versions = await Promise.all(
      detail.versions.map(async (version) => {
        const [objectStat, readerObjectStat] = await Promise.all([
          this.objectStorage.statObject(version.htmlObjectKey),
          version.readerHtmlObjectKey
            ? this.objectStorage.statObject(version.readerHtmlObjectKey)
            : Promise.resolve(null),
        ]);
        return {
          ...version,
          archiveAvailable: objectStat !== null,
          archiveSizeBytes: objectStat?.size,
          readerArchiveAvailable: readerObjectStat !== null,
          readerArchiveSizeBytes: readerObjectStat?.size,
        };
      }),
    );

    return bookmarkDetailResponseSchema.parse({
      bookmark: detail.bookmark,
      versions,
    });
  }

  async deleteBookmark(userId: string, bookmarkId: string) {
    const detail = await this.requireBookmarkDetail(userId, bookmarkId);
    const deleted = await this.repository.deleteBookmark(userId, bookmarkId);
    if (!deleted) {
      throw new HttpError(404, "BookmarkNotFound", "Bookmark not found.");
    }

    await Promise.allSettled(
      detail.versions.flatMap((version) => (
        [
          this.objectStorage.deleteObject(version.htmlObjectKey),
          version.readerHtmlObjectKey
            ? this.objectStorage.deleteObject(version.readerHtmlObjectKey)
            : Promise.resolve(),
          ...(version.mediaFiles ?? []).map((mediaFile) => this.objectStorage.deleteObject(mediaFile.objectKey)),
        ]
      )),
    );
  }

  async updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ) {
    const bookmark = await this.repository.updateBookmarkMetadata(userId, bookmarkId, input);
    if (!bookmark) {
      throw new HttpError(404, "BookmarkNotFound", "Bookmark not found.");
    }

    return bookmarkSchema.parse(bookmark);
  }

  private async requireBookmarkDetail(userId: string, bookmarkId: string) {
    const detail = await this.repository.getBookmarkDetail(userId, bookmarkId);
    if (!detail) {
      throw new HttpError(404, "BookmarkNotFound", "Bookmark not found.");
    }
    return detail;
  }
}
