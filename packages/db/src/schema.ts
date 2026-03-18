import {
  captureProfileValues,
  qualityGradeValues,
} from "@keeppage/domain";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const captureProfileEnum = pgEnum("capture_profile", captureProfileValues);
export const qualityGradeEnum = pgEnum("quality_grade", qualityGradeValues);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const devices = pgTable("devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 120 }).notNull(),
  platform: varchar("platform", { length: 40 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    path: text("path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    folderPathIdx: uniqueIndex("folders_user_path_idx").on(table.userId, table.path),
  }),
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url"),
    normalizedUrlHash: varchar("normalized_url_hash", { length: 128 }).notNull(),
    title: text("title").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    latestVersionId: uuid("latest_version_id"),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    note: text("note").default("").notNull(),
    isPinnedOffline: boolean("is_pinned_offline").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bookmarkUserUrlIdx: index("bookmarks_user_url_idx").on(table.userId, table.normalizedUrlHash),
    bookmarkLatestVersionIdx: index("bookmarks_latest_version_idx").on(table.latestVersionId),
  }),
);

export const captureUploads = pgTable(
  "capture_uploads",
  {
    objectKey: text("object_key").primaryKey(),
    normalizedUrlHash: varchar("normalized_url_hash", { length: 128 }).notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    htmlSha256: varchar("html_sha256", { length: 128 }).notNull(),
    fileSize: integer("file_size").notNull(),
    captureProfile: captureProfileEnum("capture_profile").notNull(),
    deviceId: varchar("device_id", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    captureUploadsHashIdx: index("capture_uploads_hash_idx").on(
      table.normalizedUrlHash,
      table.htmlSha256,
    ),
  }),
);

export const bookmarkVersions = pgTable(
  "bookmark_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookmarkId: uuid("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    htmlObjectKey: text("html_object_key").notNull(),
    htmlSha256: varchar("html_sha256", { length: 128 }).notNull(),
    textSha256: varchar("text_sha256", { length: 128 }),
    textSimhash: varchar("text_simhash", { length: 128 }),
    screenshotObjectKey: text("screenshot_object_key"),
    thumbnailObjectKey: text("thumbnail_object_key"),
    pdfObjectKey: text("pdf_object_key"),
    captureProfile: captureProfileEnum("capture_profile").notNull(),
    captureOptionsJson: jsonb("capture_options_json").default({}).notNull(),
    qualityScore: integer("quality_score").notNull(),
    qualityGrade: qualityGradeEnum("quality_grade").notNull(),
    qualityReasonsJson: jsonb("quality_reasons_json").default([]).notNull(),
    qualityReportJson: jsonb("quality_report_json").default({}).notNull(),
    sourceMetaJson: jsonb("source_meta_json").default({}).notNull(),
    extractedText: text("extracted_text"),
    createdByDeviceId: uuid("created_by_device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bookmarkVersionIdx: uniqueIndex("bookmark_versions_bookmark_version_idx").on(
      table.bookmarkId,
      table.versionNo,
    ),
    htmlShaIdx: index("bookmark_versions_html_sha_idx").on(table.htmlSha256),
    textShaIdx: index("bookmark_versions_text_sha_idx").on(table.textSha256),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tagUserNameIdx: uniqueIndex("tags_user_name_idx").on(table.userId, table.name),
  }),
);

export const bookmarkTags = pgTable(
  "bookmark_tags",
  {
    bookmarkId: uuid("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.bookmarkId, table.tagId] }),
  }),
);

export const syncOps = pgTable(
  "sync_ops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cursor: integer("cursor").generatedAlwaysAsIdentity().notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: varchar("operation", { length: 20 }).notNull(),
    payload: jsonb("payload").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    syncUserCursorIdx: uniqueIndex("sync_ops_user_cursor_idx").on(table.userId, table.cursor),
  }),
);
