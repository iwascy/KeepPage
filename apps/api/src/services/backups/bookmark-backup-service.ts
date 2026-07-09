import {
  authUserSchema,
  bookmarkSchema,
  bookmarkVersionSchema,
  folderSchema,
  tagSchema,
  type AuthUser,
  type Bookmark,
  type BookmarkVersion,
  type Folder,
  type Tag,
} from "@keeppage/domain";
import crypto from "node:crypto";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import { HttpError } from "../../lib/http-error";
import type { BookmarkRepository } from "../../repositories";
import type { ObjectStorage } from "../../storage/object-storage";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const packageFormat = "keeppage-bookmarks-package";
const packageVersion = 1;
const pageSize = 500;

const packageObjectSchema = z.object({
  objectKey: z.string().min(1),
  contentBase64: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().min(1).optional(),
});

const packageBookmarkSchema = z.object({
  bookmark: bookmarkSchema,
  versions: z.array(bookmarkVersionSchema).default([]),
});

const bookmarkBackupPackageSchema = z.object({
  format: z.literal(packageFormat),
  version: z.literal(packageVersion),
  exportedAt: z.string().datetime(),
  exportedBy: authUserSchema.pick({
    id: true,
    email: true,
    name: true,
  }).extend({
    createdAt: z.string().datetime().optional(),
  }),
  scope: z.literal("normal-bookmarks"),
  options: z.object({
    includeVersions: z.literal("latest"),
  }),
  folders: z.array(folderSchema),
  tags: z.array(tagSchema),
  bookmarks: z.array(packageBookmarkSchema),
  objects: z.array(packageObjectSchema),
});

type BookmarkBackupPackage = z.infer<typeof bookmarkBackupPackageSchema>;
type PackageBookmark = z.infer<typeof packageBookmarkSchema>;

export type BookmarkBackupPreview = {
  format: string;
  version: number;
  exportedAt: string;
  sourceUser: {
    id: string;
    email: string;
    name?: string;
  };
  counts: {
    folders: number;
    tags: number;
    bookmarks: number;
    existingBookmarks: number;
    newBookmarks: number;
    versions: number;
    objects: number;
    totalObjectBytes: number;
  };
};

export type BookmarkBackupImportResult = BookmarkBackupPreview & {
  imported: {
    foldersEnsured: number;
    tagsEnsured: number;
    bookmarksCreated: number;
    bookmarksMerged: number;
    objectsWritten: number;
    versionsRestored: number;
    versionsSkippedMissingObject: number;
  };
};

type BookmarkBackupServiceOptions = {
  repository: BookmarkRepository;
  objectStorage: ObjectStorage;
};

export class BookmarkBackupService {
  private readonly repository: BookmarkRepository;
  private readonly objectStorage: ObjectStorage;

  constructor(options: BookmarkBackupServiceOptions) {
    this.repository = options.repository;
    this.objectStorage = options.objectStorage;
  }

  async exportUserBookmarks(user: AuthUser) {
    const [folders, tags, bookmarks] = await Promise.all([
      this.repository.listFolders(user.id),
      this.repository.listTags(user.id),
      this.loadAllBookmarks(user.id),
    ]);
    const packageBookmarks: PackageBookmark[] = [];
    const objectKeys = new Set<string>();

    for (const bookmark of bookmarks) {
      const detail = await this.repository.getBookmarkDetail(user.id, bookmark.id);
      if (!detail) {
        continue;
      }

      const latestVersion = this.pickLatestVersion(detail.bookmark, detail.versions);
      const versions = latestVersion ? [latestVersion] : [];
      for (const version of versions) {
        for (const objectKey of collectVersionObjectKeys(version)) {
          objectKeys.add(objectKey);
        }
      }

      packageBookmarks.push({
        bookmark: detail.bookmark,
        versions,
      });
    }

    const objects = await this.readPackageObjects([...objectKeys].sort());
    const payload: BookmarkBackupPackage = {
      format: packageFormat,
      version: packageVersion,
      exportedAt: new Date().toISOString(),
      exportedBy: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      scope: "normal-bookmarks",
      options: {
        includeVersions: "latest",
      },
      folders,
      tags,
      bookmarks: packageBookmarks,
      objects,
    };

    const json = JSON.stringify(payload);
    const body = await gzipAsync(Buffer.from(json, "utf8"), {
      level: 9,
    });
    const exportedAtForName = payload.exportedAt.replaceAll(/[:.]/g, "-");
    return {
      body,
      fileName: `keeppage-bookmarks-${exportedAtForName}.kpkg`,
      manifest: this.createPreviewFromPackage(payload, 0),
    };
  }

