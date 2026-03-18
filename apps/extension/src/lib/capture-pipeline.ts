import {
  createCaptureId,
  evaluateQuality,
  type CapturePageSignals,
  type CaptureProfile,
  type CaptureSource,
  type CaptureTask,
} from "@keeppage/domain";
import {
  getCaptureTask,
  listCaptureTasks,
  patchCaptureTask,
  putCaptureTask,
  transitionCaptureTaskStatus,
} from "./capture-queue";
import {
  MESSAGE_TYPE,
  type CaptureArchiveHtmlRequest,
  type CaptureArchiveHtmlResponse,
  type CollectLiveSignalsRequest,
  type CollectLiveSignalsResponse,
  type TaskUpdatedEvent,
} from "./messages";
import { syncTaskToApi } from "./sync-api";

const DEFAULT_PROFILE: CaptureProfile = "standard";

export async function captureActiveTab(profile: CaptureProfile = DEFAULT_PROFILE) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!activeTab?.id) {
    throw new Error("No active tab available for capture.");
  }
  return captureTab(activeTab.id, profile);
}

export async function retryTask(taskId: string, profileOverride?: CaptureProfile) {
  const task = await getCaptureTask(taskId);
  if (!task) {
    throw new Error("Task not found.");
  }
  const retryProfile = profileOverride ?? task.profile;
  if (
    retryProfile === task.profile &&
    task.status === "upload_pending" &&
    task.artifacts?.archiveHtml &&
    typeof task.artifacts.extractedText === "string" &&
    task.quality &&
    task.localArchiveSha256
  ) {
    return syncTask(task);
  }
  return captureSourceUrl(task.source.url, retryProfile);
}

