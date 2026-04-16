import type {
  BookmarkVersionMediaFile,
  CaptureDownloadableMedia,
  CaptureCompleteRequest,
  CaptureInitRequest,
  CaptureTask,
} from "@keeppage/domain";
import { getStoredAuthUser, getStoredSyncToken } from "./auth-storage";
import { getConfiguredApiBaseUrl, recoverUnauthorizedSession } from "./auth-flow";
import { emitDebugLogToTab } from "./debug-log";
import { captureInitResponseSchema } from "./domain-runtime";
import { createLogger } from "./logger";
import { getPrivateSessionToken } from "./private-vault";

const CHUNK_SIZE_BYTES = 256 * 1024;
const CHUNK_UPLOAD_THRESHOLD_BYTES = 512 * 1024;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;
const logger = createLogger("sync-api");

type SyncResult = {
  bookmarkId: string;
  versionId: string;
};

type UploadPayload = {
  headers: Record<string, string>;
  body: Uint8Array;
  byteLength: number;
  contentType: string;
  contentEncoding?: string;
};

type UploadResult = {
  mode: "direct" | "chunked";
  payloadBytes: number;
  chunkCount: number;
  contentEncoding?: string;
};

class UploadHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string, message?: string) {
    super(message ?? `Upload ${status}: ${responseBody}`);
    this.name = "UploadHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

class ApiRequestError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string, message?: string) {
    super(message ?? formatApiErrorMessage(status, responseBody));
    this.name = "ApiRequestError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

class MediaUploadSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUploadSkippedError";
  }
}

async function uploadArchiveHtml(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  archiveHtml: string,
): Promise<UploadResult> {
  const uploadPayload = await createTextUploadPayload(archiveHtml);
  return uploadObject(uploadUrl, authHeaders, uploadPayload);
}

async function uploadBinaryObject(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  body: Uint8Array,
  contentType: string,
): Promise<UploadResult> {
  return uploadObject(uploadUrl, authHeaders, {
    headers: {
      "content-type": contentType,
    },
    body,
    byteLength: body.byteLength,
    contentType,
  });
}

async function uploadObject(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  uploadPayload: UploadPayload,
): Promise<UploadResult> {
  if (uploadPayload.byteLength > CHUNK_UPLOAD_THRESHOLD_BYTES) {
    logger.info("Upload payload exceeds direct upload threshold, switching to chunked upload.", {
      uploadUrl,
      payloadBytes: uploadPayload.byteLength,
      chunkSizeBytes: CHUNK_SIZE_BYTES,
    });
    return uploadObjectInChunks(uploadUrl, authHeaders, uploadPayload);
  }

  try {
    await uploadObjectDirect(uploadUrl, authHeaders, uploadPayload);
    return {
      mode: "direct",
      payloadBytes: uploadPayload.byteLength,
      chunkCount: 1,
      contentEncoding: uploadPayload.contentEncoding,
    };
  } catch (error) {
    if (isPayloadTooLargeError(error)) {
      logger.warn("Direct upload hit 413, retrying with chunked upload.", {
        uploadUrl,
        payloadBytes: uploadPayload.byteLength,
        chunkSizeBytes: CHUNK_SIZE_BYTES,
      });
      return uploadObjectInChunks(uploadUrl, authHeaders, uploadPayload);
    }
    throw error;
  }
}

async function uploadObjectDirect(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  uploadPayload: UploadPayload,
) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      ...authHeaders,
      ...uploadPayload.headers,
    },
    body: toBinaryBody(uploadPayload.body),
  });

  if (!response.ok) {
    throw await createUploadError(response, uploadUrl);
  }
}

