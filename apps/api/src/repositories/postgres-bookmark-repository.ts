import {
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  bookmarkVersionSchema,
  qualityReportSchema,
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
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hashNormalizedUrl, normalizeSourceUrl } from "../lib/url";
import type { ObjectStorage } from "../storage/object-storage";
import type {
  BookmarkRepository,
  BookmarkSearchQuery,
  CompleteCaptureResult,
  InitCaptureResult,
} from "./bookmark-repository";

type PostgresBookmarkRepositoryOptions = {
  databaseUrl: string;
  objectStorage: ObjectStorage;
};

const DEFAULT_USER_ID = "6f8326ce-830f-46b6-a2ab-2be2f102f5fe";
const DEFAULT_USER_EMAIL = "cyan@keeppage.local";

export class PostgresBookmarkRepository implements BookmarkRepository {
  readonly kind = "postgres" as const;

  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof dbSchema>;
  private readonly bootstrapPromise: Promise<void>;
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
    this.bootstrapPromise = this.ensureBootstrap();
  }

  async initCapture(input: CaptureInitRequest): Promise<InitCaptureResult> {
    await this.bootstrapPromise;

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
          eq(bookmarks.userId, DEFAULT_USER_ID),
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

    const objectKey = this.createObjectKey();
    await this.db
      .insert(captureUploads)
      .values({
        objectKey,
        normalizedUrlHash,
        sourceUrl: input.url,
        title: input.title,
        htmlSha256: input.htmlSha256,
        fileSize: input.fileSize,
        captureProfile: input.profile,
        deviceId: input.deviceId,
      })
      .onConflictDoNothing({
        target: [captureUploads.normalizedUrlHash, captureUploads.htmlSha256],
      });

    const claimedPending = await this.db
      .select({
        objectKey: captureUploads.objectKey,
      })
      .from(captureUploads)
      .where(
        and(
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

  async completeCapture(input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    await this.bootstrapPromise;

    const existingByObjectKey = await this.db
      .select({
        bookmarkId: bookmarks.id,
        versionId: bookmarkVersions.id,
      })
      .from(bookmarkVersions)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, DEFAULT_USER_ID),
          eq(bookmarkVersions.htmlObjectKey, input.objectKey),
        ),
      )
      .limit(1);

    if (existingByObjectKey[0]) {
      const bookmark = await this.loadBookmark(existingByObjectKey[0].bookmarkId);
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
        .where(eq(captureUploads.objectKey, input.objectKey))
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
            eq(bookmarks.userId, DEFAULT_USER_ID),
            eq(bookmarks.normalizedUrlHash, normalizedUrlHash),
          ),
        )
        .orderBy(desc(bookmarks.updatedAt))
        .limit(1);

      const bookmarkId = existingBookmarkRows[0]?.id ?? crypto.randomUUID();
      if (!existingBookmarkRows[0]) {
        await tx.insert(bookmarks).values({
          id: bookmarkId,
          userId: DEFAULT_USER_ID,
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
        captureProfile: pending?.captureProfile ?? "standard",
        captureOptionsJson: pending
          ? {
              fileSize: pending.fileSize,
              uploadedSize: objectStat?.size ?? pending.fileSize,
              deviceId: pending.deviceId,
            }
          : {},
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

    const bookmark = await this.loadBookmark(transactionResult.bookmarkId);
    return {
      bookmark,
      versionId: transactionResult.versionId,
      createdNewVersion: transactionResult.createdNewVersion,
      deduplicated: transactionResult.deduplicated,
    };
  }

  async searchBookmarks(query: BookmarkSearchQuery) {
    await this.bootstrapPromise;

    const conditions = [eq(bookmarks.userId, DEFAULT_USER_ID)];
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

  async getBookmarkDetail(bookmarkId: string) {
    await this.bootstrapPromise;

    const bookmark = await this.loadBookmarkOrNull(bookmarkId);
    if (!bookmark) {
      return null;
    }

    const versions = await this.loadVersionsByBookmarkId(bookmarkId);
    return {
      bookmark,
      versions,
    };
  }

  private async ensureBootstrap() {
    await this.db
      .insert(users)
      .values({
        id: DEFAULT_USER_ID,
        email: DEFAULT_USER_EMAIL,
        name: "KeepPage Local User",
      })
      .onConflictDoNothing({
        target: users.id,
      });
  }

  private async loadBookmark(bookmarkId: string): Promise<Bookmark> {
    const bookmark = await this.loadBookmarkOrNull(bookmarkId);
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${bookmarkId}`);
    }

    return bookmark;
  }

  private async loadBookmarkOrNull(bookmarkId: string): Promise<Bookmark | null> {
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
          eq(bookmarks.userId, DEFAULT_USER_ID),
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

  private async loadVersionsByBookmarkId(bookmarkId: string): Promise<BookmarkVersion[]> {
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
          eq(bookmarks.userId, DEFAULT_USER_ID),
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

  private createObjectKey() {
    const day = new Date().toISOString().slice(0, 10);
    return `captures/${day}/${crypto.randomUUID()}.html`;
  }
}
