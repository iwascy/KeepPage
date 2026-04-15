import {
  apiTokenScopeSchema,
  authUserSchema,
  type ApiToken,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  bookmarkSidebarStatsResponseSchema,
  bookmarkVersionMediaFileSchema,
  bookmarkVersionSchema,
  captureSourceSchema,
  createImportTaskId,
  createImportTaskItemId,
  qualityReportSchema,
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
  type ImportExecutionOptions,
  type ImportTask,
  type ImportTaskDetailResponse,
  type ImportTaskItem,
  type Tag,
  type TagCreateRequest,
  type TagUpdateRequest,
} from "@keeppage/domain";
import {
  apiTokens,
  bookmarks,
  bookmarkTags,
  bookmarkVersions,
  captureUploads,
  folders,
  importItems,
  importTasks,
  privateBookmarks,
  privateBookmarkVersions,
  privateCaptureUploads,
  privateModeConfigs,
  tags,
  users,
} from "@keeppage/db";
import * as dbSchema from "@keeppage/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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
  UserAuthRecord,
} from "../bookmark-repository";
import {
  deduplicateScopes,
  deriveHtmlObjectKeyFromMediaObjectKey,
  mergeBookmarkMediaFiles,
} from "./shared/helpers";

export type PostgresBookmarkRepositoryOptions = {
  databaseUrl: string;
  objectStorage: ObjectStorage;
};

export class PostgresRepositoryCore {
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