  async previewImportPackage(userId: string, body: Buffer): Promise<BookmarkBackupPreview> {
    const backupPackage = await this.parsePackageBody(body);
    const existingBookmarks = await this.countExistingBookmarks(userId, backupPackage.bookmarks);
    return this.createPreviewFromPackage(backupPackage, existingBookmarks);
  }

  async importPackage(userId: string, body: Buffer): Promise<BookmarkBackupImportResult> {
    const backupPackage = await this.parsePackageBody(body);
    const preview = await this.previewImportPackage(userId, body);
    const objectMap = new Map(backupPackage.objects.map((entry) => [entry.objectKey, entry]));
    const imported = {
      foldersEnsured: await this.ensureFolders(userId, backupPackage.folders),
      tagsEnsured: await this.ensureTags(userId, backupPackage.tags),
      bookmarksCreated: 0,
      bookmarksMerged: 0,
      objectsWritten: 0,
      versionsRestored: 0,
      versionsSkippedMissingObject: 0,
    };

    for (const objectEntry of backupPackage.objects) {
      const bodyBuffer = Buffer.from(objectEntry.contentBase64, "base64");
      const sha256 = sha256Buffer(bodyBuffer);
      if (sha256 !== objectEntry.sha256) {
        throw new HttpError(400, "BackupObjectChecksumMismatch", `Object checksum mismatch: ${objectEntry.objectKey}`);
      }
      await this.objectStorage.putObject(objectEntry.objectKey, bodyBuffer, {
        contentType: objectEntry.contentType,
      });
      imported.objectsWritten += 1;
    }

    for (const packageBookmark of backupPackage.bookmarks) {
      const bookmark = packageBookmark.bookmark;
      const result = await this.repository.ingestBookmark(userId, {
        url: bookmark.sourceUrl,
        title: bookmark.title,
        note: bookmark.note,
        folderPath: bookmark.folder?.path,
        tags: bookmark.tags.map((tag) => tag.name),
        dedupeStrategy: "merge",
      });

      if (result.status === "created") {
        imported.bookmarksCreated += 1;
      } else {
        imported.bookmarksMerged += 1;
      }

      await this.repository.updateBookmarkMetadata(userId, result.bookmark.id, {
        note: bookmark.note,
        folderPath: bookmark.folder?.path,
        tags: bookmark.tags.map((tag) => tag.name),
        isFavorite: bookmark.isFavorite,
      });

      for (const version of packageBookmark.versions) {
        if (!objectMap.has(version.htmlObjectKey) && !(await this.objectStorage.hasObject(version.htmlObjectKey))) {
          imported.versionsSkippedMissingObject += 1;
          continue;
        }

        await this.repository.addRestoredBookmarkVersion(userId, result.bookmark.id, {
          htmlObjectKey: version.htmlObjectKey,
          readerHtmlObjectKey: version.readerHtmlObjectKey,
          htmlSha256: version.htmlSha256,
          textSha256: version.textSha256,
          textSimhash: version.textSimhash,
          mediaFiles: this.normalizeMediaFiles(version.mediaFiles),
          captureProfile: version.captureProfile,
          quality: version.quality,
          createdAt: version.createdAt,
        });
        imported.versionsRestored += 1;
      }
    }

    return {
      ...preview,
      imported,
    };
  }

  private async loadAllBookmarks(userId: string): Promise<Bookmark[]> {
    const items: Bookmark[] = [];
    let offset = 0;
    while (true) {
      const page = await this.repository.searchBookmarks(userId, {
        limit: pageSize,
        offset,
      });
      items.push(...page.items);
      offset += page.items.length;
      if (items.length >= page.total || page.items.length === 0) {
        return items;
      }
    }
  }

  private pickLatestVersion(bookmark: Bookmark, versions: BookmarkVersion[]) {
    if (bookmark.latestVersionId) {
      const latest = versions.find((version) => version.id === bookmark.latestVersionId);
      if (latest) {
        return latest;
      }
    }
    return versions[0];
  }

  private async readPackageObjects(objectKeys: string[]) {
    const objects: BookmarkBackupPackage["objects"] = [];
    for (const objectKey of objectKeys) {
      const stat = await this.objectStorage.statObject(objectKey);
      if (!stat) {
        continue;
      }
      const body = await this.objectStorage.readObject(objectKey);
      objects.push({
        objectKey,
        contentBase64: body.toString("base64"),
        sizeBytes: body.byteLength,
        sha256: sha256Buffer(body),
        contentType: contentTypeForObjectKey(objectKey),
      });
    }
    return objects;
  }

  private async parsePackageBody(body: Buffer) {
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new HttpError(400, "BackupPackageRequired", "Backup package body is required.");
    }

