import {
  apiTokenCreateRequestSchema,
  apiTokenCreateResponseSchema,
  apiTokenListResponseSchema,
  authSessionSchema,
  authUserSchema,
  bookmarkDetailResponseSchema,
  bookmarkListViewSchema,
  bookmarkMetadataUpdateRequestSchema,
  bookmarkSidebarStatsResponseSchema,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  cloudArchiveResponseSchema,
  cloudArchiveTaskSchema,
  ensureArchiveBaseHref,
  folderListResponseSchema,
  folderSchema,
  privateBookmarkDetailResponseSchema,
  privateBookmarkSearchResponseSchema,
  privateModeSetupRequestSchema,
  privateModeUnlockRequestSchema,
  privateModeUnlockResponseSchema,
  privateVaultSummarySchema,
  tagListResponseSchema,
  tagSchema,
  type ApiToken,
  type ApiTokenCreateRequest,
  type ApiTokenCreateResponse,
  type AuthLoginRequest,
  type AuthRegisterRequest,
  type AuthSession,
  type AuthUser,
  type Bookmark,
  type BookmarkListView,
  type BookmarkMetadataUpdateRequest,
  type BookmarkDetailVersion,
  type CloudArchiveRequest,
  type CloudArchiveResponse,
  type CloudArchiveTask,
  type Folder,
  type FolderCreateRequest,
  type FolderUpdateRequest,
  type QualityGrade,
  type PrivateModeUnlockResponse,
  type PrivateVaultSummary,
  type Tag,
  type TagCreateRequest,
  type TagUpdateRequest,
  workspaceBootstrapResponseSchema,
  type WorkspaceBootstrapResponse,
} from "@keeppage/domain";
import type { ZodType } from "zod";

type DataSource = "api";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type BookmarkQuery = {
  search: string;
  quality: "all" | QualityGrade;
  view: BookmarkListView;
  folderId?: string;
  tagId?: string;
  limit?: number;
  offset?: number;
};

export type BookmarkResult = {
  items: Bookmark[];
  total: number;
  source: DataSource;
};

export type WorkspaceBootstrapResult = WorkspaceBootstrapResponse;

export type BookmarkViewerVersion = BookmarkDetailVersion & {
  readerHtmlObjectKey?: string;
  readerArchiveAvailable?: boolean;
  readerArchiveSizeBytes?: number;
};

export type BookmarkDetailResult = {
  bookmark: Bookmark;
  versions: BookmarkViewerVersion[];
  source: DataSource;
};

export type ImportSourceType = "browser_html" | "url_list" | "csv_txt" | "browser_extension";
export type ImportMode = "links_only" | "queue_archive" | "archive_now";
export type ImportTaskStatus =
  | "draft"
  | "parsing"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";
export type ImportItemStatus =
  | "pending"
  | "deduplicated"
  | "created_bookmark"
  | "queued_for_archive"
  | "archiving"
  | "archived"
  | "skipped"
  | "failed";
export type ImportDedupeResult =
  | "created"
  | "merged"
  | "skipped"
  | "duplicate_in_file"
  | "invalid"
  | "created_bookmark"
  | "merged_existing"
  | "skipped_existing"
  | "skipped_duplicate"
  | "invalid_input";

export type ImportPreviewRequest = {
  sourceType: ImportSourceType;
  rawInput: string;
  fileName?: string;
  mode: ImportMode;
  dedupeStrategy: "merge" | "skip" | "update_meta";
  titleStrategy: "prefer_input" | "prefer_web" | "update_later";
  targetFolderMode: "keep_source" | "specific_folder" | "flatten";
  targetFolderPath?: string;
};

export type ImportPreviewStats = {
  totalCount?: number;
  rawTotal?: number;
  validCount: number;
  invalidCount: number;
  duplicateInFileCount: number;
  duplicateExistingCount?: number;
  duplicateInLibraryCount?: number;
  estimatedCreateCount?: number;
  willCreateCount?: number;
  estimatedMergeCount?: number;
  willMergeCount?: number;
  estimatedSkipCount?: number;
  willSkipCount?: number;
};

export type ImportPreviewItem = {
  id: string;
  title: string;
  url: string;
  domain: string;
  folderPath?: string;
  sourceTags?: string[];
  status: "valid" | "invalid" | "duplicate_in_file" | "duplicate_in_library";
  reason?: string;
  existingBookmarkId?: string;
  existingHasArchive?: boolean;
};

