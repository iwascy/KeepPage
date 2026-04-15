import {
  importPreviewResponseSchema,
  importTaskDetailResponseSchema,
  importTaskListResponseSchema,
  type CloudArchiveRequest,
  type ImportExecutionOptions,
  type ImportSource,
} from "@keeppage/domain";
import { HttpError } from "../../lib/http-error";
import {
  buildImportPreview,
  createImportTaskName,
  parseImportContent,
  resolveImportOptions,
} from "../../lib/imports";
import type { ImportRepository } from "../../repositories";

export interface CloudArchiveSubmitter {
  submit(userId: string, input: CloudArchiveRequest): unknown;
}

type ImportServiceOptions = {
  repository: ImportRepository;
  cloudArchiveManager: CloudArchiveSubmitter | null;
};

export class ImportService {
  private readonly repository: ImportRepository;
  private readonly cloudArchiveManager: CloudArchiveSubmitter | null;

  constructor(options: ImportServiceOptions) {
    this.repository = options.repository;
    this.cloudArchiveManager = options.cloudArchiveManager;
  }

  async previewImport(userId: string, body: unknown) {
    const normalized = normalizeImportRequestBody(body);
    const items = parseImportSafely(normalized.sourceType, normalized.content);
    const matches = await this.repository.findImportBookmarkMatches(
      userId,
      items
        .map((item) => item.normalizedUrlHash)
        .filter((value): value is string => Boolean(value)),
    );
    return importPreviewResponseSchema.parse(buildImportPreview({
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      options: normalized.options,
      items,
      existingMatches: matches,
    }));
  }

  async createImportTask(userId: string, body: unknown) {
    const normalized = normalizeImportRequestBody(body);
    const items = parseImportSafely(normalized.sourceType, normalized.content);
    const matches = await this.repository.findImportBookmarkMatches(
      userId,
      items
        .map((item) => item.normalizedUrlHash)
        .filter((value): value is string => Boolean(value)),
    );
    const preview = buildImportPreview({
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      options: normalized.options,
      items,
      existingMatches: matches,
    });
    const taskName = normalized.taskName || createImportTaskName(normalized.sourceType, normalized.fileName);
    const detail = await this.repository.createImportTask(userId, {
      taskName,
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      options: normalized.options,
      preview,
      items,
    });

    if (this.cloudArchiveManager && normalized.options.mode !== "links_only") {
      for (const item of detail.items) {
        if (item.status === "created_bookmark" && item.url && item.bookmarkId) {
          this.cloudArchiveManager.submit(userId, { url: item.url });
        }
      }
    }

    return {
      taskId: detail.task.id,
      ...importTaskDetailResponseSchema.parse(detail),
    };
  }

  async listImportTasks(userId: string) {
    const tasks = await this.repository.listImportTasks(userId);
    return importTaskListResponseSchema.parse({ items: tasks });
  }

  async getImportTaskDetail(userId: string, taskId: string) {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new HttpError(400, "InvalidImportTaskId", "Import task id is required.");
    }

    const detail = await this.repository.getImportTaskDetail(userId, normalizedTaskId);
    if (!detail) {
      throw new HttpError(404, "ImportTaskNotFound", "Import task not found.");
    }

    return importTaskDetailResponseSchema.parse(detail);
  }
}

function parseImportSafely(sourceType: ImportSource, content: string) {
  try {
    return parseImportContent(sourceType, content);
  } catch (error) {
    throw new HttpError(
      400,
      "ImportSourceUnsupported",
      error instanceof Error ? error.message : "当前导入来源暂不支持。",
    );
  }
}

function normalizeImportRequestBody(body: unknown) {
  const record = asRecord(body);
  const fileName = asOptionalString(record.fileName);
  const sourceType = normalizeSourceType(record.sourceType, fileName);
  const content = asString(record.content) || asString(record.rawInput);
  if (!content.trim()) {
    throw new HttpError(400, "ImportContentRequired", "Import content is required.");
  }

  return {
    taskName: asOptionalString(record.taskName) || asOptionalString(record.name),
    sourceType,
    fileName,
    content,
    options: resolveImportOptions({
      mode: normalizeMode(readOption(record, "mode")),
      targetFolderMode: normalizeTargetFolderMode(readOption(record, "targetFolderMode")),
      targetFolderPath: asOptionalString(readOption(record, "targetFolderPath")),
      tagStrategy: normalizeTagStrategy(readOption(record, "tagStrategy")),
      titleStrategy: normalizeTitleStrategy(readOption(record, "titleStrategy")),
      dedupeStrategy: normalizeDedupeStrategy(readOption(record, "dedupeStrategy")),
    }),
  };
}

function readOption(record: Record<string, unknown>, key: string) {
  const options = asRecord(record.options);
  return options[key] ?? record[key];
}

function normalizeSourceType(value: unknown, fileName?: string): ImportSource {
  if (
    value === "bookmark_html"
    || value === "url_list"
    || value === "csv_file"
    || value === "text_file"
    || value === "markdown_file"
    || value === "browser_bookmarks"
  ) {
    return value;
  }
  if (value === "browser_html") {
    return "bookmark_html";
  }
  if (value === "csv_txt") {
    const lowered = fileName?.toLowerCase() ?? "";
    if (lowered.endsWith(".csv")) {
      return "csv_file";
    }
    if (lowered.endsWith(".md")) {
      return "markdown_file";
    }
    return "text_file";
  }
  if (value === "browser_extension") {
    return "browser_bookmarks";
  }
  return "url_list";
}

function normalizeMode(value: unknown): ImportExecutionOptions["mode"] {
  if (value === "links_only" || value === "queue_archive" || value === "start_archive") {
    return value;
  }
  if (value === "archive_now") {
    return "start_archive";
  }
  return "links_only";
}

function normalizeTargetFolderMode(value: unknown): ImportExecutionOptions["targetFolderMode"] {
  if (value === "preserve" || value === "specific" || value === "flatten") {
    return value;
  }
  if (value === "keep_source") {
    return "preserve";
  }
  if (value === "specific_folder") {
    return "specific";
  }
  return "preserve";
}

function normalizeTagStrategy(value: unknown): ImportExecutionOptions["tagStrategy"] {
  if (value === "keep_source_tags" || value === "none") {
    return value;
  }
  return "keep_source_tags";
}

function normalizeTitleStrategy(value: unknown): ImportExecutionOptions["titleStrategy"] {
  if (value === "prefer_import_title" || value === "prefer_page_title" || value === "update_later") {
    return value;
  }
  if (value === "prefer_input") {
    return "prefer_import_title";
  }
  if (value === "prefer_web") {
    return "prefer_page_title";
  }
  return "prefer_import_title";
}

function normalizeDedupeStrategy(value: unknown): ImportExecutionOptions["dedupeStrategy"] {
  if (value === "merge" || value === "skip" || value === "update_metadata") {
    return value;
  }
  if (value === "update_meta") {
    return "update_metadata";
  }
  return "merge";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
