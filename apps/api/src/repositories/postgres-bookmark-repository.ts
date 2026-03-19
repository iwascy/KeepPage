import {
  authUserSchema,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  bookmarkVersionSchema,
  qualityReportSchema,
  type AuthUser,
  type Bookmark,
  type BookmarkVersion,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
} from "@keeppage/domain";
import {
  bookmarks,
  bookmarkTags,
  bookmarkVersions,
  captureUploads,
  folders,
  tags,
  users,
} from "@keeppage/db";
import * as dbSchema from "@keeppage/db";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hashNormalizedUrl, normalizeSourceUrl } from "../lib/url";
import type { ObjectStorage } from "../storage/object-storage";
import type {
  BookmarkRepository,
  BookmarkSearchQuery,
  CompleteCaptureResult,
  InitCaptureResult,
  UserAuthRecord,
} from "./bookmark-repository";

type PostgresBookmarkRepositoryOptions = {
  databaseUrl: string;
  objectStorage: ObjectStorage;
};

export class PostgresBookmarkRepository implements BookmarkRepository {
  readonly kind = "postgres" as const;

  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof dbSchema>;
  private readonly objectStorage: ObjectStorage;

  constructor(options: PostgresBookmarkRepositoryOptions) {
    this.pool = new Pool({
      connectionString: options.databaseUrl,
      max: 8,
    });
    this.db = drizzle(this.pool, {
      schema: dbSchema,
    });
    this.objectStorage = options.objectStorage;
  }

