import { z } from "zod";

export const importSourceValues = [
  "browser_bookmarks",
  "bookmark_html",
  "url_list",
  "csv_file",
  "text_file",
  "markdown_file",
] as const;

export const importModeValues = [
  "links_only",
  "queue_archive",
  "start_archive",
] as const;

export const importTaskStatusValues = [
  "draft",
  "parsing",
  "ready",
  "running",
  "paused",
  "completed",
  "partial_failed",
  "failed",
  "cancelled",
] as const;

export const importItemStatusValues = [
  "pending",
  "deduplicated",
  "created_bookmark",
  "queued_for_archive",
  "archiving",
  "archived",
  "skipped",
  "failed",
] as const;

export const importDedupeResultValues = [
  "none",
  "created_bookmark",
  "merged_existing",
  "skipped_existing",
  "skipped_duplicate",
  "invalid_input",
] as const;

export const importTargetFolderModeValues = [
  "preserve",
  "specific",
  "flatten",
] as const;

export const importTagStrategyValues = [
  "keep_source_tags",
  "none",
] as const;

export const importTitleStrategyValues = [
  "prefer_import_title",
  "prefer_page_title",
  "update_later",
] as const;

export const importDedupeStrategyValues = [
  "merge",
  "skip",
  "update_metadata",
] as const;

export const importSourceSchema = z.enum(importSourceValues);
export const importModeSchema = z.enum(importModeValues);
export const importTaskStatusSchema = z.enum(importTaskStatusValues);
export const importItemStatusSchema = z.enum(importItemStatusValues);
export const importDedupeResultSchema = z.enum(importDedupeResultValues);
export const importTargetFolderModeSchema = z.enum(importTargetFolderModeValues);
export const importTagStrategySchema = z.enum(importTagStrategyValues);
export const importTitleStrategySchema = z.enum(importTitleStrategyValues);
export const importDedupeStrategySchema = z.enum(importDedupeStrategyValues);

export const importExecutionOptionsSchema = z.object({
  mode: importModeSchema.default("links_only"),
  targetFolderMode: importTargetFolderModeSchema.default("preserve"),
  targetFolderPath: z.string().trim().min(1).max(500).optional(),
  tagStrategy: importTagStrategySchema.default("none"),
  titleStrategy: importTitleStrategySchema.default("prefer_import_title"),
  dedupeStrategy: importDedupeStrategySchema.default("merge"),
});

export const importPreviewRequestSchema = z.object({
  sourceType: importSourceSchema,
  content: z.string().min(1),
  fileName: z.string().trim().min(1).max(255).optional(),
  options: importExecutionOptionsSchema.optional(),
});

export const importTaskCreateRequestSchema = z.object({
  taskName: z.string().trim().min(1).max(160).optional(),
  sourceType: importSourceSchema,
  content: z.string().min(1),
  fileName: z.string().trim().min(1).max(255).optional(),
  options: importExecutionOptionsSchema.optional(),
});

export const importPreviewItemSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  url: z.string().optional(),
  domain: z.string().optional(),
  folderPath: z.string().optional(),
  sourceTags: z.array(z.string().min(1)).default([]),
  valid: z.boolean(),
  duplicateInFile: z.boolean().default(false),
  existingBookmarkId: z.string().min(1).optional(),
  existingHasArchive: z.boolean().default(false),
  reason: z.string().optional(),
});

export const importPreviewSummarySchema = z.object({
  totalCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateInFileCount: z.number().int().nonnegative(),
  duplicateExistingCount: z.number().int().nonnegative(),
  estimatedCreateCount: z.number().int().nonnegative(),
  estimatedMergeCount: z.number().int().nonnegative(),
  estimatedSkipCount: z.number().int().nonnegative(),
});

export const importPreviewDistributionSchema = z.object({
  value: z.string().min(1),
  count: z.number().int().positive(),
});

export const importPreviewResponseSchema = z.object({
  sourceType: importSourceSchema,
  fileName: z.string().optional(),
  summary: importPreviewSummarySchema,
  folders: z.array(importPreviewDistributionSchema),
  domains: z.array(importPreviewDistributionSchema),
  samples: z.array(importPreviewItemSchema),
});

export const importTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceType: importSourceSchema,
  mode: importModeSchema,
  status: importTaskStatusSchema,
  fileName: z.string().optional(),
  totalCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  duplicateInFileCount: z.number().int().nonnegative(),
  duplicateExistingCount: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  archiveQueuedCount: z.number().int().nonnegative(),
  archiveSuccessCount: z.number().int().nonnegative(),
  archiveFailedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const importTaskItemSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  url: z.string().optional(),
  domain: z.string().optional(),
  folderPath: z.string().optional(),
  status: importItemStatusSchema,
  dedupeResult: importDedupeResultSchema,
  reason: z.string().optional(),
  bookmarkId: z.string().min(1).optional(),
  archivedVersionId: z.string().min(1).optional(),
  hasArchive: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const importTaskListResponseSchema = z.object({
  items: z.array(importTaskSchema),
});

export const importTaskDetailResponseSchema = z.object({
  task: importTaskSchema,
  items: z.array(importTaskItemSchema),
});

export type ImportSource = z.infer<typeof importSourceSchema>;
export type ImportMode = z.infer<typeof importModeSchema>;
export type ImportTaskStatus = z.infer<typeof importTaskStatusSchema>;
export type ImportItemStatus = z.infer<typeof importItemStatusSchema>;
export type ImportDedupeResult = z.infer<typeof importDedupeResultSchema>;
export type ImportTargetFolderMode = z.infer<typeof importTargetFolderModeSchema>;
export type ImportTagStrategy = z.infer<typeof importTagStrategySchema>;
export type ImportTitleStrategy = z.infer<typeof importTitleStrategySchema>;
export type ImportDedupeStrategy = z.infer<typeof importDedupeStrategySchema>;
export type ImportExecutionOptions = z.infer<typeof importExecutionOptionsSchema>;
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;
export type ImportTaskCreateRequest = z.infer<typeof importTaskCreateRequestSchema>;
export type ImportPreviewItem = z.infer<typeof importPreviewItemSchema>;
export type ImportPreviewSummary = z.infer<typeof importPreviewSummarySchema>;
export type ImportPreviewDistribution = z.infer<typeof importPreviewDistributionSchema>;
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;
export type ImportTask = z.infer<typeof importTaskSchema>;
export type ImportTaskItem = z.infer<typeof importTaskItemSchema>;
export type ImportTaskListResponse = z.infer<typeof importTaskListResponseSchema>;
export type ImportTaskDetailResponse = z.infer<typeof importTaskDetailResponseSchema>;

export function createImportTaskId() {
  return `imp_${crypto.randomUUID()}`;
}

export function createImportTaskItemId() {
  return `imp_item_${crypto.randomUUID()}`;
}