  async createApiToken(userId: string, input: CreateApiTokenInput): Promise<ApiToken> {
    const rows = await this.db
      .insert(apiTokens)
      .values({
        id: input.id,
        userId,
        name: input.name,
        tokenPreview: input.tokenPreview,
        tokenHash: input.tokenHash,
        scopesJson: deduplicateScopes(input.scopes),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPreview: apiTokens.tokenPreview,
        scopesJson: apiTokens.scopesJson,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      });

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create API token.");
    }
    return this.mapApiTokenRow(row);
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    const rows = await this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPreview: apiTokens.tokenPreview,
        scopesJson: apiTokens.scopesJson,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));

    return rows.map((row) => this.mapApiTokenRow(row));
  }

  async getApiTokenAuthRecord(tokenId: string): Promise<ApiTokenAuthRecord | null> {
    const rows = await this.db
      .select({
        id: apiTokens.id,
        userId: apiTokens.userId,
        name: apiTokens.name,
        tokenPreview: apiTokens.tokenPreview,
        tokenHash: apiTokens.tokenHash,
        scopesJson: apiTokens.scopesJson,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.id, tokenId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      ...this.mapApiTokenRow(row),
      userId: row.userId,
      tokenHash: row.tokenHash,
    };
  }

  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    const rows = await this.db
      .select({
        id: apiTokens.id,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.userId, userId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return false;
    }
    if (row.revokedAt) {
      return true;
    }

    await this.db
      .update(apiTokens)
      .set({
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.userId, userId),
        ),
      );

    return true;
  }

  async touchApiToken(tokenId: string, usedAt: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({
        lastUsedAt: new Date(usedAt),
      })
      .where(eq(apiTokens.id, tokenId));
  }

  async getPrivateModeConfig(userId: string): Promise<PrivateModeConfigRecord | null> {
    const rows = await this.db
      .select({
        userId: privateModeConfigs.userId,
        passwordHash: privateModeConfigs.passwordHash,
        passwordAlgo: privateModeConfigs.passwordAlgo,
        enabledAt: privateModeConfigs.enabledAt,
        passwordUpdatedAt: privateModeConfigs.passwordUpdatedAt,
      })
      .from(privateModeConfigs)
      .where(eq(privateModeConfigs.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      userId: row.userId,
      passwordHash: row.passwordHash,
      passwordAlgo: row.passwordAlgo,
      enabledAt: row.enabledAt.toISOString(),
      passwordUpdatedAt: row.passwordUpdatedAt.toISOString(),
    };
  }

  async enablePrivateMode(input: {
    userId: string;
    passwordHash: string;
    passwordAlgo: string;
  }): Promise<PrivateModeConfigRecord> {
    const now = new Date();
    const rows = await this.db
      .insert(privateModeConfigs)
      .values({
        userId: input.userId,
        passwordHash: input.passwordHash,
        passwordAlgo: input.passwordAlgo,
        enabledAt: now,
        passwordUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: privateModeConfigs.userId,
        set: {
          passwordHash: input.passwordHash,
          passwordAlgo: input.passwordAlgo,
          passwordUpdatedAt: now,
        },
      })
      .returning({
        userId: privateModeConfigs.userId,
        passwordHash: privateModeConfigs.passwordHash,
        passwordAlgo: privateModeConfigs.passwordAlgo,
        enabledAt: privateModeConfigs.enabledAt,
        passwordUpdatedAt: privateModeConfigs.passwordUpdatedAt,
      });
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to enable private mode.");
    }
    return {
      userId: row.userId,
      passwordHash: row.passwordHash,
      passwordAlgo: row.passwordAlgo,
      enabledAt: row.enabledAt.toISOString(),
      passwordUpdatedAt: row.passwordUpdatedAt.toISOString(),
    };
  }

  async getPrivateVaultSummary(userId: string) {
    const config = await this.getPrivateModeConfig(userId);
    if (!config) {
      return {
        enabled: false,
        unlocked: false,
        autoLock: "browser" as const,
        totalItems: 0,
        pendingSyncCount: 0,
        syncEnabled: true,
      };
    }

    const [summaryRows, pendingRows] = await Promise.all([
      this.db
        .select({
          total: count(),
          lastUpdatedAt: sql<Date | null>`max(${privateBookmarks.updatedAt})`,
        })
        .from(privateBookmarks)
        .where(eq(privateBookmarks.userId, userId)),
      this.db
        .select({
          total: count(),
        })
        .from(privateCaptureUploads)
        .where(eq(privateCaptureUploads.userId, userId)),
    ]);

    return {
      enabled: true,
      unlocked: false,
      autoLock: "browser" as const,
      totalItems: Number(summaryRows[0]?.total ?? 0),
      pendingSyncCount: Number(pendingRows[0]?.total ?? 0),
      syncEnabled: true,
      lastUpdatedAt: summaryRows[0]?.lastUpdatedAt?.toISOString(),
    };
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

  async initPrivateCapture(userId: string, input: CaptureInitRequest): Promise<InitCaptureResult> {
    const normalizedUrlHash = hashNormalizedUrl(normalizeSourceUrl(input.url));
    const existing = await this.db
      .select({
        bookmarkId: privateBookmarks.id,
        versionId: privateBookmarkVersions.id,
        objectKey: privateBookmarkVersions.htmlObjectKey,
      })
      .from(privateBookmarks)
      .innerJoin(privateBookmarkVersions, eq(privateBookmarks.id, privateBookmarkVersions.bookmarkId))
      .where(
        and(
          eq(privateBookmarks.userId, userId),
          eq(privateBookmarks.normalizedUrlHash, normalizedUrlHash),
          eq(privateBookmarkVersions.htmlSha256, input.htmlSha256),
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
        objectKey: privateCaptureUploads.objectKey,
      })
      .from(privateCaptureUploads)
      .where(
        and(
          eq(privateCaptureUploads.userId, userId),
          eq(privateCaptureUploads.normalizedUrlHash, normalizedUrlHash),
          eq(privateCaptureUploads.htmlSha256, input.htmlSha256),
        ),
      )
      .orderBy(desc(privateCaptureUploads.createdAt))
      .limit(1);

    if (pending[0]) {
      return {
        alreadyExists: false,
        objectKey: pending[0].objectKey,
      };
    }

    const objectKey = this.createPrivateObjectKey(userId);
    await this.db
      .insert(privateCaptureUploads)
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
          privateCaptureUploads.userId,
          privateCaptureUploads.normalizedUrlHash,
          privateCaptureUploads.htmlSha256,
        ],
      });

    const claimedPending = await this.db
      .select({
        objectKey: privateCaptureUploads.objectKey,
      })
      .from(privateCaptureUploads)
      .where(
        and(
          eq(privateCaptureUploads.userId, userId),
          eq(privateCaptureUploads.normalizedUrlHash, normalizedUrlHash),
          eq(privateCaptureUploads.htmlSha256, input.htmlSha256),
        ),
      )
      .orderBy(desc(privateCaptureUploads.createdAt))
      .limit(1);

    if (!claimedPending[0]) {
      throw new Error("Failed to create or reuse pending private upload.");
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
        readerHtmlObjectKey: bookmarkVersions.readerHtmlObjectKey,
        sourceMetaJson: bookmarkVersions.sourceMetaJson,
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
      const readerHtmlObjectKey = existingByObjectKey[0].readerHtmlObjectKey
        ?? await this.persistReaderArchive(input.objectKey, input.readerHtml);
      const now = new Date();
      await this.db.transaction(async (tx) => {
        await tx
          .update(bookmarkVersions)
          .set({
            readerHtmlObjectKey,
            qualityScore: input.quality.score,
            qualityGrade: input.quality.grade,
            qualityReasonsJson: input.quality.reasons,
            qualityReportJson: input.quality,
            sourceMetaJson: this.buildSourceMetaPayload(
              input.source,
              input.mediaFiles,
              existingByObjectKey[0].sourceMetaJson,
            ),
          })
          .where(eq(bookmarkVersions.id, existingByObjectKey[0].versionId));

        await tx
          .update(bookmarks)
          .set({
            sourceUrl: input.source.url,
            canonicalUrl: input.source.canonicalUrl,
            title: input.source.title,
            domain: input.source.domain,
            latestVersionId: existingByObjectKey[0].versionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(bookmarks.userId, userId),
              eq(bookmarks.id, existingByObjectKey[0].bookmarkId),
            ),
          );
      });
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
          isFavorite: false,
          isPinnedOffline: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      const duplicateVersionRows = await tx
        .select({
          id: bookmarkVersions.id,
          htmlObjectKey: bookmarkVersions.htmlObjectKey,
          readerHtmlObjectKey: bookmarkVersions.readerHtmlObjectKey,
          sourceMetaJson: bookmarkVersions.sourceMetaJson,
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
        const readerHtmlObjectKey = duplicateVersionRows[0].readerHtmlObjectKey
          ?? await this.persistReaderArchive(
            duplicateVersionRows[0].htmlObjectKey,
            input.readerHtml,
          );
        await tx
          .update(bookmarkVersions)
          .set({
            readerHtmlObjectKey,
            qualityScore: input.quality.score,
            qualityGrade: input.quality.grade,
            qualityReasonsJson: input.quality.reasons,
            qualityReportJson: input.quality,
            sourceMetaJson: this.buildSourceMetaPayload(
              input.source,
              input.mediaFiles,
              duplicateVersionRows[0].sourceMetaJson,
            ),
          })
          .where(eq(bookmarkVersions.id, duplicatedVersionId));
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
      const readerHtmlObjectKey = await this.persistReaderArchive(input.objectKey, input.readerHtml);

      await tx.insert(bookmarkVersions).values({
        id: versionId,
        bookmarkId,
        versionNo,
        htmlObjectKey: input.objectKey,
        readerHtmlObjectKey,
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
        sourceMetaJson: this.buildSourceMetaPayload(input.source, input.mediaFiles),
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

  async completePrivateCapture(userId: string, input: CaptureCompleteRequest): Promise<CompleteCaptureResult> {
    const existingByObjectKey = await this.db
      .select({
        bookmarkId: privateBookmarks.id,
        versionId: privateBookmarkVersions.id,
        readerHtmlObjectKey: privateBookmarkVersions.readerHtmlObjectKey,
        sourceMetaJson: privateBookmarkVersions.sourceMetaJson,
      })
      .from(privateBookmarkVersions)
      .innerJoin(privateBookmarks, eq(privateBookmarks.id, privateBookmarkVersions.bookmarkId))
      .where(
        and(
          eq(privateBookmarks.userId, userId),
          eq(privateBookmarkVersions.htmlObjectKey, input.objectKey),
        ),
      )
      .limit(1);

    if (existingByObjectKey[0]) {
      const readerHtmlObjectKey = existingByObjectKey[0].readerHtmlObjectKey
        ?? await this.persistReaderArchive(input.objectKey, input.readerHtml);
      const now = new Date();
      await this.db.transaction(async (tx) => {
        await tx
          .update(privateBookmarkVersions)
          .set({
            readerHtmlObjectKey,
            qualityScore: input.quality.score,
            qualityGrade: input.quality.grade,
            qualityReasonsJson: input.quality.reasons,
            qualityReportJson: input.quality,
            sourceMetaJson: this.buildSourceMetaPayload(
              input.source,
              input.mediaFiles,
              existingByObjectKey[0].sourceMetaJson,
            ),
          })
          .where(eq(privateBookmarkVersions.id, existingByObjectKey[0].versionId));

        await tx
          .update(privateBookmarks)
          .set({
            sourceUrl: input.source.url,
            canonicalUrl: input.source.canonicalUrl,
            title: input.source.title,
            domain: input.source.domain,
            latestVersionId: existingByObjectKey[0].versionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(privateBookmarks.userId, userId),
              eq(privateBookmarks.id, existingByObjectKey[0].bookmarkId),
            ),
          );
      });
      const bookmark = await this.loadPrivateBookmark(existingByObjectKey[0].bookmarkId, userId);
      return {
        bookmark,
        versionId: existingByObjectKey[0].versionId,
        createdNewVersion: false,
        deduplicated: true,
      };
    }

    if (!(await this.objectStorage.hasObject(input.objectKey))) {
      throw new Error("Uploaded private archive object not found.");
    }

    const normalizedUrlHash = hashNormalizedUrl(normalizeSourceUrl(input.source.url));
    const now = new Date();

    const transactionResult = await this.db.transaction(async (tx) => {
      const pendingUpload = await tx
        .select()
        .from(privateCaptureUploads)
        .where(
          and(
            eq(privateCaptureUploads.objectKey, input.objectKey),
            eq(privateCaptureUploads.userId, userId),
          ),
        )
        .limit(1);
      const pending = pendingUpload[0];
      if (!pending) {
        throw new Error("Pending private capture not found for object key.");
      }

      const existingBookmarkRows = await tx
        .select({
          id: privateBookmarks.id,
        })
        .from(privateBookmarks)
        .where(
          and(
            eq(privateBookmarks.userId, userId),
            eq(privateBookmarks.normalizedUrlHash, normalizedUrlHash),
          ),
        )
        .orderBy(desc(privateBookmarks.updatedAt))
        .limit(1);

      const bookmarkId = existingBookmarkRows[0]?.id ?? crypto.randomUUID();
      if (!existingBookmarkRows[0]) {
        await tx.insert(privateBookmarks).values({
          id: bookmarkId,
          userId,
          sourceUrl: input.source.url,
          canonicalUrl: input.source.canonicalUrl,
          normalizedUrlHash,
          title: input.source.title,
          domain: input.source.domain,
          note: "",
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      const duplicateVersionRows = await tx
        .select({
          id: privateBookmarkVersions.id,
          htmlObjectKey: privateBookmarkVersions.htmlObjectKey,
          readerHtmlObjectKey: privateBookmarkVersions.readerHtmlObjectKey,
          sourceMetaJson: privateBookmarkVersions.sourceMetaJson,
        })
        .from(privateBookmarkVersions)
        .where(
          and(
            eq(privateBookmarkVersions.bookmarkId, bookmarkId),
            eq(privateBookmarkVersions.htmlSha256, input.htmlSha256),
          ),
        )
        .limit(1);

      if (duplicateVersionRows[0]) {
        const duplicatedVersionId = duplicateVersionRows[0].id;
        const readerHtmlObjectKey = duplicateVersionRows[0].readerHtmlObjectKey
          ?? await this.persistReaderArchive(
            duplicateVersionRows[0].htmlObjectKey,
            input.readerHtml,
          );
        await tx
          .update(privateBookmarkVersions)
          .set({
            readerHtmlObjectKey,
            qualityScore: input.quality.score,
            qualityGrade: input.quality.grade,
            qualityReasonsJson: input.quality.reasons,
            qualityReportJson: input.quality,
            sourceMetaJson: this.buildSourceMetaPayload(
              input.source,
              input.mediaFiles,
              duplicateVersionRows[0].sourceMetaJson,
            ),
          })
          .where(eq(privateBookmarkVersions.id, duplicatedVersionId));
        await tx
          .update(privateBookmarks)
          .set({
            sourceUrl: input.source.url,
            canonicalUrl: input.source.canonicalUrl,
            title: input.source.title,
            domain: input.source.domain,
            latestVersionId: duplicatedVersionId,
            updatedAt: now,
          })
          .where(eq(privateBookmarks.id, bookmarkId));
        await tx.delete(privateCaptureUploads).where(eq(privateCaptureUploads.objectKey, input.objectKey));
        return {
          bookmarkId,
          versionId: duplicatedVersionId,
          createdNewVersion: false,
          deduplicated: true,
        };
      }

      const nextVersionNoRows = await tx
        .select({
          nextVersionNo: sql<number>`coalesce(max(${privateBookmarkVersions.versionNo}), 0) + 1`,
        })
        .from(privateBookmarkVersions)
        .where(eq(privateBookmarkVersions.bookmarkId, bookmarkId));
      const versionNo = nextVersionNoRows[0]?.nextVersionNo ?? 1;
      const versionId = crypto.randomUUID();
      const objectStat = await this.objectStorage.statObject(input.objectKey);
      const readerHtmlObjectKey = await this.persistReaderArchive(input.objectKey, input.readerHtml);

      await tx.insert(privateBookmarkVersions).values({
        id: versionId,
        bookmarkId,
        versionNo,
        htmlObjectKey: input.objectKey,
        readerHtmlObjectKey,
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
        sourceMetaJson: this.buildSourceMetaPayload(input.source, input.mediaFiles),
        extractedText: input.extractedText ?? null,
        createdByDeviceId: null,
        createdAt: now,
      });

      await tx
        .update(privateBookmarks)
        .set({
          sourceUrl: input.source.url,
          canonicalUrl: input.source.canonicalUrl,
          title: input.source.title,
          domain: input.source.domain,
          latestVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(privateBookmarks.id, bookmarkId));

      await tx.delete(privateCaptureUploads).where(eq(privateCaptureUploads.objectKey, input.objectKey));

      return {
        bookmarkId,
        versionId,
        createdNewVersion: true,
        deduplicated: false,
      };
    });

    const bookmark = await this.loadPrivateBookmark(transactionResult.bookmarkId, userId);
    return {
      bookmark,
      versionId: transactionResult.versionId,
      createdNewVersion: transactionResult.createdNewVersion,
      deduplicated: transactionResult.deduplicated,
    };
  }

  async searchPrivateBookmarks(userId: string, query: BookmarkSearchQuery) {
    const conditions = [eq(privateBookmarks.userId, userId)];
    if (query.view === "favorites") {
      conditions.push(eq(privateBookmarks.isFavorite, true));
    }
    if (query.view === "recent") {
      conditions.push(gte(privateBookmarks.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    }
    if (query.domain) {
      conditions.push(eq(privateBookmarks.domain, query.domain));
    }
    if (query.quality) {
      conditions.push(eq(privateBookmarkVersions.qualityGrade, query.quality));
    }
    if (query.q?.trim()) {
      const needle = `%${query.q.trim()}%`;
      conditions.push(
        or(
          ilike(privateBookmarks.title, needle),
          ilike(privateBookmarks.sourceUrl, needle),
          ilike(privateBookmarks.domain, needle),
          ilike(privateBookmarks.note, needle),
          ilike(privateBookmarkVersions.extractedText, needle),
        )!,
      );
    }

    const totalRow = await this.db
      .select({
        total: count(),
      })
      .from(privateBookmarks)
      .leftJoin(privateBookmarkVersions, eq(privateBookmarks.latestVersionId, privateBookmarkVersions.id))
      .where(and(...conditions));
    const total = Number(totalRow[0]?.total ?? 0);
    if (total === 0) {
      return bookmarkSearchResponseSchema.parse({
        items: [],
        total: 0,
      });
    }

    const rows = await this.db
      .select({
        id: privateBookmarks.id,
        sourceUrl: privateBookmarks.sourceUrl,
        canonicalUrl: privateBookmarks.canonicalUrl,
        title: privateBookmarks.title,
        domain: privateBookmarks.domain,
        note: privateBookmarks.note,
        isFavorite: privateBookmarks.isFavorite,
        latestVersionId: privateBookmarks.latestVersionId,
        createdAt: privateBookmarks.createdAt,
        updatedAt: privateBookmarks.updatedAt,
        latestQualityReport: privateBookmarkVersions.qualityReportJson,
        latestSourceMeta: privateBookmarkVersions.sourceMetaJson,
      })
      .from(privateBookmarks)
      .leftJoin(privateBookmarkVersions, eq(privateBookmarks.latestVersionId, privateBookmarkVersions.id))
      .where(and(...conditions))
      .orderBy(desc(privateBookmarks.updatedAt))
      .limit(query.limit)
      .offset(query.offset);
    const versionCountMap = await this.loadPrivateVersionCounts(rows.map((row) => row.id));

    return bookmarkSearchResponseSchema.parse({
      items: rows.map((row) =>
        this.mapBookmarkRow({
          ...row,
          folderId: null,
          folderName: null,
          folderPath: null,
          folderParentId: null,
        }, {
          tags: [],
          versionCount: versionCountMap.get(row.id) ?? 0,
        })),
      total,
    });
  }

  async getPrivateBookmarkDetail(userId: string, bookmarkId: string) {
    const bookmark = await this.loadPrivateBookmarkOrNull(bookmarkId, userId);
    if (!bookmark) {
      return null;
    }

    const versions = await this.loadPrivateVersionsByBookmarkId(bookmarkId, userId);
    return {
      bookmark,
      versions,
    };
  }

  async ingestBookmark(userId: string, input: IngestBookmarkRequest): Promise<IngestBookmarkResult> {
    const normalizedUrl = normalizeSourceUrl(input.url);
    const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);
    const now = new Date();

    const transactionResult = await this.db.transaction(async (tx) => {
      const existingRows = await tx
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

      const existingBookmarkId = existingRows[0]?.id;
      if (existingBookmarkId) {
        if (input.dedupeStrategy === "skip") {
          return {
            bookmarkId: existingBookmarkId,
            status: "skipped" as const,
            deduplicated: true,
          };
        }

        const patch: Partial<typeof bookmarks.$inferInsert> = {
          updatedAt: now,
        };
        const title = input.title?.trim();
        if (title) {
          patch.title = title;
        }
        if (input.note !== undefined) {
          patch.note = input.note;
        }
        if (input.folderPath?.trim()) {
          patch.folderId = await this.ensureFolderPathId(tx, userId, input.folderPath, now);
        }

        await tx
          .update(bookmarks)
          .set(patch)
          .where(
            and(
              eq(bookmarks.userId, userId),
              eq(bookmarks.id, existingBookmarkId),
            ),
          );

        const tagIds = await this.ensureTagIdsByName(tx, userId, input.tags ?? [], now);
        if (tagIds.length > 0) {
          await tx
            .insert(bookmarkTags)
            .values(tagIds.map((tagId) => ({
              bookmarkId: existingBookmarkId,
              tagId,
              createdAt: now,
            })))
            .onConflictDoNothing();
        }

        return {
          bookmarkId: existingBookmarkId,
          status: "merged" as const,
          deduplicated: true,
        };
      }

      const bookmarkId = crypto.randomUUID();
      const folderId = input.folderPath?.trim()
        ? await this.ensureFolderPathId(tx, userId, input.folderPath, now)
        : null;
      await tx.insert(bookmarks).values({
        id: bookmarkId,
        userId,
        sourceUrl: normalizedUrl,
        canonicalUrl: null,
        normalizedUrlHash,
        title: this.resolveIngestTitle(input.title, normalizedUrl),
        domain: new URL(normalizedUrl).hostname,
        latestVersionId: null,
        folderId,
        note: input.note ?? "",
        isFavorite: false,
        isPinnedOffline: false,
        createdAt: now,
        updatedAt: now,
      });

      const tagIds = await this.ensureTagIdsByName(tx, userId, input.tags ?? [], now);
      if (tagIds.length > 0) {
        await tx.insert(bookmarkTags).values(
          tagIds.map((tagId) => ({
            bookmarkId,
            tagId,
            createdAt: now,
          })),
        );
      }

      return {
        bookmarkId,
        status: "created" as const,
        deduplicated: false,
      };
    });

    const bookmark = await this.loadBookmark(transactionResult.bookmarkId, userId);
    return {
      bookmark,
      status: transactionResult.status,
      deduplicated: transactionResult.deduplicated,
    };
  }

  async searchBookmarks(userId: string, query: BookmarkSearchQuery) {
    const conditions = [eq(bookmarks.userId, userId)];
    if (query.view === "favorites") {
      conditions.push(eq(bookmarks.isFavorite, true));
    }
    if (query.view === "recent") {
      conditions.push(gte(bookmarks.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    }
    if (query.domain) {
      conditions.push(eq(bookmarks.domain, query.domain));
    }
    if (query.quality) {
      conditions.push(eq(bookmarkVersions.qualityGrade, query.quality));
    }
    if (query.folderId) {
      const folderIds = await this.loadFolderSubtreeIds(userId, query.folderId);
      if (folderIds.length === 0) {
        return bookmarkSearchResponseSchema.parse({
          items: [],
          total: 0,
        });
      }
      conditions.push(inArray(bookmarks.folderId, folderIds));
    }
    if (query.tagId) {
      conditions.push(
        sql<boolean>`exists (
          select 1
          from ${bookmarkTags}
          where ${bookmarkTags.bookmarkId} = ${bookmarks.id}
            and ${bookmarkTags.tagId} = ${query.tagId}
        )`,
      );
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

    const totalRow = await this.db
      .select({
        total: count(),
      })
      .from(bookmarks)
      .leftJoin(bookmarkVersions, eq(bookmarks.latestVersionId, bookmarkVersions.id))
      .leftJoin(folders, eq(bookmarks.folderId, folders.id))
      .where(and(...conditions));
    const total = Number(totalRow[0]?.total ?? 0);
    if (total === 0) {
      return bookmarkSearchResponseSchema.parse({
        items: [],
        total: 0,
      });
    }

    const rows = await this.db
      .select({
        id: bookmarks.id,
        sourceUrl: bookmarks.sourceUrl,
        canonicalUrl: bookmarks.canonicalUrl,
        title: bookmarks.title,
        domain: bookmarks.domain,
        note: bookmarks.note,
        isFavorite: bookmarks.isFavorite,
        latestVersionId: bookmarks.latestVersionId,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        folderId: folders.id,
        folderName: folders.name,
        folderPath: folders.path,
        folderParentId: folders.parentId,
        latestQualityReport: bookmarkVersions.qualityReportJson,
        latestSourceMeta: bookmarkVersions.sourceMetaJson,
      })
      .from(bookmarks)
      .leftJoin(bookmarkVersions, eq(bookmarks.latestVersionId, bookmarkVersions.id))
      .leftJoin(folders, eq(bookmarks.folderId, folders.id))
      .where(and(...conditions))
      .orderBy(desc(bookmarks.updatedAt))
      .limit(query.limit)
      .offset(query.offset);
    const paginatedBookmarkIds = rows.map((row) => row.id);
    const tagMap = await this.loadTagsByBookmarkId(paginatedBookmarkIds);
    const versionCountMap = await this.loadVersionCounts(paginatedBookmarkIds);

    const paginated = rows.map((row) =>
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

  async getBookmarkSidebarStats(userId: string) {
    const rows = await this.db
      .select({
        folderId: bookmarks.folderId,
        count: count(),
      })
      .from(bookmarks)
      .where(and(
        eq(bookmarks.userId, userId),
        sql<boolean>`${bookmarks.folderId} is not null`,
      ))
      .groupBy(bookmarks.folderId);

    return bookmarkSidebarStatsResponseSchema.parse({
      folderCounts: rows.flatMap((row) => (
        typeof row.folderId === "string"
          ? [{
              folderId: row.folderId,
              count: Number(row.count),
            }]
          : []
      )),
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

  async deleteBookmark(userId: string, bookmarkId: string) {
    const rows = await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId)))
      .returning({
        id: bookmarks.id,
      });
    return Boolean(rows[0]);
  }

  async updateBookmarkMetadata(
    userId: string,
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
  ) {
    const existing = await this.loadBookmarkOrNull(bookmarkId, userId);
    if (!existing) {
      return null;
    }

    const now = new Date();

    await this.db.transaction(async (tx) => {
      let folderId = existing.folder?.id ?? null;
      if (input.folderPath !== undefined) {
        folderId = await this.ensureFolderPathId(tx, userId, input.folderPath, now);
      } else if (input.folderId !== undefined) {
        if (input.folderId === null) {
          folderId = null;
        } else {
          const folder = await this.loadFolderOrNull(userId, input.folderId);
          if (!folder) {
            throw new HttpError(404, "FolderNotFound", "Folder not found.");
          }
          folderId = folder.id;
        }
      }

      const tagIds = input.tags !== undefined
        ? await this.ensureTagIdsByName(tx, userId, input.tags, now)
        : input.tagIds !== undefined
        ? await this.resolveTagIds(userId, input.tagIds)
        : undefined;

      const patch: Partial<typeof bookmarks.$inferInsert> = {
        updatedAt: now,
      };
      if (input.note !== undefined) {
        patch.note = input.note;
      }
      if (input.isFavorite !== undefined) {
        patch.isFavorite = input.isFavorite;
      }
      if (input.folderPath !== undefined || input.folderId !== undefined) {
        patch.folderId = folderId;
      }
      await tx.update(bookmarks).set(patch).where(eq(bookmarks.id, bookmarkId));

      if (tagIds !== undefined) {
        await tx.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, bookmarkId));
        if (tagIds.length > 0) {
          await tx.insert(bookmarkTags).values(
            tagIds.map((tagId) => ({
              bookmarkId,
              tagId,
              createdAt: now,
            })),
          );
        }
      }
    });

    return this.loadBookmark(bookmarkId, userId);
  }

  async listFolders(userId: string) {
    return this.loadAllFolders(userId);
  }

  async createFolder(userId: string, input: FolderCreateRequest) {
    const allFolders = await this.loadAllFolders(userId);
    const parent = input.parentId
      ? allFolders.find((folder) => folder.id === input.parentId)
      : undefined;
    if (input.parentId && !parent) {
      throw new HttpError(404, "FolderNotFound", "Parent folder not found.");
    }

    const nextPath = this.buildFolderPath(parent?.path, input.name);
    this.assertUniqueFolderPath(allFolders, nextPath);
    const now = new Date();
    const rows = await this.db
      .insert(folders)
      .values({
        userId,
        name: input.name,
        path: nextPath,
        parentId: parent?.id ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        parentId: folders.parentId,
      });

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create folder.");
    }
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parentId,
    };
  }

  async updateFolder(userId: string, folderId: string, input: FolderUpdateRequest) {
    const allFolders = await this.loadAllFolders(userId);
    const current = allFolders.find((folder) => folder.id === folderId);
    if (!current) {
      return null;
    }

    const nextName = input.name ?? current.name;
    const nextParentId = input.parentId !== undefined ? input.parentId : current.parentId ?? null;
    if (nextParentId === folderId) {
      throw new HttpError(400, "InvalidFolderMove", "Folder cannot be its own parent.");
    }

    const descendants = this.collectFolderSubtree(allFolders, current.path);
    const descendantIds = new Set(descendants.map((folder) => folder.id));
    if (nextParentId && descendantIds.has(nextParentId)) {
      throw new HttpError(400, "InvalidFolderMove", "Folder cannot be moved into its child.");
    }

    const parent = nextParentId
      ? allFolders.find((folder) => folder.id === nextParentId)
      : undefined;
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
    this.assertFolderPathSetAvailable(allFolders, nextPaths, descendantIds);

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const folder of descendants) {
        const candidatePath = nextPaths.get(folder.id);
        if (!candidatePath) {
          continue;
        }
        if (folder.id === folderId) {
          await tx
            .update(folders)
            .set({
              name: nextName,
              path: candidatePath,
              parentId: nextParentId,
              updatedAt: now,
            })
            .where(and(eq(folders.id, folder.id), eq(folders.userId, userId)));
          continue;
        }

        await tx
          .update(folders)
          .set({
            path: candidatePath,
            updatedAt: now,
          })
          .where(and(eq(folders.id, folder.id), eq(folders.userId, userId)));
      }
    });

    return this.loadFolderOrNull(userId, folderId);
  }

  async deleteFolder(userId: string, folderId: string) {
    const allFolders = await this.loadAllFolders(userId);
    const current = allFolders.find((folder) => folder.id === folderId);
    if (!current) {
      return false;
    }

    const subtree = this.collectFolderSubtree(allFolders, current.path);
    const subtreeIds = new Set(subtree.map((folder) => folder.id));
    const parent = current.parentId
      ? allFolders.find((folder) => folder.id === current.parentId)
      : undefined;
    const parentPath = parent?.path;

    const nextPaths = new Map<string, string>();
    for (const folder of subtree) {
      if (folder.id === folderId) {
        continue;
      }
      const relativePath = folder.path.slice(current.path.length + 1);
      const candidatePath = parentPath ? `${parentPath}/${relativePath}` : relativePath;
      nextPaths.set(folder.id, candidatePath);
    }
    this.assertFolderPathSetAvailable(allFolders, nextPaths, subtreeIds);

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const folder of subtree) {
        if (folder.id === folderId) {
          continue;
        }
        const candidatePath = nextPaths.get(folder.id);
        if (!candidatePath) {
          continue;
        }
        const patch: Partial<typeof folders.$inferInsert> = {
          path: candidatePath,
          updatedAt: now,
        };
        if (folder.parentId === folderId) {
          patch.parentId = current.parentId ?? null;
        }
        await tx
          .update(folders)
          .set(patch)
          .where(and(eq(folders.id, folder.id), eq(folders.userId, userId)));
      }

      await tx
        .delete(folders)
        .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
    });

    return true;
  }

  async listTags(userId: string) {
    const rows = await this.db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(tags)
      .where(eq(tags.userId, userId))
      .orderBy(tags.name);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color ?? undefined,
    }));
  }

  async createTag(userId: string, input: TagCreateRequest) {
    const allTags = await this.listTags(userId);
    this.assertUniqueTagName(allTags, input.name);
    const rows = await this.db
      .insert(tags)
      .values({
        userId,
        name: input.name,
        color: input.color ?? null,
      })
      .returning({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      });

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create tag.");
    }
    return {
      id: row.id,
      name: row.name,
      color: row.color ?? undefined,
    };
  }

  async updateTag(userId: string, tagId: string, input: TagUpdateRequest) {
    const allTags = await this.listTags(userId);
    const current = allTags.find((tag) => tag.id === tagId);
    if (!current) {
      return null;
    }

    const nextName = input.name ?? current.name;
    const nextColor = input.color === undefined ? current.color : input.color ?? undefined;
    this.assertUniqueTagName(allTags, nextName, tagId);

    const rows = await this.db
      .update(tags)
      .set({
        name: nextName,
        color: nextColor ?? null,
      })
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      });

    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      color: row.color ?? undefined,
    };
  }

  async deleteTag(userId: string, tagId: string) {
    const rows = await this.db
      .delete(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning({
        id: tags.id,
      });
    return Boolean(rows[0]);
  }

  async findImportBookmarkMatches(userId: string, normalizedUrlHashes: string[]) {
    if (normalizedUrlHashes.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        normalizedUrlHash: bookmarks.normalizedUrlHash,
        bookmarkId: bookmarks.id,
        title: bookmarks.title,
        latestVersionId: bookmarks.latestVersionId,
      })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, userId),
          inArray(bookmarks.normalizedUrlHash, normalizedUrlHashes),
        ),
      );

    return rows.map((row) => ({
      normalizedUrlHash: row.normalizedUrlHash,
      bookmarkId: row.bookmarkId,
      title: row.title,
      hasArchive: Boolean(row.latestVersionId),
      latestVersionId: row.latestVersionId ?? undefined,
    })) satisfies ImportBookmarkMatch[];
  }

  async createImportTask(userId: string, input: CreateImportTaskInput): Promise<ImportTaskDetailResponse> {
    const taskId = createImportTaskId();
    const createdAt = new Date();
    const existingMatches = await this.findImportBookmarkMatches(
      userId,
      input.items
        .map((item) => item.normalizedUrlHash)
        .filter((value): value is string => Boolean(value)),
    );
    const matchMap = new Map(existingMatches.map((match) => [match.normalizedUrlHash, match]));

    const detail = await this.db.transaction(async (tx) => {
      await tx.insert(importTasks).values({
        id: taskId,
        userId,
        name: input.taskName,
        sourceType: input.sourceType,
        mode: input.options.mode,
        status: "running",
        fileName: input.fileName,
        totalCount: input.preview.summary.totalCount,
        validCount: input.preview.summary.validCount,
        invalidCount: input.preview.summary.invalidCount,
        duplicateInFileCount: input.preview.summary.duplicateInFileCount,
        duplicateExistingCount: input.preview.summary.duplicateExistingCount,
        createdCount: 0,
        mergedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        archiveQueuedCount: 0,
        archiveSuccessCount: 0,
        archiveFailedCount: 0,
        sourceMetaJson: {
          options: input.options,
          preview: input.preview.summary,
        },
        createdAt,
        updatedAt: createdAt,
      });

      const itemRows: typeof importItems.$inferInsert[] = [];
      let createdCount = 0;
      let mergedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const item of input.items) {
        const now = new Date();

        if (!item.valid) {
          itemRows.push(this.toImportItemInsert(userId, taskId, item, {
            status: "skipped",
            dedupeResult: "invalid_input",
            reason: item.reason ?? "无法解析的链接。",
            createdAt: now,
            updatedAt: now,
          }));
          skippedCount += 1;
          continue;
        }

        if (item.duplicateInFile) {
          itemRows.push(this.toImportItemInsert(userId, taskId, item, {
            status: "skipped",
            dedupeResult: "skipped_duplicate",
            reason: item.reason ?? "与本次导入中的更早条目重复。",
            createdAt: now,
            updatedAt: now,
          }));
          skippedCount += 1;
          continue;
        }

        const existing = item.normalizedUrlHash ? matchMap.get(item.normalizedUrlHash) : undefined;
        if (existing) {
          if (input.options.dedupeStrategy === "update_metadata") {
            await this.updateImportedBookmarkMetadata(
              tx,
              userId,
              existing.bookmarkId,
              item,
              input.taskName,
              input.options,
              now,
            );
          }

          if (input.options.dedupeStrategy === "skip") {
            itemRows.push(this.toImportItemInsert(userId, taskId, item, {
              status: "skipped",
              dedupeResult: "skipped_existing",
              reason: "站内已存在同一链接，按当前策略跳过。",
              bookmarkId: existing.bookmarkId,
              archivedVersionId: existing.latestVersionId,
              hasArchive: existing.hasArchive,
              createdAt: now,
              updatedAt: now,
            }));
            skippedCount += 1;
          } else {
            itemRows.push(this.toImportItemInsert(userId, taskId, item, {
              status: "deduplicated",
              dedupeResult: "merged_existing",
              reason: existing.hasArchive ? "已合并到现有书签，且该书签已有归档。" : "已合并到现有书签。",
              bookmarkId: existing.bookmarkId,
              archivedVersionId: existing.latestVersionId,
              hasArchive: existing.hasArchive,
              createdAt: now,
              updatedAt: now,
            }));
            mergedCount += 1;
          }
          continue;
        }

        try {
          const bookmarkId = await this.insertImportedBookmark(
            tx,
            userId,
            item,
            input.taskName,
            input.options,
            now,
          );
          itemRows.push(this.toImportItemInsert(userId, taskId, item, {
            status: "created_bookmark",
            dedupeResult: "created_bookmark",
            reason: input.options.mode === "links_only" ? "已完成轻导入。" : "已完成轻导入，云端存档已排队。",
            bookmarkId,
            hasArchive: false,
            createdAt: now,
            updatedAt: now,
          }));
          createdCount += 1;
        } catch (error) {
          itemRows.push(this.toImportItemInsert(userId, taskId, item, {
            status: "failed",
            dedupeResult: "none",
            reason: error instanceof Error ? error.message : "导入时发生未知错误。",
            createdAt: now,
            updatedAt: now,
          }));
          failedCount += 1;
        }
      }

      if (itemRows.length > 0) {
        await tx.insert(importItems).values(itemRows);
      }

      const completedAt = new Date();
      const status = failedCount > 0 || input.preview.summary.invalidCount > 0
        ? "partial_failed"
        : "completed";

      await tx
        .update(importTasks)
        .set({
          status,
          createdCount,
          mergedCount,
          skippedCount,
          failedCount,
          updatedAt: completedAt,
          completedAt,
        })
        .where(eq(importTasks.id, taskId));

      return {
        task: {
          id: taskId,
          name: input.taskName,
          sourceType: input.sourceType,
          mode: input.options.mode,
          status,
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
          createdAt: createdAt.toISOString(),
          updatedAt: completedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
        items: itemRows.map((row) => ({
          id: row.id,
          taskId: row.taskId,
          index: row.position,
          title: row.title,
          url: row.sourceUrl ?? undefined,
          domain: row.domain ?? undefined,
          folderPath: row.folderPath ?? undefined,
          status: row.status,
          dedupeResult: row.dedupeResult,
          reason: row.reason ?? undefined,
          bookmarkId: row.bookmarkId ?? undefined,
          archivedVersionId: row.archivedVersionId ?? undefined,
          hasArchive: row.hasArchive ?? false,
          createdAt: (row.createdAt ?? createdAt).toISOString(),
          updatedAt: (row.updatedAt ?? createdAt).toISOString(),
        })),
      } satisfies ImportTaskDetailResponse;
    });

    return detail;
  }

  async listImportTasks(userId: string) {
    const rows = await this.db
      .select()
      .from(importTasks)
      .where(eq(importTasks.userId, userId))
      .orderBy(desc(importTasks.createdAt));

    return rows.map((row) => this.mapImportTaskRow(row));
  }

  async getImportTaskDetail(userId: string, taskId: string) {
    const taskRows = await this.db
      .select()
      .from(importTasks)
      .where(
        and(
          eq(importTasks.userId, userId),
          eq(importTasks.id, taskId),
        ),
      )
      .limit(1);
    const taskRow = taskRows[0];
    if (!taskRow) {
      return null;
    }

    const itemRows = await this.db
      .select()
      .from(importItems)
      .where(
        and(
          eq(importItems.userId, userId),
          eq(importItems.taskId, taskId),
        ),
      )
      .orderBy(importItems.position);

    return {
      task: this.mapImportTaskRow(taskRow),
      items: itemRows.map((row) => this.mapImportItemRow(row)),
    } satisfies ImportTaskDetailResponse;
  }

  async userCanReadObject(userId: string, objectKey: string) {
    const ownerHtmlObjectKey = deriveHtmlObjectKeyFromMediaObjectKey(objectKey) ?? objectKey;
    const rows = await this.db
      .select({
        id: bookmarkVersions.id,
      })
      .from(bookmarkVersions)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarkVersions.bookmarkId))
      .where(
        and(
          eq(bookmarks.userId, userId),
          or(
            eq(bookmarkVersions.htmlObjectKey, ownerHtmlObjectKey),
            eq(bookmarkVersions.readerHtmlObjectKey, ownerHtmlObjectKey),
          ),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return true;
    }

    const privateRows = await this.db
      .select({
        id: privateBookmarkVersions.id,
      })
      .from(privateBookmarkVersions)
      .innerJoin(privateBookmarks, eq(privateBookmarks.id, privateBookmarkVersions.bookmarkId))
      .where(
        and(
          eq(privateBookmarks.userId, userId),
          or(
            eq(privateBookmarkVersions.htmlObjectKey, ownerHtmlObjectKey),
            eq(privateBookmarkVersions.readerHtmlObjectKey, ownerHtmlObjectKey),
          ),
        ),
      )
      .limit(1);
    return Boolean(privateRows[0]);
  }

  async userCanWriteObject(userId: string, objectKey: string) {
    const ownerHtmlObjectKey = deriveHtmlObjectKeyFromMediaObjectKey(objectKey) ?? objectKey;
    const pendingRows = await this.db
      .select({
        objectKey: captureUploads.objectKey,
      })
      .from(captureUploads)
      .where(
        and(
          eq(captureUploads.userId, userId),
          eq(captureUploads.objectKey, ownerHtmlObjectKey),
        ),
      )
      .limit(1);
    if (pendingRows[0]) {
      return true;
    }

    const privatePendingRows = await this.db
      .select({
        objectKey: privateCaptureUploads.objectKey,
      })
      .from(privateCaptureUploads)
      .where(
        and(
          eq(privateCaptureUploads.userId, userId),
          eq(privateCaptureUploads.objectKey, ownerHtmlObjectKey),
        ),
      )
      .limit(1);
    if (privatePendingRows[0]) {
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
        isFavorite: bookmarks.isFavorite,
        latestVersionId: bookmarks.latestVersionId,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        folderId: folders.id,
        folderName: folders.name,
        folderPath: folders.path,
        folderParentId: folders.parentId,
        latestQualityReport: bookmarkVersions.qualityReportJson,
        latestSourceMeta: bookmarkVersions.sourceMetaJson,
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

  private async loadPrivateBookmark(bookmarkId: string, userId: string): Promise<Bookmark> {
    const bookmark = await this.loadPrivateBookmarkOrNull(bookmarkId, userId);
    if (!bookmark) {
      throw new Error(`Private bookmark not found: ${bookmarkId}`);
    }
    return bookmark;
  }

  private async loadPrivateBookmarkOrNull(bookmarkId: string, userId: string): Promise<Bookmark | null> {
    const rows = await this.db
      .select({
        id: privateBookmarks.id,
        sourceUrl: privateBookmarks.sourceUrl,
        canonicalUrl: privateBookmarks.canonicalUrl,
        title: privateBookmarks.title,
        domain: privateBookmarks.domain,
        note: privateBookmarks.note,
        isFavorite: privateBookmarks.isFavorite,
        latestVersionId: privateBookmarks.latestVersionId,
        createdAt: privateBookmarks.createdAt,
        updatedAt: privateBookmarks.updatedAt,
        latestQualityReport: privateBookmarkVersions.qualityReportJson,
        latestSourceMeta: privateBookmarkVersions.sourceMetaJson,
      })
      .from(privateBookmarks)
      .leftJoin(privateBookmarkVersions, eq(privateBookmarks.latestVersionId, privateBookmarkVersions.id))
      .where(
        and(
          eq(privateBookmarks.id, bookmarkId),
          eq(privateBookmarks.userId, userId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    const versionCounts = await this.loadPrivateVersionCounts([bookmarkId]);
    return this.mapBookmarkRow({
      ...row,
      folderId: null,
      folderName: null,
      folderPath: null,
      folderParentId: null,
    }, {
      tags: [],
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
        readerHtmlObjectKey: bookmarkVersions.readerHtmlObjectKey,
        htmlSha256: bookmarkVersions.htmlSha256,
        textSha256: bookmarkVersions.textSha256,
        textSimhash: bookmarkVersions.textSimhash,
        captureProfile: bookmarkVersions.captureProfile,
        qualityReport: bookmarkVersions.qualityReportJson,
        sourceMeta: bookmarkVersions.sourceMetaJson,
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
        readerHtmlObjectKey: row.readerHtmlObjectKey ?? undefined,
        htmlSha256: row.htmlSha256,
        textSha256: row.textSha256 ?? undefined,
        textSimhash: row.textSimhash ?? undefined,
        mediaFiles: this.readMediaFiles(row.sourceMeta),
        captureProfile: row.captureProfile,
        quality: this.readQuality(row.qualityReport),
        createdAt: row.createdAt.toISOString(),
      }),
    );
  }

  private async loadPrivateVersionsByBookmarkId(bookmarkId: string, userId: string): Promise<BookmarkVersion[]> {
    const rows = await this.db
      .select({
        id: privateBookmarkVersions.id,
        bookmarkId: privateBookmarkVersions.bookmarkId,
        versionNo: privateBookmarkVersions.versionNo,
        htmlObjectKey: privateBookmarkVersions.htmlObjectKey,
        readerHtmlObjectKey: privateBookmarkVersions.readerHtmlObjectKey,
        htmlSha256: privateBookmarkVersions.htmlSha256,
        textSha256: privateBookmarkVersions.textSha256,
        textSimhash: privateBookmarkVersions.textSimhash,
        captureProfile: privateBookmarkVersions.captureProfile,
        qualityReport: privateBookmarkVersions.qualityReportJson,
        sourceMeta: privateBookmarkVersions.sourceMetaJson,
        createdAt: privateBookmarkVersions.createdAt,
      })
      .from(privateBookmarkVersions)
      .innerJoin(privateBookmarks, eq(privateBookmarks.id, privateBookmarkVersions.bookmarkId))
      .where(
        and(
          eq(privateBookmarks.userId, userId),
          eq(privateBookmarkVersions.bookmarkId, bookmarkId),
        ),
      )
      .orderBy(desc(privateBookmarkVersions.versionNo));

    return rows.map((row) =>
      bookmarkVersionSchema.parse({
        id: row.id,
        bookmarkId: row.bookmarkId,
        versionNo: row.versionNo,
        htmlObjectKey: row.htmlObjectKey,
        readerHtmlObjectKey: row.readerHtmlObjectKey ?? undefined,
        htmlSha256: row.htmlSha256,
        textSha256: row.textSha256 ?? undefined,
        textSimhash: row.textSimhash ?? undefined,
        mediaFiles: this.readMediaFiles(row.sourceMeta),
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

  private async loadPrivateVersionCounts(bookmarkIds: string[]) {
    const versionCountMap = new Map<string, number>();
    if (bookmarkIds.length === 0) {
      return versionCountMap;
    }

    const countRows = await this.db
      .select({
        bookmarkId: privateBookmarkVersions.bookmarkId,
        count: count(),
      })
      .from(privateBookmarkVersions)
      .where(inArray(privateBookmarkVersions.bookmarkId, bookmarkIds))
      .groupBy(privateBookmarkVersions.bookmarkId);

    for (const row of countRows) {
      versionCountMap.set(row.bookmarkId, Number(row.count));
    }
    return versionCountMap;
  }

  private async insertImportedBookmark(
    tx: any,
    userId: string,
    item: {
      title: string;
      url?: string;
      normalizedUrl?: string;
      normalizedUrlHash?: string;
      domain?: string;
      folderPath?: string;
      sourceTags: string[];
    },
    taskName: string,
    options: ImportExecutionOptions,
    now: Date,
  ) {
    if (!item.url || !item.normalizedUrlHash || !item.domain) {
      throw new Error("导入条目缺少有效 URL。");
    }

    const bookmarkId = crypto.randomUUID();
    const folderId = await this.ensureFolderId(tx, userId, item.folderPath, options, now);
    await tx.insert(bookmarks).values({
      id: bookmarkId,
      userId,
      sourceUrl: item.url,
      canonicalUrl: null,
      normalizedUrlHash: item.normalizedUrlHash,
      title: this.pickImportTitle(item.url, item.title, options),
      domain: item.domain,
      latestVersionId: null,
      folderId,
      note: "",
      isFavorite: false,
      isPinnedOffline: false,
      createdAt: now,
      updatedAt: now,
    });

    const tagIds = await this.ensureTagIds(tx, userId, item.sourceTags, taskName, options, now);
    if (tagIds.length > 0) {
      await tx.insert(bookmarkTags).values(
        tagIds.map((tagId) => ({
          bookmarkId,
          tagId,
          createdAt: now,
        })),
      );
    }

    return bookmarkId;
  }

  private async updateImportedBookmarkMetadata(
    tx: any,
    userId: string,
    bookmarkId: string,
    item: {
      title: string;
      folderPath?: string;
      sourceTags: string[];
      url?: string;
    },
    taskName: string,
    options: ImportExecutionOptions,
    now: Date,
  ) {
    const folderId = await this.ensureFolderId(tx, userId, item.folderPath, options, now);
    await tx
      .update(bookmarks)
      .set({
        title: this.pickImportTitle(item.url ?? item.title, item.title, options),
        folderId,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.id, bookmarkId),
        ),
      );

    const tagIds = await this.ensureTagIds(tx, userId, item.sourceTags, taskName, options, now);
    if (tagIds.length === 0) {
      return;
    }

    await tx
      .insert(bookmarkTags)
      .values(tagIds.map((tagId) => ({
        bookmarkId,
        tagId,
        createdAt: now,
      })))
      .onConflictDoNothing();
  }

  private async ensureFolderPathId(
    tx: any,
    userId: string,
    folderPath: string,
    now: Date,
  ) {
    const segments = folderPath.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    let currentPath = "";
    let parentId: string | null = null;
    let currentId: string | null = null;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existingRows = await tx
        .select({
          id: folders.id,
        })
        .from(folders)
        .where(
          and(
            eq(folders.userId, userId),
            eq(folders.path, currentPath),
          ),
        )
        .limit(1);

      if (existingRows[0]?.id) {
        currentId = existingRows[0].id;
        parentId = currentId;
        continue;
      }

      currentId = crypto.randomUUID();
      await tx.insert(folders).values({
        id: currentId,
        userId,
        name: segment,
        path: currentPath,
        parentId,
        createdAt: now,
        updatedAt: now,
      });
      parentId = currentId;
    }

    return currentId;
  }

  private async ensureTagIdsByName(
    tx: any,
    userId: string,
    tagNames: string[],
    now: Date,
  ) {
    const names = [...new Set(tagNames.map((tagName) => tagName.trim()).filter(Boolean))];
    if (names.length === 0) {
      return [];
    }

    const rows: string[] = [];
    for (const name of names) {
      const existingRows = await tx
        .select({
          id: tags.id,
        })
        .from(tags)
        .where(
          and(
            eq(tags.userId, userId),
            eq(tags.name, name),
          ),
        )
        .limit(1);

      if (existingRows[0]?.id) {
        rows.push(existingRows[0].id);
        continue;
      }

      const tagId = crypto.randomUUID();
      await tx.insert(tags).values({
        id: tagId,
        userId,
        name,
        createdAt: now,
      });
      rows.push(tagId);
    }

    return rows;
  }

  private async ensureFolderId(
    tx: any,
    userId: string,
    sourceFolderPath: string | undefined,
    options: ImportExecutionOptions,
    now: Date,
  ) {
    if (options.targetFolderMode === "flatten") {
      return null;
    }

    const path = options.targetFolderMode === "specific"
      ? options.targetFolderPath?.trim()
      : sourceFolderPath?.trim();
    if (!path) {
      return null;
    }

    const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    let currentPath = "";
    let parentId: string | null = null;
    let currentId: string | null = null;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existingRows = await tx
        .select({
          id: folders.id,
        })
        .from(folders)
        .where(
          and(
            eq(folders.userId, userId),
            eq(folders.path, currentPath),
          ),
        )
        .limit(1);

      if (existingRows[0]?.id) {
        currentId = existingRows[0].id;
        parentId = currentId;
        continue;
      }

      currentId = crypto.randomUUID();
      await tx.insert(folders).values({
        id: currentId,
        userId,
        name: segment,
        path: currentPath,
        parentId,
        createdAt: now,
        updatedAt: now,
      });
      parentId = currentId;
    }

    return currentId;
  }

  private async ensureTagIds(
    tx: any,
    userId: string,
    sourceTags: string[],
    _taskName: string,
    options: ImportExecutionOptions,
    now: Date,
  ) {
    const names = new Set<string>();
    if (options.tagStrategy === "keep_source_tags") {
      for (const tagName of sourceTags) {
        if (tagName.trim()) {
          names.add(tagName.trim());
        }
      }
    }
    if (names.size === 0) {
      return [];
    }

    const rows = [];
    for (const name of names) {
      const existingRows = await tx
        .select({
          id: tags.id,
        })
        .from(tags)
        .where(
          and(
            eq(tags.userId, userId),
            eq(tags.name, name),
          ),
        )
        .limit(1);

      if (existingRows[0]?.id) {
        rows.push(existingRows[0].id);
        continue;
      }

      const tagId = crypto.randomUUID();
      await tx.insert(tags).values({
        id: tagId,
        userId,
        name,
        createdAt: now,
      });
      rows.push(tagId);
    }

    return rows;
  }

  private pickImportTitle(
    fallbackTitle: string,
    importedTitle: string,
    options: ImportExecutionOptions,
  ) {
    if (options.titleStrategy === "prefer_page_title") {
      return fallbackTitle;
    }
    return importedTitle.trim() || fallbackTitle;
  }

  private toImportItemInsert(
    userId: string,
    taskId: string,
    item: {
      index: number;
      title: string;
      url?: string;
      normalizedUrl?: string;
      normalizedUrlHash?: string;
      domain?: string;
      folderPath?: string;
      sourceTags: string[];
    },
    overrides: Omit<
      typeof importItems.$inferInsert,
      "id" | "taskId" | "userId" | "position" | "title" | "sourceUrl" | "normalizedUrl" | "normalizedUrlHash" | "domain" | "folderPath" | "sourceTagsJson" | "sourceMetaJson"
    >,
  ) {
    return {
      id: createImportTaskItemId(),
      taskId,
      userId,
      position: item.index,
      title: item.title,
      sourceUrl: item.url ?? null,
      normalizedUrl: item.normalizedUrl ?? null,
      normalizedUrlHash: item.normalizedUrlHash ?? null,
      domain: item.domain ?? null,
      folderPath: item.folderPath ?? null,
      sourceTagsJson: item.sourceTags,
      sourceMetaJson: {},
      ...overrides,
    } satisfies typeof importItems.$inferInsert;
  }

  private mapImportTaskRow(row: typeof importTasks.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      sourceType: row.sourceType,
      mode: row.mode,
      status: row.status,
      fileName: row.fileName ?? undefined,
      totalCount: row.totalCount,
      validCount: row.validCount,
      invalidCount: row.invalidCount,
      duplicateInFileCount: row.duplicateInFileCount,
      duplicateExistingCount: row.duplicateExistingCount,
      createdCount: row.createdCount,
      mergedCount: row.mergedCount,
      skippedCount: row.skippedCount,
      failedCount: row.failedCount,
      archiveQueuedCount: row.archiveQueuedCount,
      archiveSuccessCount: row.archiveSuccessCount,
      archiveFailedCount: row.archiveFailedCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
    } satisfies ImportTask;
  }

  private mapImportItemRow(row: typeof importItems.$inferSelect) {
    return {
      id: row.id,
      taskId: row.taskId,
      index: row.position,
      title: row.title,
      url: row.sourceUrl ?? undefined,
      domain: row.domain ?? undefined,
      folderPath: row.folderPath ?? undefined,
      status: row.status,
      dedupeResult: row.dedupeResult,
      reason: row.reason ?? undefined,
      bookmarkId: row.bookmarkId ?? undefined,
      archivedVersionId: row.archivedVersionId ?? undefined,
      hasArchive: row.hasArchive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies ImportTaskItem;
  }

  private mapApiTokenRow(
    row: {
      id: string;
      name: string;
      tokenPreview: string;
      scopesJson: unknown;
      lastUsedAt: Date | null;
      expiresAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    },
  ) {
    return {
      id: row.id,
      name: row.name,
      tokenPreview: row.tokenPreview,
      scopes: this.readApiTokenScopes(row.scopesJson),
      lastUsedAt: row.lastUsedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      revokedAt: row.revokedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    } satisfies ApiToken;
  }

  private mapBookmarkRow(
    row: {
      id: string;
      sourceUrl: string;
      canonicalUrl: string | null;
      title: string;
      domain: string;
      note: string;
      isFavorite: boolean;
      latestVersionId: string | null;
      createdAt: Date;
      updatedAt: Date;
      folderId: string | null;
      folderName: string | null;
      folderPath: string | null;
      folderParentId: string | null;
      latestQualityReport: unknown;
      latestSourceMeta: unknown;
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
      faviconUrl: this.readFaviconUrl(row.latestSourceMeta),
      coverImageUrl: this.readCoverImageUrl(row.latestSourceMeta),
      note: row.note,
      isFavorite: row.isFavorite,
      tags: options.tags,
      folder: row.folderId && row.folderName && row.folderPath
        ? {
            id: row.folderId,
            name: row.folderName,
            path: row.folderPath,
            parentId: row.folderParentId ?? null,
          }
        : undefined,
      latestVersionId: row.latestVersionId ?? undefined,
      versionCount: Math.max(0, options.versionCount || 0),
      latestQuality: maybeQuality,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private readCoverImageUrl(sourceMeta: unknown) {
    const source = this.readCaptureSource(sourceMeta);
    return source?.coverImageUrl;
  }

  private readFaviconUrl(sourceMeta: unknown) {
    const source = this.readCaptureSource(sourceMeta);
    return source?.faviconUrl;
  }

  private readCaptureSource(sourceMeta: unknown) {
    if (!sourceMeta || typeof sourceMeta !== "object") {
      return undefined;
    }

    const maybeSource = (sourceMeta as Record<string, unknown>).source;
    const parsed = captureSourceSchema.safeParse(maybeSource);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  }

  private readMediaFiles(sourceMeta: unknown): BookmarkVersion["mediaFiles"] {
    if (!sourceMeta || typeof sourceMeta !== "object") {
      return [];
    }

    const mediaFiles = (sourceMeta as Record<string, unknown>).mediaFiles;
    const parsed = bookmarkVersionMediaFileSchema.array().safeParse(mediaFiles ?? []);
    return parsed.success ? parsed.data : [];
  }

  private buildSourceMetaPayload(
    source: CaptureCompleteRequest["source"],
    mediaFiles?: CaptureCompleteRequest["mediaFiles"],
    existingSourceMeta?: unknown,
  ) {
    const existingMediaFiles = this.readMediaFiles(existingSourceMeta);
    return {
      source,
      mediaFiles: mergeBookmarkMediaFiles(existingMediaFiles, mediaFiles),
    };
  }

  private readApiTokenScopes(value: unknown) {
    return apiTokenScopeSchema.array().parse(value);
  }

  private readQuality(sourceMeta: unknown) {
    const parsed = qualityReportSchema.safeParse(sourceMeta);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  }

  private resolveIngestTitle(inputTitle: string | undefined, normalizedUrl: string) {
    const title = inputTitle?.trim();
    return title || normalizedUrl;
  }

  private async loadAllFolders(userId: string): Promise<Folder[]> {
    const rows = await this.db
      .select({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        parentId: folders.parentId,
      })
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(folders.path);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parentId,
    }));
  }

  private async loadFolderOrNull(userId: string, folderId: string): Promise<Folder | null> {
    const rows = await this.db
      .select({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        parentId: folders.parentId,
      })
      .from(folders)
      .where(and(eq(folders.userId, userId), eq(folders.id, folderId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parentId,
    };
  }

  private async loadFolderSubtreeIds(userId: string, folderId: string) {
    const allFolders = await this.loadAllFolders(userId);
    const current = allFolders.find((folder) => folder.id === folderId);
    if (!current) {
      return [];
    }
    return this.collectFolderSubtree(allFolders, current.path).map((folder) => folder.id);
  }

  private collectFolderSubtree(allFolders: Folder[], rootPath: string) {
    return allFolders
      .filter((folder) => folder.path === rootPath || folder.path.startsWith(`${rootPath}/`))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private buildFolderPath(parentPath: string | undefined, name: string) {
    return parentPath ? `${parentPath}/${name}` : name;
  }

  private assertUniqueFolderPath(allFolders: Folder[], nextPath: string, excludeFolderId?: string) {
    const conflict = allFolders.find((folder) => folder.path === nextPath && folder.id !== excludeFolderId);
    if (conflict) {
      throw new HttpError(409, "FolderPathConflict", "Folder path already exists.");
    }
  }

  private assertFolderPathSetAvailable(
    allFolders: Folder[],
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

    for (const folder of allFolders) {
      if (ignoredFolderIds.has(folder.id)) {
        continue;
      }
      if (seen.has(folder.path)) {
        throw new HttpError(409, "FolderPathConflict", "Folder path already exists.");
      }
    }
  }

  private assertUniqueTagName(allTags: Tag[], nextName: string, excludeTagId?: string) {
    const conflict = allTags.find((tag) => tag.name === nextName && tag.id !== excludeTagId);
    if (conflict) {
      throw new HttpError(409, "TagNameConflict", "Tag name already exists.");
    }
  }

  private async resolveTagIds(userId: string, tagIds: string[]) {
    const deduplicatedIds = [...new Set(tagIds)];
    if (deduplicatedIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        id: tags.id,
      })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, deduplicatedIds)));

    if (rows.length !== deduplicatedIds.length) {
      throw new HttpError(404, "TagNotFound", "Tag not found.");
    }

    return deduplicatedIds;
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

  private async persistReaderArchive(objectKey: string, readerHtml?: string) {
    const normalizedReaderHtml = readerHtml?.trim();
    if (!normalizedReaderHtml) {
      return null;
    }

    const readerObjectKey = this.createReaderObjectKey(objectKey);
    if (!(await this.objectStorage.hasObject(readerObjectKey))) {
      await this.objectStorage.putObject(
        readerObjectKey,
        Buffer.from(normalizedReaderHtml),
        {
          contentType: "text/html;charset=utf-8",
        },
      );
    }
    return readerObjectKey;
  }
}
