import type {
  SaveMode,
  CaptureTaskOwner,
  CapturePageSignals,
  CaptureProfile,
  CaptureScope,
  CaptureSource,
  CaptureTask,
} from "@keeppage/domain";
import {
  getCaptureTask,
  listCaptureTasks,
  patchCaptureTask,
  putCaptureTask,
  transitionCaptureTaskStatus,
} from "./capture-queue";
import {
  buildPrivateTaskShell,
  getPrivateTask,
  listPrivateTasks,
  patchPrivateTaskShell,
  putPrivateTaskPayload,
  putPrivateTaskShell,
  requirePrivateVaultUnlocked,
} from "./private-vault";
import {
  MESSAGE_TYPE,
  type CaptureArchiveHtmlRequest,
  type CaptureArchiveHtmlResponse,
  type CollectLiveSignalsRequest,
  type CollectLiveSignalsResponse,
  type ShowInPageToastRequest,
  type ShowInPageToastResponse,
  type TaskUpdatedEvent,
} from "./messages";
import {
  getRefreshRequiredMessage,
  isStaleExtensionContextError,
} from "./extension-errors";
import {
  createCaptureId,
  ensureArchiveBaseHref,
  evaluateQuality,
} from "./domain-runtime";
import { emitDebugLogToTab } from "./debug-log";
import { getStoredAuthUser } from "./auth-storage";
import { createLogger } from "./logger";
import { syncTaskToApi } from "./sync-api";

const DEFAULT_PROFILE: CaptureProfile = "standard";
const logger = createLogger("capture");

export async function captureActiveTab(
  profile: CaptureProfile = DEFAULT_PROFILE,
  saveMode: SaveMode = "standard",
  captureScope: CaptureScope = "page",
) {
  const owner = await requireCurrentTaskOwner();
  if (saveMode === "private") {
    await requirePrivateVaultUnlocked();
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!activeTab?.id) {
    throw new Error("No active tab available for capture.");
  }
  logCapture(saveMode, "info", activeTab.id, "Starting capture for active tab.", {
    tabId: activeTab.id,
    url: activeTab.url,
    profile,
    captureScope,
    ownerUserId: owner.userId,
  });
  return captureTab(activeTab.id, profile, owner, saveMode, captureScope);
}

export async function retryTask(
  taskId: string,
  profileOverride?: CaptureProfile,
  saveModeOverride?: SaveMode,
) {
  const owner = await requireCurrentTaskOwner();
  const saveMode = saveModeOverride ?? "standard";
  const standardTask = saveMode === "standard" ? await getCaptureTask(taskId) : null;
  const privateTask = saveMode === "private"
    ? await getPrivateTask(taskId, owner.userId)
    : null;
  const task = standardTask ?? privateTask;
  if (!task) {
    throw new Error("Task not found.");
  }
  if (task.isPrivate) {
    await requirePrivateVaultUnlocked();
  }
  assertTaskOwnership(task, owner);
  logger.info("Retry requested.", {
    taskId,
    taskStatus: task.status,
    profileOverride,
    ownerUserId: owner.userId,
  });
  const retryProfile = profileOverride ?? task.profile;
  if (
    saveMode === "standard" &&
    retryProfile === task.profile &&
    task.status === "upload_pending" &&
    task.artifacts?.archiveHtml &&
    typeof task.artifacts.extractedText === "string" &&
    task.quality &&
      task.localArchiveSha256
  ) {
    return syncTask(task);
  }
  if (task.source.captureScope === "selection") {
    throw new Error("选区存档暂不支持重新抓取，请回到原网页重新选择后再保存。");
  }
  return captureSourceUrl(task.source.url, retryProfile, task.isPrivate ? "private" : "standard");
}