export type ImportPreviewResult = {
  source: DataSource;
  sourceType: ImportSourceType;
  stats: ImportPreviewStats;
  samples: ImportPreviewItem[];
  folders: Array<{ path: string; count: number }>;
  domains: Array<{ domain: string; count: number }>;
};

export type ImportTaskSummary = {
  id: string;
  name: string;
  status: ImportTaskStatus;
  sourceType: ImportSourceType;
  mode: ImportMode;
  totalCount: number;
  createdCount?: number;
  successCount?: number;
  mergedCount: number;
  skippedCount: number;
  failedCount: number;
  archiveSuccessCount: number;
  archiveFailedCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ImportTaskItem = {
  id: string;
  title: string;
  url: string;
  domain: string;
  folderPath?: string;
  sourceFolderPath?: string;
  status: ImportItemStatus;
  dedupeResult?: ImportDedupeResult;
  bookmarkId?: string;
  hasArchive?: boolean;
  reason?: string;
  errorReason?: string;
};

export type ImportTaskDetailResult = {
  source: DataSource;
  task: ImportTaskSummary;
  items: ImportTaskItem[];
};

export type ApiTokenItem = ApiToken;

type RequestOptions = {
  method?: string;
  token?: string;
  privateToken?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function resolveApiBase() {
  return (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

async function request(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.privateToken) {
    headers["x-keeppage-private-token"] = options.privateToken;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new ApiError(response.status, errorPayload.message, errorPayload.details);
  }

  return response;
}

async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
) {
  const response = await request(path, options);
  const payload = await response.json();
  return schema.parse(payload);
}

async function requestVoid(path: string, options: RequestOptions = {}) {
  await request(path, options);
}

async function readErrorPayload(response: Response) {
  try {
    const payload = await response.json() as {
      message?: string;
      details?: unknown;
    };
    return {
      message: payload.message ?? `API ${response.status}`,
      details: payload.details,
    };
  } catch {
    const text = await response.text();
    return {
      message: text || `API ${response.status}`,
      details: undefined,
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toImportSourceType(value: unknown): ImportSourceType {
  if (value === "browser_html" || value === "url_list" || value === "csv_txt" || value === "browser_extension") {
    return value;
  }
  if (value === "bookmark_html") {
    return "browser_html";
  }
  if (value === "csv_file" || value === "text_file" || value === "markdown_file") {
    return "csv_txt";
  }
  if (value === "browser_bookmarks") {
    return "browser_extension";
  }
  return "url_list";
}

function toImportMode(value: unknown): ImportMode {
  if (value === "links_only" || value === "queue_archive" || value === "archive_now") {
    return value;
  }
  if (value === "start_archive") {
    return "archive_now";
  }
  return "links_only";
}

function toImportTaskStatus(value: unknown): ImportTaskStatus {
  const valid: ImportTaskStatus[] = [
    "draft",
    "parsing",
    "ready",
    "running",
    "paused",
    "completed",
    "partial_failed",
    "failed",
    "cancelled",
  ];
  return valid.includes(value as ImportTaskStatus) ? (value as ImportTaskStatus) : "draft";
}

function toImportItemStatus(value: unknown): ImportItemStatus {
  const valid: ImportItemStatus[] = [
    "pending",
    "deduplicated",
    "created_bookmark",
    "queued_for_archive",
    "archiving",
    "archived",
    "skipped",
    "failed",
  ];
  return valid.includes(value as ImportItemStatus) ? (value as ImportItemStatus) : "pending";
}

function toImportDedupeResult(value: unknown): ImportDedupeResult | undefined {
  const valid: ImportDedupeResult[] = [
    "created",
    "merged",
    "skipped",
    "duplicate_in_file",
    "invalid",
    "created_bookmark",
    "merged_existing",
    "skipped_existing",
    "skipped_duplicate",
    "invalid_input",
  ];
  return valid.includes(value as ImportDedupeResult) ? (value as ImportDedupeResult) : undefined;
}

function toImportSummary(value: unknown): ImportTaskSummary {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name, "未命名导入"),
    status: toImportTaskStatus(row.status),
    sourceType: toImportSourceType(row.sourceType),
    mode: toImportMode(row.mode),
    totalCount: asNumber(row.totalCount),
    createdCount: asNumber(row.createdCount),
    successCount: asNumber(row.successCount),
    mergedCount: asNumber(row.mergedCount),
    skippedCount: asNumber(row.skippedCount),
    failedCount: asNumber(row.failedCount),
    archiveSuccessCount: asNumber(row.archiveSuccessCount),
    archiveFailedCount: asNumber(row.archiveFailedCount),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt || row.createdAt),
  };
}

function toImportItem(value: unknown): ImportTaskItem {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    title: asString(row.title, "(无标题)"),
    url: asString(row.url),
    domain: asString(row.domain),
    folderPath: asString(row.folderPath) || undefined,
    sourceFolderPath: asString(row.sourceFolderPath) || undefined,
    status: toImportItemStatus(row.status),
    dedupeResult: toImportDedupeResult(row.dedupeResult),
    bookmarkId: asString(row.bookmarkId) || undefined,
    hasArchive: typeof row.hasArchive === "boolean" ? row.hasArchive : undefined,
    reason: asString(row.reason) || undefined,
    errorReason: asString(row.errorReason) || undefined,
  };
}

export async function registerAccount(input: AuthRegisterRequest): Promise<AuthSession> {
  return requestJson("/auth/register", authSessionSchema, {
    method: "POST",
    body: input,
  });
}

export async function loginAccount(input: AuthLoginRequest): Promise<AuthSession> {
  return requestJson("/auth/login", authSessionSchema, {
    method: "POST",
    body: input,
  });
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  return requestJson("/auth/me", authUserSchema, {
    token,
  });
}

export async function fetchApiTokens(token: string): Promise<ApiTokenItem[]> {
  const payload = await requestJson("/api-tokens", apiTokenListResponseSchema, {
    token,
  });
  return payload.items;
}

export async function createApiToken(input: ApiTokenCreateRequest, token: string): Promise<ApiTokenCreateResponse> {
  const payload = apiTokenCreateRequestSchema.parse(input);
  return requestJson("/api-tokens", apiTokenCreateResponseSchema, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function revokeApiToken(tokenId: string, token: string) {
  await requestVoid(`/api-tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchBookmarks(query: BookmarkQuery, token: string): Promise<BookmarkResult> {
  const params = new URLSearchParams();
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }
  params.set("view", bookmarkListViewSchema.parse(query.view));
  if (query.quality !== "all") {
    params.set("quality", query.quality);
  }
  if (query.folderId) {
    params.set("folderId", query.folderId);
  }
  if (query.tagId) {
    params.set("tagId", query.tagId);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.offset !== undefined) {
    params.set("offset", String(query.offset));
  }
  const path = `/bookmarks${params.toString() ? `?${params.toString()}` : ""}`;
  const payload = await requestJson(path, bookmarkSearchResponseSchema, {
    token,
  });
  return {
    items: payload.items,
    total: payload.total,
    source: "api",
  };
}

export async function fetchPrivateModeStatus(token: string, privateToken?: string): Promise<PrivateVaultSummary> {
  return requestJson("/private-mode/status", privateVaultSummarySchema, {
    token,
    privateToken,
  });
}

export async function setupPrivateMode(password: string, token: string): Promise<PrivateModeUnlockResponse> {
  const payload = privateModeSetupRequestSchema.parse({ password });
  return requestJson("/private-mode/setup", privateModeUnlockResponseSchema, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function unlockPrivateMode(password: string, token: string): Promise<PrivateModeUnlockResponse> {
  const payload = privateModeUnlockRequestSchema.parse({ password });
  return requestJson("/private-mode/unlock", privateModeUnlockResponseSchema, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function lockPrivateMode(token: string): Promise<PrivateVaultSummary> {
  return requestJson("/private-mode/lock", privateVaultSummarySchema, {
    method: "POST",
    token,
  });
}

export async function fetchPrivateBookmarks(
  query: BookmarkQuery,
  token: string,
  privateToken: string,
): Promise<BookmarkResult> {
  const params = new URLSearchParams();
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }
  params.set("view", bookmarkListViewSchema.parse(query.view));
  if (query.quality !== "all") {
    params.set("quality", query.quality);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.offset !== undefined) {
    params.set("offset", String(query.offset));
  }
  const path = `/private/bookmarks${params.toString() ? `?${params.toString()}` : ""}`;
  const payload = await requestJson(path, privateBookmarkSearchResponseSchema, {
    token,
    privateToken,
  });
  return {
    items: payload.items,
    total: payload.total,
    source: "api",
  };
}

export async function fetchBookmarkFolderCounts(token: string): Promise<Record<string, number>> {
  const payload = await requestJson("/bookmarks/sidebar-stats", bookmarkSidebarStatsResponseSchema, {
    token,
  });
  return payload.folderCounts.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.folderId] = item.count;
    return accumulator;
  }, {});
}

export async function fetchWorkspaceBootstrap(token: string): Promise<WorkspaceBootstrapResult> {
  return requestJson("/workspace/bootstrap", workspaceBootstrapResponseSchema, {
    token,
  });
}

export async function fetchPrivateBookmarkDetail(
  bookmarkId: string,
  token: string,
  privateToken: string,
): Promise<BookmarkDetailResult | null> {
  try {
    const payload = await requestJson(
      `/private/bookmarks/${encodeURIComponent(bookmarkId)}`,
      privateBookmarkDetailResponseSchema,
      {
        token,
        privateToken,
      },
    );
    return {
      bookmark: payload.bookmark,
      versions: payload.versions,
      source: "api",
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchBookmarkDetail(
  bookmarkId: string,
  token: string,
): Promise<BookmarkDetailResult | null> {
  try {
    const payload = await requestJson(
      `/bookmarks/${encodeURIComponent(bookmarkId)}`,
      bookmarkDetailResponseSchema,
      {
        token,
      },
    );
    return {
      bookmark: payload.bookmark,
      versions: payload.versions,
      source: "api",
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function deleteBookmark(bookmarkId: string, token: string) {
  await requestVoid(`/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
    token,
  });
}

export async function updateBookmarkMetadata(
  bookmarkId: string,
  input: BookmarkMetadataUpdateRequest,
  token: string,
) {
  const payload = bookmarkMetadataUpdateRequestSchema.parse(input);
  return requestJson(
    `/bookmarks/${encodeURIComponent(bookmarkId)}/metadata`,
    bookmarkSchema,
    {
      method: "PATCH",
      token,
      body: payload,
    },
  );
}

export async function fetchFolders(token: string): Promise<Folder[]> {
  const payload = await requestJson("/folders", folderListResponseSchema, {
    token,
  });
  return payload.items;
}

export async function createFolder(input: FolderCreateRequest, token: string) {
  return requestJson("/folders", folderSchema, {
    method: "POST",
    token,
    body: input,
  });
}

export async function updateFolder(folderId: string, input: FolderUpdateRequest, token: string) {
  return requestJson(`/folders/${encodeURIComponent(folderId)}`, folderSchema, {
    method: "PATCH",
    token,
    body: input,
  });
}

export async function deleteFolder(folderId: string, token: string) {
  await requestVoid(`/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchTags(token: string): Promise<Tag[]> {
  const payload = await requestJson("/tags", tagListResponseSchema, {
    token,
  });
  return payload.items;
}

export async function createTag(input: TagCreateRequest, token: string) {
  return requestJson("/tags", tagSchema, {
    method: "POST",
    token,
    body: input,
  });
}

export async function updateTag(tagId: string, input: TagUpdateRequest, token: string) {
  return requestJson(`/tags/${encodeURIComponent(tagId)}`, tagSchema, {
    method: "PATCH",
    token,
    body: input,
  });
}

export async function deleteTag(tagId: string, token: string) {
  await requestVoid(`/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
    token,
  });
}

export async function createArchiveObjectUrl(
  token: string,
  objectKey: string,
  sourceUrl: string,
  privateToken?: string,
) {
  const response = await fetch(
    `${resolveApiBase()}/objects?key=${encodeURIComponent(objectKey)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        ...(privateToken ? { "x-keeppage-private-token": privateToken } : {}),
      },
    },
  );
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new ApiError(response.status, errorPayload.message, errorPayload.details);
  }
  const html = ensureArchiveBaseHref(await response.text(), sourceUrl);
  const blob = new Blob([html], {
    type: response.headers.get("content-type") ?? "text/html;charset=utf-8",
  });
  return URL.createObjectURL(blob);
}

export async function previewImport(input: ImportPreviewRequest, token: string): Promise<ImportPreviewResult> {
  const response = await request("/imports/preview", {
    method: "POST",
    token,
    body: input,
  });
  const payload = asRecord(await response.json());
  const summary = asRecord(payload.summary);
  const samplesRaw = Array.isArray(payload.samples) ? payload.samples : [];
  const foldersRaw = Array.isArray(payload.folders) ? payload.folders : [];
  const domainsRaw = Array.isArray(payload.domains) ? payload.domains : [];
  const samples = samplesRaw.map((item) => {
    const row = asRecord(item);
    const derivedStatus = !asBoolean(row.valid, true)
      ? "invalid"
      : asBoolean(row.duplicateInFile)
      ? "duplicate_in_file"
      : asString(row.existingBookmarkId)
      ? "duplicate_in_library"
      : "valid";
    const status = asString(row.status, derivedStatus);
    const sampleStatus: ImportPreviewItem["status"] = (
      status === "valid" || status === "invalid" || status === "duplicate_in_file" || status === "duplicate_in_library"
        ? status
        : "valid"
    );
    return {
      id: asString(row.id, crypto.randomUUID()),
      title: asString(row.title, "(无标题)"),
      url: asString(row.url),
      domain: asString(row.domain),
      folderPath: asString(row.folderPath) || undefined,
      sourceTags: Array.isArray(row.sourceTags)
        ? row.sourceTags.filter((value): value is string => typeof value === "string")
        : undefined,
      status: sampleStatus,
      reason: asString(row.reason) || undefined,
      existingBookmarkId: asString(row.existingBookmarkId) || undefined,
      existingHasArchive: typeof row.existingHasArchive === "boolean" ? row.existingHasArchive : undefined,
    };
  });

  return {
    source: "api",
    sourceType: toImportSourceType(payload.sourceType),
    stats: {
      totalCount: asNumber(summary.totalCount || summary.rawTotal),
      rawTotal: asNumber(summary.rawTotal || summary.totalCount),
      validCount: asNumber(summary.validCount),
      invalidCount: asNumber(summary.invalidCount),
      duplicateInFileCount: asNumber(summary.duplicateInFileCount),
      duplicateExistingCount: asNumber(summary.duplicateExistingCount || summary.duplicateInLibraryCount),
      duplicateInLibraryCount: asNumber(summary.duplicateInLibraryCount || summary.duplicateExistingCount),
      estimatedCreateCount: asNumber(summary.estimatedCreateCount || summary.willCreateCount),
      willCreateCount: asNumber(summary.willCreateCount || summary.estimatedCreateCount),
      estimatedMergeCount: asNumber(summary.estimatedMergeCount || summary.willMergeCount),
      willMergeCount: asNumber(summary.willMergeCount || summary.estimatedMergeCount),
      estimatedSkipCount: asNumber(summary.estimatedSkipCount || summary.willSkipCount),
      willSkipCount: asNumber(summary.willSkipCount || summary.estimatedSkipCount),
    },
    samples,
    folders: foldersRaw.map((item) => {
      const row = asRecord(item);
      return {
        path: asString(row.path || row.folderPath || row.value),
        count: asNumber(row.count),
      };
    }),
    domains: domainsRaw.map((item) => {
      const row = asRecord(item);
      return {
        domain: asString(row.domain || row.value),
        count: asNumber(row.count),
      };
    }),
  };
}

export async function createImportTask(input: ImportPreviewRequest & { name: string }, token: string) {
  const response = await request("/imports", {
    method: "POST",
    token,
    body: input,
  });
  const payload = asRecord(await response.json());
  return {
    taskId: asString(payload.taskId || payload.id),
  };
}

export async function fetchImportTasks(token: string): Promise<ImportTaskSummary[]> {
  const response = await request("/imports", {
    token,
  });
  const payload = asRecord(await response.json());
  const rows = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.tasks)
    ? payload.tasks
    : [];
  return rows.map(toImportSummary).filter((item) => item.id);
}

export async function fetchImportTaskDetail(taskId: string, token: string): Promise<ImportTaskDetailResult | null> {
  try {
    const response = await request(`/imports/${encodeURIComponent(taskId)}`, {
      token,
    });
    const payload = asRecord(await response.json());
    const task = toImportSummary(payload.task ?? payload);
    const rows = Array.isArray(payload.items) ? payload.items : [];
    return {
      source: "api",
      task,
      items: rows.map(toImportItem),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function submitCloudArchive(
  input: CloudArchiveRequest,
  token: string,
): Promise<CloudArchiveResponse> {
  return requestJson("/cloud-archive", cloudArchiveResponseSchema, {
    method: "POST",
    token,
    body: input,
  });
}

export async function fetchCloudArchiveTask(
  taskId: string,
  token: string,
): Promise<CloudArchiveTask | null> {
  try {
    return await requestJson(
      `/cloud-archive/${encodeURIComponent(taskId)}`,
      cloudArchiveTaskSchema,
      { token },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