async function uploadObjectInChunks(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  uploadPayload: UploadPayload,
): Promise<UploadResult> {
  const uploadId = crypto.randomUUID();
  const chunkUrl = `${uploadUrl}/chunks/${encodeURIComponent(uploadId)}`;
  let offset = 0;
  let chunkCount = 0;

  while (offset < uploadPayload.byteLength) {
    const chunk = uploadPayload.body.slice(offset, offset + CHUNK_SIZE_BYTES);
    const isComplete = offset + chunk.byteLength >= uploadPayload.byteLength;
    logger.debug("Uploading archive chunk.", {
      uploadId,
      uploadUrl: chunkUrl,
      offset,
      chunkBytes: chunk.byteLength,
      totalBytes: uploadPayload.byteLength,
      isComplete,
    });
    const response = await fetch(chunkUrl, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "content-type": "application/octet-stream",
        "x-keeppage-upload-offset": String(offset),
        "x-keeppage-upload-total-size": String(uploadPayload.byteLength),
        "x-keeppage-upload-complete": isComplete ? "1" : "0",
        "x-keeppage-upload-content-type": uploadPayload.contentType,
        ...(uploadPayload.contentEncoding
          ? {
              "x-keeppage-upload-content-encoding": uploadPayload.contentEncoding,
            }
          : {}),
      },
      body: toBinaryBody(chunk),
    });

    if (!response.ok) {
      throw await createUploadError(response, chunkUrl);
    }

    offset += chunk.byteLength;
    chunkCount += 1;
  }

  return {
    mode: "chunked",
    payloadBytes: uploadPayload.byteLength,
    chunkCount,
    contentEncoding: uploadPayload.contentEncoding,
  };
}

async function createTextUploadPayload(archiveHtml: string): Promise<UploadPayload> {
  const textEncoder = new TextEncoder();
  const originalBytes = textEncoder.encode(archiveHtml);
  const compressed = await gzipContent(archiveHtml);
  if (compressed && compressed.byteLength > 0 && compressed.byteLength < originalBytes.byteLength) {
    logger.info("Uploading compressed archive payload.", {
      originalBytes: originalBytes.byteLength,
      compressedBytes: compressed.byteLength,
    });
    return {
      headers: {
        "content-type": "text/html;charset=utf-8",
        "content-encoding": "gzip",
      } as Record<string, string>,
      body: compressed,
      byteLength: compressed.byteLength,
      contentType: "text/html;charset=utf-8",
      contentEncoding: "gzip",
    };
  }

  logger.info("Uploading plain archive payload.", {
    originalBytes: originalBytes.byteLength,
  });
  return {
    headers: {
      "content-type": "text/html;charset=utf-8",
    } as Record<string, string>,
    body: originalBytes,
    byteLength: originalBytes.byteLength,
    contentType: "text/html;charset=utf-8",
  };
}

async function gzipContent(content: string) {
  if (typeof CompressionStream === "undefined") {
    return null;
  }

  const stream = new Blob([content], {
    type: "text/html;charset=utf-8",
  }).stream().pipeThrough(new CompressionStream("gzip"));
  const compressedBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(compressedBuffer);
}

async function createUploadError(response: Response, uploadUrl: string) {
  const responseBody = await response.text();
  logger.error("Archive upload failed.", {
    uploadUrl,
    status: response.status,
    body: responseBody,
  });
  return new UploadHttpError(
    response.status,
    responseBody,
    formatApiErrorMessage(response.status, responseBody),
  );
}

function isPayloadTooLargeError(error: unknown): error is UploadHttpError {
  return error instanceof UploadHttpError && error.status === 413;
}

function toBinaryBody(content: Uint8Array) {
  const buffer = Uint8Array.from(content).buffer;
  return new Blob([buffer], {
    type: "application/octet-stream",
  });
}

async function getApiBaseUrl() {
  return getConfiguredApiBaseUrl();
}

async function getAuthToken() {
  const configured = await getStoredSyncToken();
  return configured || "";
}

async function getAuthHeaders(privateToken?: string) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("未登录账号，请先在扩展侧登录后再同步。");
  }
  return {
    authorization: `Bearer ${token}`,
    ...(privateToken
      ? {
          "x-keeppage-private-token": privateToken,
        }
      : {}),
  } satisfies Record<string, string>;
}