export async function openTaskPreview(taskId: string) {
  const owner = await requireCurrentTaskOwner();
  const task = await getCaptureTask(taskId)
    ?? await getPrivateTask(taskId, owner.userId);
  if (!task?.artifacts?.archiveHtml) {
    throw new Error("Task archive HTML is not available for preview.");
  }
  if (task.isPrivate) {
    await requirePrivateVaultUnlocked();
  }
  assertTaskOwnership(task, owner);
  const previewHtml = ensureArchiveBaseHref(
    task.artifacts.archiveHtml,
    task.source.canonicalUrl ?? task.source.url,
  );
  const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`;
  await chrome.tabs.create({ url: previewUrl, active: true });
}

export async function listRecentTasks(limit = 20, saveMode: SaveMode = "standard") {
  const owner = await getStoredTaskOwner();
  if (!owner) {
    return [];
  }
  if (saveMode === "private") {
    return listPrivateTasks(limit, owner.userId);
  }
  return listCaptureTasks(limit, owner.userId);
}

async function captureTab(
  tabId: number,
  profile: CaptureProfile,
  owner: CaptureTaskOwner,
  saveMode: SaveMode,
  captureScope: CaptureScope,
  options: {
    captureScreenshot?: boolean;
  } = {},
) {
  const tab = await chrome.tabs.get(tabId);
  const source = buildInitialSource(tab, captureScope);
  const now = new Date().toISOString();
  const task: CaptureTask = {
    id: createCaptureId(),
    status: "queued",
    saveMode,
    isPrivate: saveMode === "private",
    privateMode: saveMode === "private" ? "local-only" : undefined,
    syncState: saveMode === "private" ? "local-only" : undefined,
    profile,
    owner,
    source,
    createdAt: now,
    updatedAt: now,
  };
  if (saveMode === "private") {
    await putPrivateTaskShell(
      buildPrivateTaskShell({
        id: task.id,
        status: task.status,
        owner,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } else {
    await putCaptureTask(task);
  }
  await publishTaskByMode(task.id, saveMode, owner.userId);
  await logCapture(saveMode, "info", tabId, "Task queued.", {
    taskId: task.id,
    tabId,
    url: source.url,
    profile,
    ownerUserId: owner.userId,
  });
  await logCapture(saveMode, "debug", tabId, "Initial capture source prepared.", {
    taskId: task.id,
    source,
  });

  try {
    let workingTask = saveMode === "private"
      ? {
          ...task,
          status: "capturing" as const,
          updatedAt: new Date().toISOString(),
        }
      : await transitionCaptureTaskStatus(task.id, "capturing");
    if (saveMode === "private") {
      await patchPrivateTaskShell(task.id, {
        status: "capturing",
      });
    }
    await publishTaskByMode(task.id, saveMode, owner.userId);
    await logCapture(saveMode, "info", tabId, "Collecting live page signals.", {
      taskId: task.id,
      tabId,
    });

    const liveResult = await sendMessageToTab<CollectLiveSignalsRequest, CollectLiveSignalsResponse>(
      tabId,
      {
        type: MESSAGE_TYPE.CollectLiveSignals,
        captureScope,
      },
    );
    if (!liveResult.ok || !liveResult.liveSignals) {
      throw new Error(liveResult.error ?? "Failed to collect pre-capture signals.");
    }
    await logCapture(saveMode, "info", tabId, "Live page signals collected.", {
      taskId: task.id,
      liveSignals: liveResult.liveSignals,
    });

    const mergedSource: CaptureSource = {
      ...workingTask.source,
      ...liveResult.sourcePatch,
    };
    await logCapture(saveMode, "debug", tabId, "Merged capture source after live signals.", {
      taskId: task.id,
      sourcePatch: liveResult.sourcePatch,
      mergedSource,
    });
    workingTask = {
      ...workingTask,
      source: mergedSource,
      updatedAt: new Date().toISOString(),
    };
    if (saveMode === "standard") {
      workingTask = await patchCaptureTask(task.id, {
        source: mergedSource,
      });
    }
    await publishTaskByMode(task.id, saveMode, owner.userId);

    const archiveResult = await sendMessageToTab<
      CaptureArchiveHtmlRequest,
      CaptureArchiveHtmlResponse
    >(tabId, {
      type: MESSAGE_TYPE.CaptureArchiveHtml,
      profile,
      captureScope,
    });
    await logCapture(saveMode, "info", tabId, "Archive capture finished.", {
      taskId: task.id,
      archiveOk: archiveResult.ok,
      usedSingleFile: archiveResult.ok ? archiveResult.usedSingleFile : undefined,
      error: archiveResult.ok ? undefined : archiveResult.error,
    });
    const rawArchiveHtml = archiveResult.ok && archiveResult.archiveHtml
      ? archiveResult.archiveHtml
      : buildFallbackArchiveHtml(mergedSource, liveResult.liveSignals);
    const archiveHtml = ensureArchiveBaseHref(
      rawArchiveHtml,
      mergedSource.canonicalUrl ?? mergedSource.url,
    );
    const readerHtml = archiveResult.ok && archiveResult.readerHtml
      ? ensureArchiveBaseHref(
          archiveResult.readerHtml,
          mergedSource.canonicalUrl ?? mergedSource.url,
        )
      : undefined;
    if (!archiveResult.ok) {
      await logCapture(saveMode, "warn", tabId, "Using fallback archive HTML.", {
        taskId: task.id,
        reason: archiveResult.error,
      });
    }
    const screenshotDataUrl = options.captureScreenshot === false
      ? null
      : await captureTabScreenshot(tab.windowId);
    const extractedText = extractTextFromHtml(readerHtml ?? archiveHtml);
    const archiveSignals = buildArchiveSignals(archiveHtml, screenshotDataUrl);
    const quality = evaluateQuality({
      liveSignals: liveResult.liveSignals,
      archiveSignals,
      missingIframeLikely: archiveSignals.iframeCount < liveResult.liveSignals.iframeCount,
    });
    const localArchiveSha256 = await computeSha256Hex(archiveHtml);
    await logCapture(saveMode, "debug", tabId, "Archive diagnostics computed.", {
      taskId: task.id,
      archiveSignals,
      liveSignals: liveResult.liveSignals,
    });
    await logCapture(saveMode, "info", tabId, "Archive prepared locally.", {
      taskId: task.id,
      archiveSize: archiveHtml.length,
      readerArchiveSize: readerHtml?.length,
      extractedTextLength: extractedText.length,
      quality,
      localArchiveSha256,
      screenshotCaptured: Boolean(screenshotDataUrl),
    });

    if (saveMode === "private") {
      await patchPrivateTaskShell(task.id, {
        status: "validating",
      });
      await publishTaskByMode(task.id, saveMode, owner.userId);
      await patchPrivateTaskShell(task.id, {
        status: "local_ready",
      });
      await putPrivateTaskPayload(task.id, {
        profile,
        source: mergedSource,
        localArchiveSha256,
        quality,
        artifacts: {
          archiveHtml,
          readerHtml,
          extractedText,
          screenshotDataUrl: screenshotDataUrl ?? undefined,
          downloadableMedia: archiveResult.ok ? archiveResult.downloadableMedia ?? [] : [],
          meta: {
            usedSingleFile: archiveResult.ok && archiveResult.usedSingleFile === true,
          },
        },
      });
      const privateTask = await getPrivateTask(task.id, owner.userId);
      await publishTaskByMode(task.id, saveMode, owner.userId);
      if (!privateTask) {
        throw new Error("Private task saved but could not be reloaded.");
      }
      await showInPageSuccessToast(tabId, privateTask);
      await logCapture(saveMode, "info", tabId, "Private task stored locally.", {
        taskId: task.id,
      });
      return privateTask;
    }

    workingTask = await transitionCaptureTaskStatus(task.id, "validating");
    await publishTaskByMode(task.id, saveMode, owner.userId);
    workingTask = await transitionCaptureTaskStatus(task.id, "local_ready", {
      localArchiveSha256,
      quality,
      artifacts: {
        archiveHtml,
        readerHtml,
        extractedText,
        screenshotDataUrl: screenshotDataUrl ?? undefined,
        downloadableMedia: archiveResult.ok ? archiveResult.downloadableMedia ?? [] : [],
        meta: {
          usedSingleFile: archiveResult.ok && archiveResult.usedSingleFile === true,
        },
      },
    });
    await publishTaskByMode(task.id, saveMode, owner.userId);
    workingTask = await transitionCaptureTaskStatus(task.id, "upload_pending");
    await publishTaskByMode(task.id, saveMode, owner.userId);
    await logCapture(saveMode, "info", tabId, "Task ready for upload.", {
      taskId: task.id,
    });
    return syncTask(workingTask, tabId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logCapture(saveMode, "error", tabId, "Capture pipeline failed.", {
      taskId: task.id,
      tabId,
      error: message,
    });
    if (saveMode === "private") {
      await patchPrivateTaskShell(task.id, {
        status: "failed",
        failureReason: "私密保存失败，请重试。",
      });
      await publishTaskByMode(task.id, saveMode, owner.userId);
      const failedTask = await getPrivateTask(task.id, owner.userId);
      if (!failedTask) {
        throw error;
      }
      return failedTask;
    }
    const failedTask = await transitionCaptureTaskStatus(task.id, "failed", {
      failureReason: message,
    });
    await publishTaskByMode(task.id, saveMode, owner.userId);
    return failedTask;
  }
}

async function captureSourceUrl(
  url: string,
  profile: CaptureProfile,
  saveMode: SaveMode = "standard",
) {
  const owner = await requireCurrentTaskOwner();
  if (saveMode === "private") {
    await requirePrivateVaultUnlocked();
  }
  logger.info("Opening temporary tab for retry capture.", {
    profile,
    saveMode,
    ownerUserId: owner.userId,
  });
  const retryTab = await chrome.tabs.create({
    url,
    active: false,
  });
  if (!retryTab.id) {
    throw new Error("Failed to open source page for retry.");
  }

  try {
    await waitForTabReady(retryTab.id);
    logger.debug("Temporary retry tab is ready.", {
      retryTabId: retryTab.id,
      url,
    });
    return await captureTab(retryTab.id, profile, owner, saveMode, "page", {
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

async function syncTask(task: CaptureTask, debugTabId?: number) {
  const owner = await requireCurrentTaskOwner();
  assertTaskOwnership(task, owner);
  let workingTask = await transitionCaptureTaskStatus(task.id, "uploading", {
    failureReason: undefined,
  });
  await publishTaskByMode(task.id, "standard", owner.userId);
  await logCapture("standard", "info", debugTabId, "Uploading task to API.", {
    taskId: task.id,
    url: task.source.url,
  });

  try {
    const syncResult = await syncTaskToApi(workingTask, debugTabId);
    workingTask = await transitionCaptureTaskStatus(task.id, "uploaded", {
      bookmarkId: syncResult.bookmarkId,
      versionId: syncResult.versionId,
      failureReason: undefined,
    });
    await publishTaskByMode(task.id, "standard", owner.userId);
    workingTask = await transitionCaptureTaskStatus(task.id, "synced");
    await publishTaskByMode(task.id, "standard", owner.userId);
    await showInPageSuccessToast(debugTabId, workingTask);
    await logCapture("standard", "info", debugTabId, "Task synced successfully.", {
      taskId: task.id,
      bookmarkId: syncResult.bookmarkId,
      versionId: syncResult.versionId,
    });
    return workingTask;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logCapture("standard", "error", debugTabId, "Task sync failed.", {
      taskId: task.id,
      error: message,
    });
    workingTask = await transitionCaptureTaskStatus(task.id, "upload_pending", {
      failureReason: `同步失败，等待重试：${message}`,
    });
    await publishTaskByMode(task.id, "standard", owner.userId);
    return workingTask;
  }
}

async function showInPageSuccessToast(tabId: number | undefined, task: CaptureTask) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await sendMessageToTab<ShowInPageToastRequest, ShowInPageToastResponse>(tabId, {
      type: MESSAGE_TYPE.ShowInPageToast,
      title: task.isPrivate
        ? task.source.captureScope === "selection"
          ? "已私密保存选中区域"
          : "已私密保存到 KeepPage"
        : task.source.captureScope === "selection"
        ? "已保存选中区域到 KeepPage"
        : "已保存到 KeepPage",
      message: buildTaskSyncedMessage(task),
      tone: "success",
    });
  } catch (error) {
    logger.warn("Failed to show in-page success toast.", {
      taskId: task.id,
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildTaskSyncedMessage(task: CaptureTask) {
  if (task.isPrivate) {
    return "内容已加密写入当前设备的私密库。";
  }
  const pageTitle = task.source.title.trim() || task.source.url;
  return pageTitle.length > 84 ? `${pageTitle.slice(0, 81)}...` : pageTitle;
}

async function getStoredTaskOwner(): Promise<CaptureTaskOwner | null> {
  const authUser = await getStoredAuthUser();
  if (!authUser) {
    return null;
  }
  return {
    userId: authUser.id,
    email: authUser.email,
    name: authUser.name,
  };
}

async function requireCurrentTaskOwner(): Promise<CaptureTaskOwner> {
  const owner = await getStoredTaskOwner();
  if (!owner) {
    throw new Error("请先在扩展里登录账号，再开始保存网页。");
  }
  return owner;
}

function assertTaskOwnership(task: CaptureTask, owner: CaptureTaskOwner) {
  if (!task.owner) {
    throw new Error("这条本地任务没有账号归属，请重新抓取后再同步。");
  }
  if (task.owner.userId !== owner.userId) {
    throw new Error(`这条本地任务属于 ${task.owner.email}，请切回对应账号后再操作。`);
  }
}

function buildInitialSource(tab: chrome.tabs.Tab, captureScope: CaptureScope): CaptureSource {
  const url = tab.url ?? "about:blank";
  const parsed = safeUrl(url);
  return {
    url,
    title: tab.title || parsed.hostname || "Untitled Page",
    canonicalUrl: url,
    domain: parsed.hostname || "unknown",
    faviconUrl: tab.favIconUrl,
    captureScope,
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
    logger.warn("Capture screenshot failed, continuing without screenshot.", {
      windowId,
    });
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

async function publishTaskByMode(taskId: string, saveMode: SaveMode, ownerUserId: string) {
  const task = saveMode === "private"
    ? await getPrivateTask(taskId, ownerUserId)
    : await getCaptureTask(taskId);
  if (!task) {
    return;
  }
  await publishTask(task);
}

async function sendMessageToTab<TRequest, TResponse>(
  tabId: number,
  message: TRequest,
) {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as TResponse;
  } catch (error) {
    if (isStaleExtensionContextError(error)) {
      logger.warn("Tab message failed because content script is stale.", {
        tabId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(getRefreshRequiredMessage());
    }
    logger.error("Tab message failed.", {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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

async function logCapture(
  saveMode: SaveMode,
  level: "debug" | "info" | "warn" | "error",
  tabId: number | undefined,
  message: string,
  details?: unknown,
) {
  const sanitizedDetails = saveMode === "private"
    ? sanitizePrivateCaptureLogDetails(details)
    : details;
  logger[level](message, sanitizedDetails);
  await emitDebugLogToTab(tabId, "capture", level, message, sanitizedDetails);
}

function sanitizePrivateCaptureLogDetails(details: unknown) {
  if (!details || typeof details !== "object") {
    return undefined;
  }
  const maybe = details as Record<string, unknown>;
  return {
    taskId: typeof maybe.taskId === "string" ? maybe.taskId : undefined,
    status: typeof maybe.status === "string" ? maybe.status : undefined,
    profile: typeof maybe.profile === "string" ? maybe.profile : undefined,
    ownerUserId: typeof maybe.ownerUserId === "string" ? maybe.ownerUserId : undefined,
  };
}