    let jsonBuffer: Buffer;
    try {
      jsonBuffer = isGzip(body) ? await gunzipAsync(body) : body;
    } catch {
      throw new HttpError(400, "BackupPackageInvalid", "Backup package is not a valid gzip payload.");
    }

    try {
      return bookmarkBackupPackageSchema.parse(JSON.parse(jsonBuffer.toString("utf8")));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new HttpError(400, "BackupPackageInvalid", "Backup package manifest is invalid.", {
          issues: error.issues,
        });
      }
      throw new HttpError(400, "BackupPackageInvalid", "Backup package JSON is invalid.");
    }
  }

  private async countExistingBookmarks(userId: string, bookmarks: PackageBookmark[]) {
    let existing = 0;
    for (const packageBookmark of bookmarks) {
      const match = await this.repository.findBookmarkByUrl(userId, packageBookmark.bookmark.sourceUrl);
      if (match) {
        existing += 1;
      }
    }
    return existing;
  }

  private createPreviewFromPackage(backupPackage: BookmarkBackupPackage, existingBookmarks: number): BookmarkBackupPreview {
    const versions = backupPackage.bookmarks.reduce((sum, item) => sum + item.versions.length, 0);
    const totalObjectBytes = backupPackage.objects.reduce((sum, object) => sum + object.sizeBytes, 0);
    return {
      format: backupPackage.format,
      version: backupPackage.version,
      exportedAt: backupPackage.exportedAt,
      sourceUser: {
        id: backupPackage.exportedBy.id,
        email: backupPackage.exportedBy.email,
        name: backupPackage.exportedBy.name,
      },
      counts: {
        folders: backupPackage.folders.length,
        tags: backupPackage.tags.length,
        bookmarks: backupPackage.bookmarks.length,
        existingBookmarks,
        newBookmarks: Math.max(backupPackage.bookmarks.length - existingBookmarks, 0),
        versions,
        objects: backupPackage.objects.length,
        totalObjectBytes,
      },
    };
  }

  private async ensureFolders(userId: string, folders: Folder[]) {
    const existing = new Map((await this.repository.listFolders(userId)).map((folder) => [folder.path, folder]));
    let ensured = 0;
    const sortedFolders = [...folders].sort((left, right) => left.path.localeCompare(right.path));
    for (const folder of sortedFolders) {
      const segments = folder.path.split("/").filter(Boolean);
      let parentId: string | null = null;
      let currentPath = "";
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const current = existing.get(currentPath);
        if (current) {
          parentId = current.id;
          continue;
        }
        const created = await this.repository.createFolder(userId, {
          name: segment,
          parentId,
        });
        existing.set(created.path, created);
        parentId = created.id;
        ensured += 1;
      }
    }
    return ensured;
  }

  private async ensureTags(userId: string, tags: Tag[]) {
    const existing = new Map((await this.repository.listTags(userId)).map((tag) => [tag.name, tag]));
    let ensured = 0;
    for (const tag of tags) {
      const current = existing.get(tag.name);
      if (!current) {
        const created = await this.repository.createTag(userId, {
          name: tag.name,
          color: tag.color,
        });
        existing.set(created.name, created);
        ensured += 1;
      }
    }
    return ensured;
  }

  private normalizeMediaFiles(mediaFiles: BookmarkVersion["mediaFiles"]) {
    return mediaFiles?.map((mediaFile) => ({
      ...mediaFile,
      publicUrl: this.objectStorage.createPublicUrl?.(mediaFile.objectKey) ?? undefined,
    }));
  }
}

function collectVersionObjectKeys(version: BookmarkVersion) {
  const keys = new Set<string>();
  keys.add(version.htmlObjectKey);
  if (version.readerHtmlObjectKey) {
    keys.add(version.readerHtmlObjectKey);
  }
  for (const mediaFile of version.mediaFiles ?? []) {
    keys.add(mediaFile.objectKey);
  }
  return [...keys];
}

function sha256Buffer(body: Buffer) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function isGzip(body: Buffer) {
  return body.byteLength >= 2 && body[0] === 0x1f && body[1] === 0x8b;
}

function contentTypeForObjectKey(objectKey: string) {
  if (/\.html?$/i.test(objectKey)) {
    return "text/html; charset=utf-8";
  }
  if (/\.json$/i.test(objectKey)) {
    return "application/json";
  }
  if (/\.png$/i.test(objectKey)) {
    return "image/png";
  }
  if (/\.jpe?g$/i.test(objectKey)) {
    return "image/jpeg";
  }
  if (/\.webp$/i.test(objectKey)) {
    return "image/webp";
  }
  if (/\.pdf$/i.test(objectKey)) {
    return "application/pdf";
  }
  return "application/octet-stream";
}
