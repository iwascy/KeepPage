import {
  captureInitResponseSchema,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
  type CaptureTask,
} from "@keeppage/domain";
import { emitDebugLogToTab } from "./debug-log";
import { createLogger } from "./logger";

const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const logger = createLogger("sync-api");

type SyncResult = {
  bookmarkId: string;
  versionId: string;
};

async function uploadArchiveHtml(uploadUrl: string, archiveHtml: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": "text/html;charset=utf-8",
    },
    body: archiveHtml,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Archive upload failed.", {
      uploadUrl,
      status: response.status,
      body: text,
    });
    throw new Error(`Upload ${response.status}: ${text}`);
  }
}

async function getApiBaseUrl() {
  const result = await chrome.storage.local.get("apiBaseUrl");
  const configured = typeof result.apiBaseUrl === "string" ? result.apiBaseUrl.trim() : "";
  return (configured || DEFAULT_API_BASE_URL).replace(/\/$/, "");
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
    throw new Error(`API ${response.status}: ${text}`);
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

  const apiBaseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();
  const archiveFileSize = new TextEncoder().encode(task.artifacts.archiveHtml).length;
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
    await postJson(`${apiBaseUrl}/captures/init`, initPayload, {
      "x-keeppage-public-base-url": apiBaseUrl,
    }),
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

  await uploadArchiveHtml(uploadUrl, task.artifacts.archiveHtml);
  await logSync("info", debugTabId, "Archive upload completed.", {
    taskId: task.id,
    uploadUrl,
  });

  const completePayload: CaptureCompleteRequest = {
    objectKey: initResponse.objectKey,
    htmlSha256: task.localArchiveSha256,
    textSha256: await computeSha256Hex(task.artifacts.extractedText),
    extractedText: task.artifacts.extractedText,
    quality: task.quality,
    source: task.source,
    deviceId,
  };

  const completeResponse = await postJson(
    `${apiBaseUrl}/captures/complete`,
    completePayload,
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
