import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname, posix } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { z } from "zod";

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["", "0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OBJECT_STORAGE_ROOT: z.string().default("./data/object-storage"),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ENDPOINT_URL: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PREFIX: z.string().default(""),
  BACKUP_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  BACKUP_TIMEZONE: z.string().default("Asia/Shanghai"),
  BACKUP_WORK_DIR: z.string().optional(),
  BACKUP_INCLUDE_PRIVATE: booleanEnvSchema.default(true),
  BACKUP_ZSTD_LEVEL: z.coerce.number().int().min(1).max(19).default(10),
  BACKUP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  R2_FORCE_PATH_STYLE: booleanEnvSchema.default(true),
});

type BackupEnv = z.infer<typeof envSchema>;

type JsonRecord = Record<string, unknown>;

type UserExportRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

type BookmarkRow = {
  id: string;
  userId: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  normalizedUrlHash: string;
  title: string;
  domain: string;
  latestVersionId: string | null;
  folderId: string | null;
  note: string;
  isFavorite: boolean;
  isPinnedOffline?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type VersionRow = {
  id: string;
  bookmarkId: string;
  versionNo: number;
  htmlObjectKey: string;
  readerHtmlObjectKey: string | null;
  htmlSha256: string;
  textSha256: string | null;
  textSimhash: string | null;
  screenshotObjectKey?: string | null;
  thumbnailObjectKey?: string | null;
  pdfObjectKey?: string | null;
  captureProfile: string;
  captureOptionsJson: unknown;
  qualityScore: number;
  qualityGrade: string;
  qualityReasonsJson: unknown;
  qualityReportJson: unknown;
  sourceMetaJson: unknown;
  extractedText: string | null;
  createdByDeviceId: string | null;
  createdAt: Date;
};

type ObjectRef = {
  objectKey: string;
  source: string;
  bookmarkKind: "bookmark" | "private-bookmark";
  bookmarkId: string;
  versionId: string;
};

type ObjectManifestEntry = ObjectRef & {
  existsLocal: boolean;
  uploadedToR2: boolean;
  skippedRemote: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  r2Key: string;
  error?: string;
};

type BackupCounts = {
  users: number;
  folders: number;
  tags: number;
  bookmarks: number;
  privateBookmarks: number;
  versions: number;
  objectRefs: number;
  missingObjects: number;
  uploadedObjects: number;
  skippedObjects: number;
  failedObjectUploads: number;
};

async function main() {
  const startedAtDate = new Date();
  const config = readBackupEnv();
  const backupDate = config.BACKUP_DATE ?? formatDateInTimezone(startedAtDate, config.BACKUP_TIMEZONE);
  const runId = startedAtDate.toISOString().replaceAll(/[:.]/g, "-");
  const workDir = path.resolve(
    process.cwd(),
    config.BACKUP_WORK_DIR ?? path.join(os.tmpdir(), "keeppage-bookmark-backups", `${backupDate}-${runId}`),
  );
  await mkdir(workDir, { recursive: true });

  const paths = {
    bookmarksNdjson: path.join(workDir, "bookmarks.ndjson"),
    bookmarksZst: path.join(workDir, "bookmarks.ndjson.zst"),
    objectsNdjson: path.join(workDir, "objects-manifest.ndjson"),
    objectsZst: path.join(workDir, "objects-manifest.ndjson.zst"),
    manifest: path.join(workDir, "manifest.json"),
    restoreNotes: path.join(workDir, "restore-notes.md"),
  };

  const r2 = createR2Client(config);
  const r2Prefix = normalizeR2Prefix(config.R2_PREFIX);
  const exportPrefix = `${r2Prefix}bookmark-exports/${backupDate}/`;
  const objectMirrorPrefix = `${r2Prefix}object-mirror/`;
  const objectStorageRoot = path.resolve(process.cwd(), config.OBJECT_STORAGE_ROOT);
  const counts = createEmptyCounts();
  const objectRefs: ObjectRef[] = [];

  const client = new Client({
    connectionString: config.DATABASE_URL,
  });

  await client.connect();
  try {
    console.log(`Starting bookmark backup for ${backupDate}.`);
    await exportBookmarkData(client, paths.bookmarksNdjson, config, counts, objectRefs);
  } finally {
    await client.end();
  }

  await writeObjectManifest({
    config,
    counts,
    objectMirrorPrefix,
    objectRefs,
    objectStorageRoot,
    outputPath: paths.objectsNdjson,
    r2,
  });

  await compressWithZstd(paths.bookmarksNdjson, paths.bookmarksZst, config.BACKUP_ZSTD_LEVEL);
  await compressWithZstd(paths.objectsNdjson, paths.objectsZst, config.BACKUP_ZSTD_LEVEL);

  const checksums = {
    "bookmarks.ndjson.zst": `sha256:${await sha256File(paths.bookmarksZst)}`,
    "objects-manifest.ndjson.zst": `sha256:${await sha256File(paths.objectsZst)}`,
  };
  const status = counts.failedObjectUploads > 0 || counts.missingObjects > 0 ? "warning" : "success";
  const finishedAtDate = new Date();
  const manifest = {
    backupType: "bookmark-logical-export",
    backupDate,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    status,
    databaseUrlHost: readDatabaseUrlHost(config.DATABASE_URL),
    objectStorageRoot,
    r2Bucket: config.R2_BUCKET,
    r2Prefix: exportPrefix,
    objectMirrorPrefix,
    includePrivate: config.BACKUP_INCLUDE_PRIVATE,
    counts,
    checksums,
    workDir,
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeRestoreNotes(paths.restoreNotes, backupDate, exportPrefix, objectMirrorPrefix);

  await uploadFileToR2(r2, config.R2_BUCKET, `${exportPrefix}bookmarks.ndjson.zst`, paths.bookmarksZst, {
    contentType: "application/zstd",
    metadata: { sha256: checksums["bookmarks.ndjson.zst"].replace("sha256:", "") },
  });
  await uploadFileToR2(r2, config.R2_BUCKET, `${exportPrefix}objects-manifest.ndjson.zst`, paths.objectsZst, {
    contentType: "application/zstd",
    metadata: { sha256: checksums["objects-manifest.ndjson.zst"].replace("sha256:", "") },
  });
  await uploadFileToR2(r2, config.R2_BUCKET, `${exportPrefix}manifest.json`, paths.manifest, {
    contentType: "application/json",
  });
  await uploadFileToR2(r2, config.R2_BUCKET, `${exportPrefix}restore-notes.md`, paths.restoreNotes, {
    contentType: "text/markdown; charset=utf-8",
  });

  console.log(
    JSON.stringify(
      {
        message: "Bookmark backup completed.",
        backupDate,
        status,
        counts,
        r2Prefix: exportPrefix,
        workDir,
      },
      null,
      2,
    ),
  );
}

function readBackupEnv(): BackupEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid backup environment.");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  if (!parsed.data.R2_ENDPOINT_URL && !parsed.data.R2_ACCOUNT_ID) {
    console.error("R2_ACCOUNT_ID is required unless R2_ENDPOINT_URL is set.");
    process.exit(1);
  }
  return parsed.data;
}

