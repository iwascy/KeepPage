import {
  importPreviewResponseSchema,
  importTaskDetailResponseSchema,
  importTaskListResponseSchema,
  type ImportSource,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../lib/auth-service";
import type { CloudArchiveManager } from "../lib/cloud-archive-manager";
import { HttpError } from "../lib/http-error";
import {
  buildImportPreview,
  createImportTaskName,
  parseImportContent,
  resolveImportOptions,
} from "../lib/imports";
import type { BookmarkRepository } from "../repositories";

export async function registerImportRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: BookmarkRepository,
  cloudArchiveManager: CloudArchiveManager | null,
) {
  app.post("/imports/preview", async (request, reply) => {
    const user = await authService.requireUser(request);
    const normalized = normalizeImportRequestBody(request.body);
    const items = parseImportSafely(normalized.sourceType, normalized.content);
    const matches = await repository.findImportBookmarkMatches(
      user.id,
      items
        .map((item) => item.normalizedUrlHash)
        .filter((value): value is string => Boolean(value)),
    );
    const response = buildImportPreview({
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      options: normalized.options,
      items,
      existingMatches: matches,
    });
    return reply.send(importPreviewResponseSchema.parse(response));
  });

  app.post("/imports", async (request, reply) => {
    const user = await authService.requireUser(request);
    const normalized = normalizeImportRequestBody(request.body);
    const items = parseImportSafely(normalized.sourceType, normalized.content);
    const matches = await repository.findImportBookmarkMatches(
      user.id,
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
    const detail = await repository.createImportTask(user.id, {
      taskName,
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      options: normalized.options,
      preview,
      items,
    });

    if (
      cloudArchiveManager &&
      normalized.options.mode !== "links_only"
    ) {
      for (const item of detail.items) {
        if (
          item.status === "created_bookmark" &&
          item.url &&
          item.bookmarkId
        ) {
          cloudArchiveManager.submit(user.id, { url: item.url });
        }
      }
    }

    return reply.send({
      taskId: detail.task.id,
      ...importTaskDetailResponseSchema.parse(detail),
    });
  });

  app.get("/imports", async (request, reply) => {
    const user = await authService.requireUser(request);
    const tasks = await repository.listImportTasks(user.id);
    return reply.send(importTaskListResponseSchema.parse({ items: tasks }));
  });

  app.get<{ Params: { taskId: string } }>("/imports/:taskId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const taskId = request.params.taskId?.trim();
    if (!taskId) {
      throw new HttpError(400, "InvalidImportTaskId", "Import task id is required.");
    }

    const detail = await repository.getImportTaskDetail(user.id, taskId);
    if (!detail) {
      return reply.status(404).send({
        error: "ImportTaskNotFound",
        message: "Import task not found.",
      });
    }

    return reply.send(importTaskDetailResponseSchema.parse(detail));
  });
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
  if (value === "bookmark_html" || value === "url_list" || value === "csv_file" || value === "text_file" || value === "markdown_file" || value === "browser_bookmarks") {
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

function normalizeMode(value: unknown) {
  if (value === "links_only" || value === "queue_archive" || value === "start_archive") {
    return value;
  }
  if (value === "archive_now") {
    return "start_archive";
  }
  return "links_only";
}

function normalizeTargetFolderMode(value: unknown) {
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

function normalizeTagStrategy(value: unknown) {
  if (value === "keep_source_tags" || value === "none") {
    return value;
  }
  return "keep_source_tags";
}

function normalizeTitleStrategy(value: unknown) {
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

function normalizeDedupeStrategy(value: unknown) {
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