  async createUser(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<AuthUser> {
    const rows = await this.db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
      });
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create user.");
    }
    return this.mapUserRow(row);
  }

  async findUserByEmail(email: string): Promise<UserAuthRecord | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      user: this.mapUserRow(row),
      passwordHash: row.passwordHash,
    };
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    return row ? this.mapUserRow(row) : null;
  }

  async initCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    const normalizedUrlHash = hashNormalizedUrl(normalizeSourceUrl(input.url));
    const existing = await this.db
      .select({
        bookmarkId: bookmarks.id,
        versionId: bookmarkVersions.id,
        objectKey: bookmarkVersions.htmlObjectKey,
      })
      .from(bookmarks)
      .innerJoin(bookmarkVersions, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.normalizedUrlHash, normalizedUrlHash),
          eq(bookmarkVersions.htmlSha256, input.htmlSha256),
        ),
      )
      .limit(1);

    const hit = existing[0];
    if (hit) {
      return {
        alreadyExists: true,
        bookmarkId: hit.bookmarkId,
        versionId: hit.versionId,
        objectKey: hit.objectKey,
      };
    }

    const pending = await this.db
      .select({
        objectKey: captureUploads.objectKey,
      })
      .from(captureUploads)
      .where(
        and(
          eq(captureUploads.userId, userId),
          eq(captureUploads.normalizedUrlHash, normalizedUrlHash),
          eq(captureUploads.htmlSha256, input.htmlSha256),
        ),
      )
      .orderBy(desc(captureUploads.createdAt))
      .limit(1);

    if (pending[0]) {
      return {
        alreadyExists: false,
        objectKey: pending[0].objectKey,
      };
    }

    const objectKey = this.createObjectKey(userId);
    await this.db
      .insert(captureUploads)
      .values({
        objectKey,
        userId,
        normalizedUrlHash,
        sourceUrl: input.url,
        title: input.title,
        htmlSha256: input.htmlSha256,
        fileSize: input.fileSize,
        captureProfile: input.profile,
        deviceId: input.deviceId,
      })
      .onConflictDoNothing({
        target: [
          captureUploads.userId,
          captureUploads.normalizedUrlHash,
          captureUploads.htmlSha256,
        ],
      });

    const claimedPending = await this.db
      .select({
        objectKey: captureUploads.objectKey,
      })
      .from(captureUploads)
      .where(
        and(
          eq(captureUploads.userId, userId),
          eq(captureUploads.normalizedUrlHash, normalizedUrlHash),
          eq(captureUploads.htmlSha256, input.htmlSha256),
        ),
      )
      .orderBy(desc(captureUploads.createdAt))
      .limit(1);

    if (!claimedPending[0]) {
      throw new Error("Failed to create or reuse pending upload.");
    }

    return {
      alreadyExists: false,
      objectKey: claimedPending[0].objectKey,
    };
  }

  async completeCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const existingByObjectKey = await this.db
      .select({
        bookmarkId: bookmarks.id,
        versionId: bookmarkVersions.id,
      })
      .from(bookmarkVersions)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarkVersions.htmlObjectKey, input.objectKey),
        ),
      )
      .limit(1);

    if (existingByObjectKey[0]) {
      const bookmark = await this.loadBookmark(existingByObjectKey[0].bookmarkId, userId);
      return {
        bookmark,
        versionId: existingByObjectKey[0].versionId,
        createdNewVersion: false,
        deduplicated: true,
      };
    }

    if (!(await this.objectStorage.hasObject(input.objectKey))) {
      throw new Error("Uploaded archive object not found.");
    }

    const normalizedUrlHash = hashNormalizedUrl(normalizeSourceUrl(input.source.url));
    const now = new Date();

    const transactionResult = await this.db.transaction(async (tx) => {
      const pendingUpload = await tx
        .select()
        .from(captureUploads)
        .where(
          and(
            eq(captureUploads.objectKey, input.objectKey),
            eq(captureUploads.userId, userId),
          ),
        )
        .limit(1);
      const pending = pendingUpload[0];
      if (!pending) {
        throw new Error("Pending capture not found for object key.");
      }

      const existingBookmarkRows = await tx
        .select({
          id: bookmarks.id,
        })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.normalizedUrlHash, normalizedUrlHash),
          ),
        )
        .orderBy(desc(bookmarks.updatedAt))
        .limit(1);

      const bookmarkId = existingBookmarkRows[0]?.id ?? crypto.randomUUID();
      if (!existingBookmarkRows[0]) {
        await tx.insert(bookmarks).values({
          id: bookmarkId,
          userId,
          sourceUrl: input.source.url,
          canonicalUrl: input.source.canonicalUrl,
          normalizedUrlHash,
          title: input.source.title,
          domain: input.source.domain,
          note: "",
          isPinnedOffline: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      const duplicateVersionRows = await tx
        .select({
          id: bookmarkVersions.id,
        })
        .from(bookmarkVersions)
        .where(
          and(
            eq(bookmarkVersions.bookmarkId, bookmarkId),
            eq(bookmarkVersions.htmlSha256, input.htmlSha256),
          ),
        )
        .limit(1);

      if (duplicateVersionRows[0]) {
        const duplicatedVersionId = duplicateVersionRows[0].id;
        await tx
          .update(bookmarks)
          .set({
            sourceUrl: input.source.url,
            canonicalUrl: input.source.canonicalUrl,
            title: input.source.title,
            domain: input.source.domain,
            latestVersionId: duplicatedVersionId,
            updatedAt: now,
          })
          .where(eq(bookmarks.id, bookmarkId));
        await tx.delete(captureUploads).where(eq(captureUploads.objectKey, input.objectKey));
        return {
          bookmarkId,
          versionId: duplicatedVersionId,
          createdNewVersion: false,
          deduplicated: true,
        };
      }

      const nextVersionNoRows = await tx
        .select({
          nextVersionNo: sql<number>`coalesce(max(${bookmarkVersions.versionNo}), 0) + 1`,
        })
        .from(bookmarkVersions)
        .where(eq(bookmarkVersions.bookmarkId, bookmarkId));
      const versionNo = nextVersionNoRows[0]?.nextVersionNo ?? 1;
      const versionId = crypto.randomUUID();
      const objectStat = await this.objectStorage.statObject(input.objectKey);

      await tx.insert(bookmarkVersions).values({
        id: versionId,
        bookmarkId,
        versionNo,
        htmlObjectKey: input.objectKey,
        htmlSha256: input.htmlSha256,
        textSha256: input.textSha256,
        textSimhash: input.textSimhash,
        captureProfile: pending.captureProfile ?? "standard",
        captureOptionsJson: {
          fileSize: pending.fileSize,
          uploadedSize: objectStat?.size ?? pending.fileSize,
          deviceId: pending.deviceId,
        },
        qualityScore: input.quality.score,
        qualityGrade: input.quality.grade,
        qualityReasonsJson: input.quality.reasons,
        qualityReportJson: input.quality,
        sourceMetaJson: {
          source: input.source,
        },
        extractedText: input.extractedText ?? null,
        createdByDeviceId: null,
        createdAt: now,
      });

      await tx
        .update(bookmarks)
        .set({
          sourceUrl: input.source.url,
          canonicalUrl: input.source.canonicalUrl,
          title: input.source.title,
          domain: input.source.domain,
          latestVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(bookmarks.id, bookmarkId));

      await tx.delete(captureUploads).where(eq(captureUploads.objectKey, input.objectKey));

      return {
        bookmarkId,
        versionId,
        createdNewVersion: true,
        deduplicated: false,
      };
    });

    const bookmark = await this.loadBookmark(transactionResult.bookmarkId, userId);
    return {
      bookmark,
      versionId: transactionResult.versionId,
      createdNewVersion: transactionResult.createdNewVersion,
      deduplicated: transactionResult.deduplicated,
    };
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery) {
    const conditions = [eq(bookmarks.userId, userId)];
    if (query.domain) {
      conditions.push(eq(bookmarks.domain, query.domain));
    }
    if (query.quality) {
      conditions.push(eq(bookmarkVersions.qualityGrade, query.quality));
    }
    if (query.q?.trim()) {
      const needle = `%${query.q.trim()}%`;
      conditions.push(
        or(
          ilike(bookmarks.title, needle),
          ilike(bookmarks.sourceUrl, needle),
          ilike(bookmarks.domain, needle),
          ilike(bookmarks.note, needle),
          ilike(folders.path, needle),
          ilike(bookmarkVersions.extractedText, needle),
          sql<boolean>`exists (
            select 1
            from ${bookmarkTags}
            inner join ${tags} on ${tags.id} = ${bookmarkTags.tagId}
            where ${bookmarkTags.bookmarkId} = ${bookmarks.id}
              and ${tags.name} ilike ${needle}
          )`,
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: bookmarks.id,
        sourceUrl: bookmarks.sourceUrl,
        canonicalUrl: bookmarks.canonicalUrl,
        title: bookmarks.title,
        domain: bookmarks.domain,
        note: bookmarks.note,
        latestVersionId: bookmarks.latestVersionId,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        folderId: folders.id,
        folderName: folders.name,
        folderPath: folders.path,
        latestQualityReport: bookmarkVersions.qualityReportJson,
      })
      .from(bookmarks)
      .leftJoin(bookmarkVersions, eq(bookmarks.latestVersionId, bookmarkVersions.id))
      .leftJoin(folders, eq(bookmarks.folderId, folders.id))
      .where(and(...conditions))
      .orderBy(desc(bookmarks.updatedAt));

    const total = rows.length;
    const paginatedRows = rows.slice(query.offset, query.offset + query.limit);
    const paginatedBookmarkIds = paginatedRows.map((row) => row.id);
    const tagMap = await this.loadTagsByBookmarkId(paginatedBookmarkIds);
    const versionCountMap = await this.loadVersionCounts(paginatedBookmarkIds);

    const paginated = paginatedRows.map((row) =>
      this.mapBookmarkRow(row, {
        tags: tagMap.get(row.id) ?? [],
        versionCount: versionCountMap.get(row.id) ?? 0,
      }),
    );

    return bookmarkSearchResponseSchema.parse({
      items: paginated,
      total,
    });
  }

  async getBookmarkDetail(userId: string, bookmarkId: string) {
    const bookmark = await this.loadBookmarkOrNull(bookmarkId, userId);
    if (!bookmark) {
      return null;
    }

    const versions = await this.loadVersionsByBookmarkId(bookmarkId, userId);
    return {
      bookmark,
      versions,
    };
  }

  async userCanReadObject(userId: string, objectKey: string) {
    const rows = await this.db
      .select({
        id: bookmarkVersions.id,
      })
      .from(bookmarkVersions)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarkVersions.htmlObjectKey, objectKey),
        ),
      )
      .limit(1);
    return Boolean(rows[0]);
  }

  async userCanWriteObject(userId: string, objectKey: string) {
    const pendingRows = await this.db
      .select({
        objectKey: captureUploads.objectKey,
      })
      .from(captureUploads)
      .where(
        and(
          eq(captureUploads.userId, userId),
          eq(captureUploads.objectKey, objectKey),
        ),
      )
      .limit(1);
    if (pendingRows[0]) {
      return true;
    }

    return this.userCanReadObject(userId, objectKey);
  }

  private mapUserRow(row: {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
  }) {
    return authUserSchema.parse({
      id: row.id,
      email: row.email,
      name: row.name ?? undefined,
      createdAt: row.createdAt.toISOString(),
    });
  }

  private async loadBookmark(bookmarkId: string, userId: string): Promise<Bookmark> {
    const bookmark = await this.loadBookmarkOrNull(bookmarkId, userId);
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${bookmarkId}`);
    }

    return bookmark;
  }

  private async loadBookmarkOrNull(bookmarkId: string, userId: string): Promise<Bookmark | null> {
    const rows = await this.db
      .select({
        id: bookmarks.id,
        sourceUrl: bookmarks.sourceUrl,
        canonicalUrl: bookmarks.canonicalUrl,
        title: bookmarks.title,
        domain: bookmarks.domain,
        note: bookmarks.note,
        latestVersionId: bookmarks.latestVersionId,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        folderId: folders.id,
        folderName: folders.name,
        folderPath: folders.path,
        latestQualityReport: bookmarkVersions.qualityReportJson,
      })
      .from(bookmarks)
      .leftJoin(bookmarkVersions, eq(bookmarks.latestVersionId, bookmarkVersions.id))
      .leftJoin(folders, eq(bookmarks.folderId, folders.id))
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.id, bookmarkId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    const tagsByBookmark = await this.loadTagsByBookmarkId([bookmarkId]);
    const versionCounts = await this.loadVersionCounts([bookmarkId]);
    return this.mapBookmarkRow(row, {
      tags: tagsByBookmark.get(bookmarkId) ?? [],
      versionCount: versionCounts.get(bookmarkId) ?? 0,
    });
  }

  private async loadVersionsByBookmarkId(bookmarkId: string, userId: string): Promise<BookmarkVersion[]> {
    const rows = await this.db
      .select({
        id: bookmarkVersions.id,
        bookmarkId: bookmarkVersions.bookmarkId,
        versionNo: bookmarkVersions.versionNo,
        htmlObjectKey: bookmarkVersions.htmlObjectKey,
        htmlSha256: bookmarkVersions.htmlSha256,
        textSha256: bookmarkVersions.textSha256,
        textSimhash: bookmarkVersions.textSimhash,
        captureProfile: bookmarkVersions.captureProfile,
        qualityReport: bookmarkVersions.qualityReportJson,
        createdAt: bookmarkVersions.createdAt,
      })
      .from(bookmarkVersions)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarkVersions.bookmarkId, bookmarkId),
        ),
      )
      .orderBy(desc(bookmarkVersions.versionNo));

    return rows.map((row) =>
      bookmarkVersionSchema.parse({
        id: row.id,
        bookmarkId: row.bookmarkId,
        versionNo: row.versionNo,
        htmlObjectKey: row.htmlObjectKey,
        htmlSha256: row.htmlSha256,
        textSha256: row.textSha256 ?? undefined,
        textSimhash: row.textSimhash ?? undefined,
        captureProfile: row.captureProfile,
        quality: this.readQuality(row.qualityReport),
        createdAt: row.createdAt.toISOString(),
      }),
    );
  }

  private async loadTagsByBookmarkId(bookmarkIds: string[]) {
    const tagMap = new Map<string, Array<{ id: string; name: string; color?: string }>>();
    if (bookmarkIds.length === 0) {
      return tagMap;
    }

    const tagRows = await this.db
      .select({
        bookmarkId: bookmarkTags.bookmarkId,
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(bookmarkTags)
      .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
      .where(inArray(bookmarkTags.bookmarkId, bookmarkIds));

    for (const row of tagRows) {
      const existing = tagMap.get(row.bookmarkId) ?? [];
      existing.push({
        id: row.id,
        name: row.name,
        color: row.color ?? undefined,
      });
      tagMap.set(row.bookmarkId, existing);
    }
    return tagMap;
  }

  private async loadVersionCounts(bookmarkIds: string[]) {
    const versionCountMap = new Map<string, number>();
    if (bookmarkIds.length === 0) {
      return versionCountMap;
    }

    const countRows = await this.db
      .select({
        bookmarkId: bookmarkVersions.bookmarkId,
        count: count(),
      })
      .from(bookmarkVersions)
      .where(inArray(bookmarkVersions.bookmarkId, bookmarkIds))
      .groupBy(bookmarkVersions.bookmarkId);

    for (const row of countRows) {
      versionCountMap.set(row.bookmarkId, Number(row.count));
    }
    return versionCountMap;
  }

  private mapBookmarkRow(
    row: {
      id: string;
      sourceUrl: string;
      canonicalUrl: string | null;
      title: string;
      domain: string;
      note: string;
      latestVersionId: string | null;
      createdAt: Date;
      updatedAt: Date;
      folderId: string | null;
      folderName: string | null;
      folderPath: string | null;
      latestQualityReport: unknown;
    },
    options: {
      tags: Array<{ id: string; name: string; color?: string }>;
      versionCount: number;
    },
  ) {
    const maybeQuality = this.readQuality(row.latestQualityReport);
    return bookmarkSchema.parse({
      id: row.id,
      sourceUrl: row.sourceUrl,
      canonicalUrl: row.canonicalUrl ?? undefined,
      title: row.title,
      domain: row.domain,
      note: row.note,
      tags: options.tags,
      folder: row.folderId && row.folderName && row.folderPath
        ? {
            id: row.folderId,
            name: row.folderName,
            path: row.folderPath,
          }
        : undefined,
      latestVersionId: row.latestVersionId ?? undefined,
      versionCount: Math.max(1, options.versionCount || 1),
      latestQuality: maybeQuality,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private readQuality(sourceMeta: unknown) {
    const parsed = qualityReportSchema.safeParse(sourceMeta);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  }

  private createObjectKey(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${userId}/${day}/${crypto.randomUUID()}.html`;
  }
}