function createR2Client(config: BackupEnv) {
  return new S3Client({
    region: "auto",
    endpoint: config.R2_ENDPOINT_URL ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: config.R2_FORCE_PATH_STYLE,
  });
}

function createEmptyCounts(): BackupCounts {
  return {
    users: 0,
    folders: 0,
    tags: 0,
    bookmarks: 0,
    privateBookmarks: 0,
    versions: 0,
    objectRefs: 0,
    missingObjects: 0,
    uploadedObjects: 0,
    skippedObjects: 0,
    failedObjectUploads: 0,
  };
}

async function exportBookmarkData(
  client: Client,
  outputPath: string,
  config: BackupEnv,
  counts: BackupCounts,
  objectRefs: ObjectRef[],
) {
  await mkdir(dirname(outputPath), { recursive: true });
  const output = createWriteStream(outputPath, { encoding: "utf8" });
  try {
    const users = await client.query<UserExportRow>(`
      select
        id::text as "id",
        email as "email",
        name as "name",
        created_at as "createdAt"
      from users
      order by email, id
    `);
    const usersById = new Map(users.rows.map((user) => [user.id, user]));
    counts.users = users.rowCount ?? 0;
    for (const user of users.rows) {
      writeJsonLine(output, {
        kind: "user",
        user,
      });
    }

    const folders = await client.query<JsonRecord>(`
      select
        id::text as "id",
        user_id::text as "userId",
        name,
        path,
        parent_id::text as "parentId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from folders
      order by user_id, path, id
    `);
    counts.folders = folders.rowCount ?? 0;
    for (const folder of folders.rows) {
      writeJsonLine(output, {
        kind: "folder",
        folder,
      });
    }

    const tags = await client.query<JsonRecord>(`
      select
        id::text as "id",
        user_id::text as "userId",
        name,
        color,
        created_at as "createdAt"
      from tags
      order by user_id, name, id
    `);
    counts.tags = tags.rowCount ?? 0;
    for (const tag of tags.rows) {
      writeJsonLine(output, {
        kind: "tag",
        tag,
      });
    }

    await exportRegularBookmarks(client, output, usersById, config.BACKUP_BATCH_SIZE, counts, objectRefs);
    if (config.BACKUP_INCLUDE_PRIVATE) {
      await exportPrivateBookmarks(client, output, usersById, config.BACKUP_BATCH_SIZE, counts, objectRefs);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      output.end((error: Error | null | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function exportRegularBookmarks(
  client: Client,
  output: NodeJS.WritableStream,
  usersById: Map<string, UserExportRow>,
  batchSize: number,
  counts: BackupCounts,
  objectRefs: ObjectRef[],
) {
  for (let offset = 0; ; offset += batchSize) {
    const bookmarks = await queryRegularBookmarkBatch(client, offset, batchSize);
    if (bookmarks.length === 0) {
      break;
    }

    const bookmarkIds = bookmarks.map((bookmark) => bookmark.id);
    const versionsByBookmark = groupByBookmarkId(await queryRegularVersions(client, bookmarkIds));
    const tagsByBookmark = await queryBookmarkTags(client, bookmarkIds);

    counts.bookmarks += bookmarks.length;
    for (const bookmark of bookmarks) {
      const versions = versionsByBookmark.get(bookmark.id) ?? [];
      counts.versions += versions.length;
      for (const version of versions) {
        collectObjectRefs(objectRefs, "bookmark", bookmark.id, version);
      }
      writeJsonLine(output, {
        kind: "bookmark",
        user: usersById.get(bookmark.userId) ?? null,
        bookmark,
        tags: tagsByBookmark.get(bookmark.id) ?? [],
        versions,
      });
    }
  }
}

async function exportPrivateBookmarks(
  client: Client,
  output: NodeJS.WritableStream,
  usersById: Map<string, UserExportRow>,
  batchSize: number,
  counts: BackupCounts,
  objectRefs: ObjectRef[],
) {
  for (let offset = 0; ; offset += batchSize) {
    const bookmarks = await queryPrivateBookmarkBatch(client, offset, batchSize);
    if (bookmarks.length === 0) {
      break;
    }

    const bookmarkIds = bookmarks.map((bookmark) => bookmark.id);
    const versionsByBookmark = groupByBookmarkId(await queryPrivateVersions(client, bookmarkIds));

    counts.privateBookmarks += bookmarks.length;
    for (const bookmark of bookmarks) {
      const versions = versionsByBookmark.get(bookmark.id) ?? [];
      counts.versions += versions.length;
      for (const version of versions) {
        collectObjectRefs(objectRefs, "private-bookmark", bookmark.id, version);
      }
      writeJsonLine(output, {
        kind: "private-bookmark",
        user: usersById.get(bookmark.userId) ?? null,
        bookmark,
        versions,
      });
    }
  }
}

async function queryRegularBookmarkBatch(client: Client, offset: number, limit: number) {
  const result = await client.query<BookmarkRow>(
    `
      select
        id::text as "id",
        user_id::text as "userId",
        source_url as "sourceUrl",
        canonical_url as "canonicalUrl",
        normalized_url_hash as "normalizedUrlHash",
        title,
        domain,
        latest_version_id::text as "latestVersionId",
        folder_id::text as "folderId",
        note,
        is_favorite as "isFavorite",
        is_pinned_offline as "isPinnedOffline",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from bookmarks
      order by user_id, created_at, id
      limit $1 offset $2
    `,
    [limit, offset],
  );
  return result.rows;
}

async function queryPrivateBookmarkBatch(client: Client, offset: number, limit: number) {
  const result = await client.query<BookmarkRow>(
    `
      select
        id::text as "id",
        user_id::text as "userId",
        source_url as "sourceUrl",
        canonical_url as "canonicalUrl",
        normalized_url_hash as "normalizedUrlHash",
        title,
        domain,
        latest_version_id::text as "latestVersionId",
        null::text as "folderId",
        note,
        is_favorite as "isFavorite",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from private_bookmarks
      order by user_id, created_at, id
      limit $1 offset $2
    `,
    [limit, offset],
  );
  return result.rows;
}

async function queryRegularVersions(client: Client, bookmarkIds: string[]) {
  if (bookmarkIds.length === 0) {
    return [];
  }
  const result = await client.query<VersionRow>(`
    select
      id::text as "id",
      bookmark_id::text as "bookmarkId",
      version_no as "versionNo",
      html_object_key as "htmlObjectKey",
      reader_html_object_key as "readerHtmlObjectKey",
      html_sha256 as "htmlSha256",
      text_sha256 as "textSha256",
      text_simhash as "textSimhash",
      screenshot_object_key as "screenshotObjectKey",
      thumbnail_object_key as "thumbnailObjectKey",
      pdf_object_key as "pdfObjectKey",
      capture_profile as "captureProfile",
      capture_options_json as "captureOptionsJson",
      quality_score as "qualityScore",
      quality_grade as "qualityGrade",
      quality_reasons_json as "qualityReasonsJson",
      quality_report_json as "qualityReportJson",
      source_meta_json as "sourceMetaJson",
      extracted_text as "extractedText",
      created_by_device_id::text as "createdByDeviceId",
      created_at as "createdAt"
    from bookmark_versions
    where bookmark_id = any($1::uuid[])
    order by bookmark_id, version_no, id
  `, [bookmarkIds]);
  return result.rows;
}

async function queryPrivateVersions(client: Client, bookmarkIds: string[]) {
  if (bookmarkIds.length === 0) {
    return [];
  }
  const result = await client.query<VersionRow>(`
    select
      id::text as "id",
      bookmark_id::text as "bookmarkId",
      version_no as "versionNo",
      html_object_key as "htmlObjectKey",
      reader_html_object_key as "readerHtmlObjectKey",
      html_sha256 as "htmlSha256",
      text_sha256 as "textSha256",
      text_simhash as "textSimhash",
      null::text as "screenshotObjectKey",
      null::text as "thumbnailObjectKey",
      null::text as "pdfObjectKey",
      capture_profile as "captureProfile",
      capture_options_json as "captureOptionsJson",
      quality_score as "qualityScore",
      quality_grade as "qualityGrade",
      quality_reasons_json as "qualityReasonsJson",
      quality_report_json as "qualityReportJson",
      source_meta_json as "sourceMetaJson",
      extracted_text as "extractedText",
      created_by_device_id::text as "createdByDeviceId",
      created_at as "createdAt"
    from private_bookmark_versions
    where bookmark_id = any($1::uuid[])
    order by bookmark_id, version_no, id
  `, [bookmarkIds]);
  return result.rows;
}

async function queryBookmarkTags(client: Client, bookmarkIds: string[]) {
  if (bookmarkIds.length === 0) {
    return new Map<string, JsonRecord[]>();
  }
  const result = await client.query<{
    bookmarkId: string;
    tag: JsonRecord;
    createdAt: Date;
  }>(`
    select
      bt.bookmark_id::text as "bookmarkId",
      jsonb_build_object(
        'id', t.id::text,
        'userId', t.user_id::text,
        'name', t.name,
        'color', t.color,
        'createdAt', t.created_at
      ) as tag,
      bt.created_at as "createdAt"
    from bookmark_tags bt
    join tags t on t.id = bt.tag_id
    where bt.bookmark_id = any($1::uuid[])
    order by bt.bookmark_id, t.name, t.id
  `, [bookmarkIds]);
  const tagsByBookmark = new Map<string, JsonRecord[]>();
  for (const row of result.rows) {
    const tags = tagsByBookmark.get(row.bookmarkId) ?? [];
    tags.push({
      ...row.tag,
      relationCreatedAt: row.createdAt,
    });
    tagsByBookmark.set(row.bookmarkId, tags);
  }
  return tagsByBookmark;
}

function groupByBookmarkId(versions: VersionRow[]) {
  const versionsByBookmark = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const bookmarkVersions = versionsByBookmark.get(version.bookmarkId) ?? [];
    bookmarkVersions.push(version);
    versionsByBookmark.set(version.bookmarkId, bookmarkVersions);
  }
  return versionsByBookmark;
}

function collectObjectRefs(
  refs: ObjectRef[],
  bookmarkKind: ObjectRef["bookmarkKind"],
  bookmarkId: string,
  version: VersionRow,
) {
  addObjectRef(refs, version.htmlObjectKey, "htmlObjectKey", bookmarkKind, bookmarkId, version.id);
  addObjectRef(refs, version.readerHtmlObjectKey, "readerHtmlObjectKey", bookmarkKind, bookmarkId, version.id);
  addObjectRef(refs, version.screenshotObjectKey, "screenshotObjectKey", bookmarkKind, bookmarkId, version.id);
  addObjectRef(refs, version.thumbnailObjectKey, "thumbnailObjectKey", bookmarkKind, bookmarkId, version.id);
  addObjectRef(refs, version.pdfObjectKey, "pdfObjectKey", bookmarkKind, bookmarkId, version.id);

  for (const mediaFile of readMediaFiles(version.sourceMetaJson)) {
    addObjectRef(refs, mediaFile.objectKey, "sourceMetaJson.mediaFiles.objectKey", bookmarkKind, bookmarkId, version.id);
  }
}

function addObjectRef(
  refs: ObjectRef[],
  objectKey: string | null | undefined,
  source: string,
  bookmarkKind: ObjectRef["bookmarkKind"],
  bookmarkId: string,
  versionId: string,
) {
  if (!objectKey) {
    return;
  }
  refs.push({
    objectKey,
    source,
    bookmarkKind,
    bookmarkId,
    versionId,
  });
}

function readMediaFiles(sourceMetaJson: unknown): Array<{ objectKey?: string }> {
  if (!sourceMetaJson || typeof sourceMetaJson !== "object") {
    return [];
  }
  const mediaFiles = (sourceMetaJson as Record<string, unknown>).mediaFiles;
  if (!Array.isArray(mediaFiles)) {
    return [];
  }
  return mediaFiles.filter((mediaFile): mediaFile is { objectKey: string } => {
    return (
      Boolean(mediaFile && typeof mediaFile === "object") &&
      typeof (mediaFile as Record<string, unknown>).objectKey === "string" &&
      (mediaFile as Record<string, unknown>).objectKey !== ""
    );
  });
}

async function writeObjectManifest(input: {
  config: BackupEnv;
  counts: BackupCounts;
  objectMirrorPrefix: string;
  objectRefs: ObjectRef[];
  objectStorageRoot: string;
  outputPath: string;
  r2: S3Client;
}) {
  await mkdir(dirname(input.outputPath), { recursive: true });
  const output = createWriteStream(input.outputPath, { encoding: "utf8" });
  const uploadedByObjectKey = new Map<string, ObjectManifestEntry>();
  input.counts.objectRefs = input.objectRefs.length;

  try {
    for (const ref of input.objectRefs) {
      const r2Key = `${input.objectMirrorPrefix}${ref.objectKey}`;
      const previous = uploadedByObjectKey.get(ref.objectKey);
      if (previous) {
        writeJsonLine(output, {
          ...ref,
          existsLocal: previous.existsLocal,
          uploadedToR2: false,
          skippedRemote: true,
          sizeBytes: previous.sizeBytes,
          sha256: previous.sha256,
          r2Key,
          error: previous.error,
        });
        continue;
      }

      const entry = await uploadObjectRef({
        bucket: input.config.R2_BUCKET,
        objectMirrorPrefix: input.objectMirrorPrefix,
        objectStorageRoot: input.objectStorageRoot,
        ref,
        r2: input.r2,
      });
      uploadedByObjectKey.set(ref.objectKey, entry);
      if (!entry.existsLocal) {
        input.counts.missingObjects += 1;
      } else if (entry.uploadedToR2) {
        input.counts.uploadedObjects += 1;
      } else if (entry.skippedRemote) {
        input.counts.skippedObjects += 1;
      }
      if (entry.existsLocal && entry.error) {
        input.counts.failedObjectUploads += 1;
      }
      writeJsonLine(output, entry);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      output.end((error: Error | null | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function uploadObjectRef(input: {
  bucket: string;
  objectMirrorPrefix: string;
  objectStorageRoot: string;
  ref: ObjectRef;
  r2: S3Client;
}): Promise<ObjectManifestEntry> {
  const r2Key = `${input.objectMirrorPrefix}${input.ref.objectKey}`;
  let localPath: string;
  try {
    localPath = resolveObjectPath(input.objectStorageRoot, input.ref.objectKey);
  } catch (error) {
    return {
      ...input.ref,
      existsLocal: false,
      uploadedToR2: false,
      skippedRemote: false,
      sizeBytes: null,
      sha256: null,
      r2Key,
      error: error instanceof Error ? error.message : "Invalid object key.",
    };
  }

  const localStat = await stat(localPath).catch(() => null);
  if (!localStat?.isFile()) {
    return {
      ...input.ref,
      existsLocal: false,
      uploadedToR2: false,
      skippedRemote: false,
      sizeBytes: null,
      sha256: null,
      r2Key,
      error: "Local object is missing.",
    };
  }

  const sha256 = await sha256File(localPath);
  const remote = await readRemoteObjectState(input.r2, input.bucket, r2Key);
  if (remote?.size === localStat.size && remote.sha256 === sha256) {
    return {
      ...input.ref,
      existsLocal: true,
      uploadedToR2: false,
      skippedRemote: true,
      sizeBytes: localStat.size,
      sha256,
      r2Key,
    };
  }

  try {
    await uploadFileToR2(input.r2, input.bucket, r2Key, localPath, {
      contentType: guessContentType(input.ref.objectKey),
      metadata: { sha256 },
    });
    return {
      ...input.ref,
      existsLocal: true,
      uploadedToR2: true,
      skippedRemote: false,
      sizeBytes: localStat.size,
      sha256,
      r2Key,
    };
  } catch (error) {
    return {
      ...input.ref,
      existsLocal: true,
      uploadedToR2: false,
      skippedRemote: false,
      sizeBytes: localStat.size,
      sha256,
      r2Key,
      error: error instanceof Error ? error.message : "R2 upload failed.",
    };
  }
}

async function readRemoteObjectState(r2: S3Client, bucket: string, key: string) {
  try {
    const response = await r2.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return {
      size: response.ContentLength ?? null,
      sha256: response.Metadata?.sha256 ?? null,
    };
  } catch {
    return null;
  }
}

async function uploadFileToR2(
  r2: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  options: Pick<PutObjectCommandInput, "ContentType" | "Metadata"> & {
    contentType?: string;
    metadata?: Record<string, string>;
  } = {},
) {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: options.contentType ?? options.ContentType,
      Metadata: options.metadata ?? options.Metadata,
    }),
  );
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function compressWithZstd(inputPath: string, outputPath: string, level: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("zstd", ["-q", "-f", `-${level}`, "-T0", "-o", outputPath, inputPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to run zstd. Install zstd on the backup host or set up the job image with zstd. ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`zstd exited with code ${code}. ${stderr.trim()}`));
    });
  });
}

function resolveObjectPath(rootDir: string, objectKey: string) {
  if (!objectKey || objectKey.includes("\0")) {
    throw new Error("Invalid object key.");
  }
  const normalized = posix.normalize(objectKey.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new Error("Invalid object key path.");
  }

  const resolved = path.resolve(rootDir, ...normalized.split("/"));
  const prefix = `${rootDir}${path.sep}`;
  if (resolved !== rootDir && !resolved.startsWith(prefix)) {
    throw new Error("Object key resolved outside storage root.");
  }
  return resolved;
}

function writeJsonLine(output: NodeJS.WritableStream, value: unknown) {
  output.write(`${JSON.stringify(value)}\n`);
}

function normalizeR2Prefix(prefix: string) {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

function formatDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function readDatabaseUrlHost(databaseUrl: string) {
  try {
    return new URL(databaseUrl).host;
  } catch {
    return "unknown";
  }
}

function guessContentType(objectKey: string) {
  const extension = path.extname(objectKey).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
}

async function writeRestoreNotes(
  outputPath: string,
  backupDate: string,
  exportPrefix: string,
  objectMirrorPrefix: string,
) {
  await writeFile(
    outputPath,
    `# KeepPage 书签备份恢复说明

- 备份日期：${backupDate}
- 导出目录：${exportPrefix}
- 对象镜像目录：${objectMirrorPrefix}

恢复时先下载 \`manifest.json\` 并确认 \`status\`。如果状态为 \`warning\`，先检查 \`objects-manifest.ndjson.zst\` 中缺失或上传失败的对象。

逻辑恢复顺序建议：

1. 解压 \`bookmarks.ndjson.zst\` 和 \`objects-manifest.ndjson.zst\`
2. 将 \`${objectMirrorPrefix}<objectKey>\` 恢复到 \`${"${OBJECT_STORAGE_ROOT}"}/<objectKey>\`
3. 按用户、文件夹、标签、普通书签、普通版本、私密书签、私密版本的顺序导入数据库
4. 导入完成后校验列表页、详情页和归档 HTML 读取流程
`,
  );
}

main().catch((error) => {
  console.error("Bookmark backup failed.");
  console.error(error);
  process.exit(1);
});