async function getOrCreateDeviceId() {
  const result = await chrome.storage.local.get("deviceId");
  if (typeof result.deviceId === "string" && result.deviceId.length > 0) {
    return result.deviceId;
  }
  const deviceId = `ext_${crypto.randomUUID()}`;
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

async function postJson(
  url: string,
  payload: unknown,
  extraHeaders?: Record<string, string>,
) {
  logger.info("POST request started.", { url });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("POST request failed.", {
      url,
      status: response.status,
      body: text,
    });
    throw new ApiRequestError(response.status, text);
  }

  logger.info("POST request succeeded.", {
    url,
    status: response.status,
  });
  return response.json();
}

export async function syncTaskToApi(task: CaptureTask, debugTabId?: number): Promise<SyncResult> {
  if (
    !task.artifacts?.archiveHtml ||
    typeof task.artifacts.extractedText !== "string" ||
    !task.quality
  ) {
    throw new Error("Local archive is incomplete, cannot sync yet.");
  }
  if (!task.localArchiveSha256) {
    throw new Error("Archive SHA-256 is missing.");
  }
  const artifacts = task.artifacts;
  const quality = task.quality;

  const authUser = await getStoredAuthUser();
  if (!authUser) {
    throw new Error("未登录账号，请先在扩展侧登录后再同步。");
  }
  if (!task.owner) {
    throw new Error("这条本地任务没有账号归属，请重新抓取后再同步。");
  }
  if (task.owner.userId !== authUser.id) {
    throw new Error(`这条本地任务属于 ${task.owner.email}，请切回对应账号后再同步。`);
  }

  const isPrivateTask = (task.saveMode ?? "standard") === "private" || task.isPrivate;
  const privateToken = isPrivateTask ? await getPrivateSessionToken() : null;
  if (isPrivateTask && !privateToken) {
    throw new Error("请先在扩展侧输入私密模式密码，再继续同步私密内容。");
  }

  const apiBaseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();
  const authHeaders = await getAuthHeaders(privateToken ?? undefined);
  const captureBasePath = isPrivateTask ? "/private/captures" : "/captures";
  const archiveFileSize = new TextEncoder().encode(artifacts.archiveHtml).length;
  await logSync("debug", debugTabId, "Prepared sync prerequisites.", {
    taskId: task.id,
    deviceId,
    hasAuthorizationHeader: Boolean(authHeaders.authorization),
    isPrivateTask,
    extractedTextLength: artifacts.extractedText.length,
    qualityGrade: quality.grade,
    qualityScore: quality.score,
  });
  await logSync("info", debugTabId, "Starting sync task.", {
    taskId: task.id,
    url: task.source.url,
    apiBaseUrl,
    profile: task.profile,
    archiveFileSize,
  });

  const initPayload: CaptureInitRequest = {
    url: task.source.url,
    title: task.source.title,
    fileSize: archiveFileSize,
    htmlSha256: task.localArchiveSha256,
    profile: task.profile,
    deviceId,
  };
  await logSync("debug", debugTabId, "Submitting capture init payload.", {
    taskId: task.id,
    payload: initPayload,
  });

  const initResponse = captureInitResponseSchema.parse(
    await withUnauthorizedAuthRecovery(
      () => postJson(`${apiBaseUrl}${captureBasePath}/init`, initPayload, {
        ...authHeaders,
        "x-keeppage-public-base-url": apiBaseUrl,
      }),
      debugTabId,
      task.id,
    ),
  );
  await logSync("info", debugTabId, "Capture init completed.", {
    taskId: task.id,
    alreadyExists: initResponse.alreadyExists,
    objectKey: initResponse.objectKey,
    uploadUrl: initResponse.uploadUrl,
  });

  if (initResponse.alreadyExists) {
    await logSync("info", debugTabId, "Remote capture already exists.", {
      taskId: task.id,
      bookmarkId: initResponse.bookmarkId,
      versionId: initResponse.versionId,
      skippedUpload: true,
    });
  } else {
    const uploadUrl = normalizeUploadUrl(
      initResponse.uploadUrl,
      initResponse.objectKey,
      apiBaseUrl,
    );
    if (uploadUrl !== initResponse.uploadUrl) {
      await logSync("warn", debugTabId, "Rewriting upload URL to configured API base.", {
        taskId: task.id,
        originalUploadUrl: initResponse.uploadUrl,
        rewrittenUploadUrl: uploadUrl,
      });
    }

    const uploadResult = await withUnauthorizedAuthRecovery(
      () => uploadArchiveHtml(uploadUrl, authHeaders, artifacts.archiveHtml),
      debugTabId,
      task.id,
    );
    await logSync("info", debugTabId, "Archive upload completed.", {
      taskId: task.id,
      uploadUrl,
      uploadMode: uploadResult.mode,
      uploadPayloadBytes: uploadResult.payloadBytes,
      uploadChunkCount: uploadResult.chunkCount,
      contentEncoding: uploadResult.contentEncoding ?? "identity",
    });
  }

  const uploadedMediaFiles = await uploadDownloadableMediaFiles({
    apiBaseUrl,
    authHeaders,
    debugTabId,
    htmlObjectKey: initResponse.objectKey,
    sourceUrl: task.source.url,
    taskId: task.id,
    media: artifacts.downloadableMedia ?? [],
  });

  const completePayload: CaptureCompleteRequest = {
    objectKey: initResponse.objectKey,
    htmlSha256: task.localArchiveSha256,
    readerHtml: artifacts.readerHtml,
    textSha256: await computeSha256Hex(artifacts.extractedText),
    extractedText: artifacts.extractedText,
    mediaFiles: uploadedMediaFiles.length > 0 ? uploadedMediaFiles : undefined,
    quality,
    source: task.source,
    deviceId,
  };
  await logSync("debug", debugTabId, "Submitting capture complete payload.", {
    taskId: task.id,
    objectKey: completePayload.objectKey,
    readerHtmlBytes: completePayload.readerHtml?.length,
    sourceUrl: completePayload.source.url,
    textSha256: completePayload.textSha256,
    mediaFileCount: uploadedMediaFiles.length,
    qualityGrade: completePayload.quality.grade,
    qualityScore: completePayload.quality.score,
  });

  const completeResponse = await withUnauthorizedAuthRecovery(
    () => postJson(
      `${apiBaseUrl}${captureBasePath}/complete`,
      completePayload,
      authHeaders,
    ),
    debugTabId,
    task.id,
  ) as {
    bookmarkId: string;
    versionId: string;
  };
  await logSync("info", debugTabId, "Capture complete acknowledged.", {
    taskId: task.id,
    bookmarkId: completeResponse.bookmarkId,
    versionId: completeResponse.versionId,
  });

  return {
    bookmarkId: completeResponse.bookmarkId,
    versionId: completeResponse.versionId,
  };
}