export async function openTaskPreview(taskId: string) {
  const task = await getCaptureTask(taskId);
  if (!task?.artifacts?.archiveHtml) {
    throw new Error("Task archive HTML is not available for preview.");
  }
  const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(task.artifacts.archiveHtml)}`;
  await chrome.tabs.create({ url: previewUrl, active: true });
}

export async function listRecentTasks(limit = 20) {
  return listCaptureTasks(limit);
}

async function captureTab(
  tabId: number,
  profile: CaptureProfile,
  options: {
    captureScreenshot?: boolean;
  } = {},
) {
  const tab = await chrome.tabs.get(tabId);
  const source = buildInitialSource(tab);
  const now = new Date().toISOString();
  const task: CaptureTask = {
    id: createCaptureId(),
    status: "queued",
    profile,
    source,
    createdAt: now,
    updatedAt: now,
  };
  await putCaptureTask(task);
  await publishTask(task);

  try {
    let workingTask = await transitionCaptureTaskStatus(task.id, "capturing");
    await publishTask(workingTask);

    const liveResult = await sendMessageToTab<CollectLiveSignalsRequest, CollectLiveSignalsResponse>(
      tabId,
      {
        type: MESSAGE_TYPE.CollectLiveSignals,
      },
    );
    if (!liveResult.ok || !liveResult.liveSignals) {
      throw new Error(liveResult.error ?? "Failed to collect pre-capture signals.");
    }

    const mergedSource: CaptureSource = {
      ...workingTask.source,
      ...liveResult.sourcePatch,
    };
    workingTask = await patchCaptureTask(task.id, {
      source: mergedSource,
    });
    await publishTask(workingTask);

    const archiveResult = await sendMessageToTab<
      CaptureArchiveHtmlRequest,
      CaptureArchiveHtmlResponse
    >(tabId, {
      type: MESSAGE_TYPE.CaptureArchiveHtml,
      profile,
    });
    const archiveHtml = archiveResult.ok && archiveResult.archiveHtml
      ? archiveResult.archiveHtml
      : buildFallbackArchiveHtml(mergedSource, liveResult.liveSignals);
    const screenshotDataUrl = options.captureScreenshot === false
      ? null
      : await captureTabScreenshot(tab.windowId);
    const extractedText = extractTextFromHtml(archiveHtml);
    const archiveSignals = buildArchiveSignals(archiveHtml, screenshotDataUrl);
    const quality = evaluateQuality({
      liveSignals: liveResult.liveSignals,
      archiveSignals,
      missingIframeLikely: archiveSignals.iframeCount < liveResult.liveSignals.iframeCount,
    });
    const localArchiveSha256 = await computeSha256Hex(archiveHtml);

    workingTask = await transitionCaptureTaskStatus(task.id, "validating");
    await publishTask(workingTask);
    workingTask = await transitionCaptureTaskStatus(task.id, "local_ready", {
      localArchiveSha256,
      quality,
      artifacts: {
        archiveHtml,
        extractedText,
        screenshotDataUrl: screenshotDataUrl ?? undefined,
        meta: {
          usedSingleFile: archiveResult.ok && archiveResult.usedSingleFile === true,
        },
      },
    });
    await publishTask(workingTask);
    workingTask = await transitionCaptureTaskStatus(task.id, "upload_pending");
    await publishTask(workingTask);
    return syncTask(workingTask);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedTask = await transitionCaptureTaskStatus(task.id, "failed", {
      failureReason: message,
    });
    await publishTask(failedTask);
    return failedTask;
  }
}

async function captureSourceUrl(url: string, profile: CaptureProfile) {
  const retryTab = await chrome.tabs.create({
    url,
    active: false,
  });
  if (!retryTab.id) {
    throw new Error("Failed to open source page for retry.");
  }

  try {
    await waitForTabReady(retryTab.id);
    return await captureTab(retryTab.id, profile, {
      captureScreenshot: false,
    });
  } finally {
    try {
      await chrome.tabs.remove(retryTab.id);
    } catch {
      // Ignore: the temporary retry tab may already be closed.
    }
  }
}

async function syncTask(task: CaptureTask) {
  let workingTask = await transitionCaptureTaskStatus(task.id, "uploading", {
    failureReason: undefined,
  });
  await publishTask(workingTask);

  try {
    const syncResult = await syncTaskToApi(workingTask);
    workingTask = await transitionCaptureTaskStatus(task.id, "uploaded", {
      bookmarkId: syncResult.bookmarkId,
      versionId: syncResult.versionId,
      failureReason: undefined,
    });
    await publishTask(workingTask);
    workingTask = await transitionCaptureTaskStatus(task.id, "synced");
    await publishTask(workingTask);
    return workingTask;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workingTask = await transitionCaptureTaskStatus(task.id, "upload_pending", {
      failureReason: `同步失败，等待重试：${message}`,
    });
    await publishTask(workingTask);
    return workingTask;
  }
}

function buildInitialSource(tab: chrome.tabs.Tab): CaptureSource {
  const url = tab.url ?? "about:blank";
  const parsed = safeUrl(url);
  return {
    url,
    title: tab.title || parsed.hostname || "Untitled Page",
    canonicalUrl: url,
    domain: parsed.hostname || "unknown",
    faviconUrl: tab.favIconUrl,
    viewport: {
      width: 1280,
      height: 720,
    },
    savedAt: new Date().toISOString(),
  };
}

function safeUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    return new URL("https://invalid.local");
  }
}

function buildFallbackArchiveHtml(source: CaptureSource, liveSignals: CapturePageSignals) {
  const escapedTitle = escapeHtml(source.title);
  const escapedUrl = escapeHtml(source.url);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapedTitle}</title>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>KeepPage fallback archive was generated because SingleFile capture was unavailable.</p>
      <p>Source URL: <a href="${escapedUrl}">${escapedUrl}</a></p>
      <pre>${escapeHtml(JSON.stringify(liveSignals, null, 2))}</pre>
    </main>
  </body>
</html>`;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function extractTextFromHtml(html: string) {
  const withoutScripts = html
    .replaceAll(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  return withoutScripts
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function buildArchiveSignals(html: string, screenshotDataUrl: string | null): CapturePageSignals {
  return {
    textLength: extractTextFromHtml(html).length,
    imageCount: countMatches(html, /<img\b/gi),
    iframeCount: countMatches(html, /<iframe\b/gi),
    scrollHeight: 0,
    renderHeight: 0,
    fileSize: new TextEncoder().encode(html).length,
    hasCanvas: /<canvas\b/gi.test(html),
    hasVideo: /<video\b/gi.test(html),
    previewable: true,
    screenshotGenerated: Boolean(screenshotDataUrl),
  };
}

function countMatches(text: string, pattern: RegExp) {
  const matched = text.match(pattern);
  return matched ? matched.length : 0;
}

async function captureTabScreenshot(windowId?: number): Promise<string | null> {
  try {
    return await new Promise((resolve, reject) => {
      const onCaptured = (dataUrl: string) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(dataUrl);
      };
      if (typeof windowId === "number") {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, onCaptured);
        return;
      }
      chrome.tabs.captureVisibleTab({ format: "png" }, onCaptured);
    });
  } catch {
    return null;
  }
}

async function computeSha256Hex(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function publishTask(task: CaptureTask) {
  const event: TaskUpdatedEvent = {
    type: MESSAGE_TYPE.TaskUpdated,
    task,
  };
  try {
    await chrome.runtime.sendMessage(event);
  } catch {
    // Ignore: panel might not be open.
  }
}

async function sendMessageToTab<TRequest, TResponse>(
  tabId: number,
  message: TRequest,
) {
  return chrome.tabs.sendMessage(tabId, message) as Promise<TResponse>;
}

async function waitForTabReady(tabId: number, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out while waiting for retry tab to load."));
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: {
        status?: string;
      },
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}
