import {
  captureInitResponseSchema,
  type CaptureCompleteRequest,
  type CaptureInitRequest,
  type CaptureTask,
} from "@keeppage/domain";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";

type SyncResult = {
  bookmarkId: string;
  versionId: string;
};

export async function syncTaskToApi(task: CaptureTask): Promise<SyncResult> {
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

  const initPayload: CaptureInitRequest = {
    url: task.source.url,
    title: task.source.title,
    fileSize: archiveFileSize,
    htmlSha256: task.localArchiveSha256,
    profile: task.profile,
    deviceId,
  };

  const initResponse = captureInitResponseSchema.parse(
    await postJson(`${apiBaseUrl}/captures/init`, initPayload),
  );

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

  return {
    bookmarkId: completeResponse.bookmarkId,
    versionId: completeResponse.versionId,
  };
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

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }

  return response.json();
}

async function computeSha256Hex(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}