async function uploadDownloadableMediaFiles(input: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  debugTabId?: number;
  htmlObjectKey: string;
  sourceUrl: string;
  taskId: string;
  media: CaptureDownloadableMedia[];
}): Promise<BookmarkVersionMediaFile[]> {
  const deduplicatedMedia = deduplicateMedia(input.media);
  if (deduplicatedMedia.length === 0) {
    return [];
  }

  const uploaded: BookmarkVersionMediaFile[] = [];
  let skippedCount = 0;
  await logSync("info", input.debugTabId, "Uploading downloadable media files.", {
    taskId: input.taskId,
    htmlObjectKey: input.htmlObjectKey,
    mediaCount: deduplicatedMedia.length,
  });

  for (const media of deduplicatedMedia) {
    try {
      const skipReason = resolveMediaSkipReason(media);
      if (skipReason) {
        throw new MediaUploadSkippedError(skipReason);
      }

      const downloaded = await downloadMediaBinary(media, input.sourceUrl);
      const extension = resolveMediaFileExtension(downloaded.contentType, media.url, media.kind);
      const objectKey = createMediaObjectKey(input.htmlObjectKey, media.id, extension);
      const uploadUrl = `${input.apiBaseUrl}/uploads/${encodeURIComponent(objectKey)}`;
      const uploadResult = await withUnauthorizedAuthRecovery(
        () => uploadBinaryObject(uploadUrl, input.authHeaders, downloaded.body, downloaded.contentType),
        input.debugTabId,
        input.taskId,
      );
      await logSync("info", input.debugTabId, "Media upload completed.", {
        taskId: input.taskId,
        mediaId: media.id,
        mediaKind: media.kind,
        mediaUrl: media.url,
        objectKey,
        fileSize: downloaded.body.byteLength,
        contentType: downloaded.contentType,
        uploadMode: uploadResult.mode,
        uploadChunkCount: uploadResult.chunkCount,
      });
      uploaded.push({
        id: media.id,
        kind: media.kind,
        objectKey,
        originalUrl: media.url,
        mimeType: downloaded.contentType,
        fileSize: downloaded.body.byteLength,
        width: media.width,
        height: media.height,
      });
    } catch (error) {
      skippedCount += 1;
      await logSync("warn", input.debugTabId, "Skipping downloadable media after sync-side failure.", {
        taskId: input.taskId,
        mediaId: media.id,
        mediaKind: media.kind,
        mediaUrl: media.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (skippedCount > 0) {
    await logSync("warn", input.debugTabId, "Some downloadable media were skipped, continuing capture sync.", {
      taskId: input.taskId,
      uploadedCount: uploaded.length,
      skippedCount,
      requestedCount: deduplicatedMedia.length,
    });
  }

  return uploaded;
}

async function downloadMediaBinary(media: CaptureDownloadableMedia, sourceUrl: string) {
  let response: Response;
  try {
    response = await fetchMediaWithTimeout(media.url, {
      cache: "no-store",
      referrer: sourceUrl,
      referrerPolicy: "strict-origin-when-cross-origin",
    });
  } catch {
    response = await fetchMediaWithTimeout(media.url, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`下载媒体失败（${response.status}）：${media.url}${body ? ` - ${body.slice(0, 200)}` : ""}`);
  }

  const contentType = normalizeContentType(
    response.headers.get("content-type"),
    media.url,
    media.kind,
  );
  const unsupportedReason = resolveUnsupportedMediaContentReason(contentType, media);
  if (unsupportedReason) {
    throw new MediaUploadSkippedError(unsupportedReason);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error(`下载到的媒体内容为空：${media.url}`);
  }

  return {
    contentType,
    body: buffer,
  };
}

function deduplicateMedia(media: CaptureDownloadableMedia[]) {
  const seen = new Set<string>();
  return media.filter((item) => {
    const key = `${item.kind}:${item.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveMediaSkipReason(media: CaptureDownloadableMedia) {
  const pathname = safeParseUrl(media.url)?.pathname.toLowerCase() ?? media.url.toLowerCase();
  if (media.kind === "video" && pathname.endsWith(".m3u8")) {
    return "暂不上传 HLS/m3u8 流媒体地址。";
  }
  return null;
}

function createMediaObjectKey(htmlObjectKey: string, mediaId: string, extension: string) {
  const safeId = mediaId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "media";
  const safeExtension = extension.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "bin";
  const baseKey = htmlObjectKey.endsWith(".html")
    ? htmlObjectKey.replace(/\.html$/i, "")
    : htmlObjectKey;
  return `${baseKey}.assets/${safeId}.${safeExtension}`;
}

function resolveMediaFileExtension(
  contentType: string,
  mediaUrl: string,
  kind: CaptureDownloadableMedia["kind"],
) {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType === "image/jpeg") {
    return "jpg";
  }
  if (normalizedType === "image/png") {
    return "png";
  }
  if (normalizedType === "image/webp") {
    return "webp";
  }
  if (normalizedType === "image/gif") {
    return "gif";
  }
  if (normalizedType === "video/mp4") {
    return "mp4";
  }
  if (normalizedType === "video/webm") {
    return "webm";
  }
  if (normalizedType === "video/quicktime") {
    return "mov";
  }

  const pathname = safeParseUrl(mediaUrl)?.pathname ?? "";
  const matchedExtension = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (matchedExtension) {
    return matchedExtension.toLowerCase();
  }

  return kind === "video" ? "mp4" : "jpg";
}

function normalizeContentType(
  rawContentType: string | null,
  mediaUrl: string,
  kind: CaptureDownloadableMedia["kind"],
) {
  const normalized = rawContentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream" && normalized !== "binary/octet-stream") {
    return normalized;
  }

  const extension = resolveMediaFileExtension("application/octet-stream", mediaUrl, kind);
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function resolveUnsupportedMediaContentReason(
  contentType: string,
  media: CaptureDownloadableMedia,
) {
  if (media.kind === "video") {
    if (
      contentType === "application/vnd.apple.mpegurl"
      || contentType === "application/x-mpegurl"
    ) {
      return "媒体响应是 HLS 播放清单，暂不上传。";
    }
    if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      return `媒体响应类型异常：${contentType}`;
    }
    return null;
  }

  if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
    return `媒体响应类型异常：${contentType}`;
  }

  return null;
}

function safeParseUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

async function fetchMediaWithTimeout(input: string, init: RequestInit) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS)
    : null;

  try {
    return await fetch(input, {
      ...init,
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`下载媒体超时（${MEDIA_DOWNLOAD_TIMEOUT_MS}ms）：${input}`);
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function logSync(
  level: "debug" | "info" | "warn" | "error",
  tabId: number | undefined,
  message: string,
  details?: unknown,
) {
  logger[level](message, details);
  await emitDebugLogToTab(tabId, "sync-api", level, message, details);
}

async function withUnauthorizedAuthRecovery<T>(
  action: () => Promise<T>,
  debugTabId: number | undefined,
  taskId: string,
) {
  try {
    return await action();
  } catch (error) {
    if (!isUnauthorizedApiError(error)) {
      throw error;
    }

    await logSync("warn", debugTabId, "Auth session expired during sync, redirecting to login.", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    await recoverUnauthorizedSession("session-expired");
    throw new Error("登录已失效，已为你打开登录页，请重新登录后再试。");
  }
}

function normalizeUploadUrl(uploadUrl: string, objectKey: string, apiBaseUrl: string) {
  try {
    const parsedUploadUrl = new URL(uploadUrl);
    const parsedApiBaseUrl = new URL(apiBaseUrl);
    if (
      isLoopbackHost(parsedUploadUrl.hostname) &&
      !isLoopbackHost(parsedApiBaseUrl.hostname)
    ) {
      return `${apiBaseUrl}/uploads/${encodeURIComponent(objectKey)}`;
    }
    return uploadUrl;
  } catch {
    return `${apiBaseUrl}/uploads/${encodeURIComponent(objectKey)}`;
  }
}

function isUnauthorizedApiError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.status === 401 || error.status === 403;
  }
  if (error instanceof UploadHttpError) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}

function isLoopbackHost(hostname: string) {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}

async function computeSha256Hex(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function formatApiErrorMessage(status: number, body: string) {
  if (status === 401 || status === 403) {
    return "未登录或登录已失效，请在扩展侧重新登录后再试。";
  }
  return body ? `API ${status}: ${body}` : `API ${status}`;
}
