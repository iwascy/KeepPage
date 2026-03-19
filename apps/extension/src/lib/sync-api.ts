import {
  captureInitResponseSchema,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
  type CaptureTask,
} from "@keeppage/domain";
import { getStoredAuthUser } from "./auth-storage";
import { getConfiguredApiBaseUrl, recoverUnauthorizedSession } from "./auth-flow";
import { emitDebugLogToTab } from "./debug-log";
import { createLogger } from "./logger";

const CHUNK_SIZE_BYTES = 256 * 1024;
const CHUNK_UPLOAD_THRESHOLD_BYTES = 512 * 1024;
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

async function uploadArchiveHtml(
  uploadUrl: string,
  authHeaders: Record<string, string>,
  archiveHtml: string,
): Promise<UploadResult> {
  const uploadPayload = await createUploadPayload(archiveHtml);
  if (uploadPayload.byteLength > CHUNK_UPLOAD_THRESHOLD_BYTES) {
    logger.info("Archive payload exceeds direct upload threshold, switching to chunked upload.", {
      uploadUrl,
      payloadBytes: uploadPayload.byteLength,
      chunkSizeBytes: CHUNK_SIZE_BYTES,
    });
    return uploadArchiveHtmlInChunks(uploadUrl, authHeaders, uploadPayload);
  }

  try {
    await uploadArchiveHtmlDirect(uploadUrl, authHeaders, uploadPayload);
    return {
      mode: "direct",
      payloadBytes: uploadPayload.byteLength,
      chunkCount: 1,
      contentEncoding: uploadPayload.contentEncoding,
    };
  } catch (error) {
    if (isPayloadTooLargeError(error)) {
      logger.warn("Direct archive upload hit 413, retrying with chunked upload.", {
        uploadUrl,
        payloadBytes: uploadPayload.byteLength,
        chunkSizeBytes: CHUNK_SIZE_BYTES,
      });
      return uploadArchiveHtmlInChunks(uploadUrl, authHeaders, uploadPayload);
    }
    throw error;
  }
}

async function uploadArchiveHtmlDirect(
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

async function uploadArchiveHtmlInChunks(
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

async function createUploadPayload(archiveHtml: string): Promise<UploadPayload> {
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
  const result = await chrome.storage.local.get("authToken");
  const configured = typeof result.authToken === "string" ? result.authToken.trim() : "";
  return configured || "";
}

async function getAuthHeaders() {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("未登录账号，请先在扩展侧登录后再同步。");
  }
  return {
    authorization: `Bearer ${token}`,
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

  const apiBaseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();
  const authHeaders = await getAuthHeaders();
  const archiveFileSize = new TextEncoder().encode(artifacts.archiveHtml).length;
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

  const initResponse = captureInitResponseSchema.parse(
    await withUnauthorizedAuthRecovery(
      () => postJson(`${apiBaseUrl}/captures/init`, initPayload, {
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

  if (initResponse.alreadyExists && initResponse.bookmarkId && initResponse.versionId) {
    await logSync("info", debugTabId, "Remote capture already exists.", {
      taskId: task.id,
      bookmarkId: initResponse.bookmarkId,
      versionId: initResponse.versionId,
    });
    return {
      bookmarkId: initResponse.bookmarkId,
      versionId: initResponse.versionId,
    };
  }

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

  const completePayload: CaptureCompleteRequest = {
    objectKey: initResponse.objectKey,
    htmlSha256: task.localArchiveSha256,
    textSha256: await computeSha256Hex(artifacts.extractedText),
    extractedText: artifacts.extractedText,
    quality,
    source: task.source,
    deviceId,
  };

  const completeResponse = await withUnauthorizedAuthRecovery(
    () => postJson(
      `${apiBaseUrl}/captures/complete`,
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

async function logSync(
  level: "info" | "warn" | "error",
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
