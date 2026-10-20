import { defineBackground } from "wxt/utils/define-background";
import {
  captureActiveTab,
  captureTabById,
  listRecentTasks,
  openTaskPreview,
  retryTask,
} from "../src/lib/capture-pipeline";
import { drainLocalArchiveQueue, enqueueLocalArchiveQueue } from "../src/lib/local-archive-queue";
import {
  MESSAGE_TYPE,
  isBackgroundRequest,
  type ListTasksResponse,
  type MoveActiveTabBookmarkToPrivateResponse,
  type ShowInPageToastRequest,
} from "../src/lib/messages";
import {
  getRefreshRequiredMessage,
  isStaleExtensionContextError,
} from "../src/lib/extension-errors";
import { createLogger } from "../src/lib/logger";
import { getFetchChunkSize } from "../src/lib/singlefile-fetch";
import { refreshAllBookmarkIcons } from "../src/lib/sync-api";
import {
  createLinkBookmark,
  deleteBookmark,
  fetchBookmarkStatus,
} from "../src/lib/bookmark-metadata-api";
import {
  captureProfileSchema,
  captureScopeSchema,
  privateAutoLockSchema,
  saveModeSchema,
} from "../src/lib/domain-runtime";
import {
  recoverUnauthorizedSession,
  openExtensionAuthPage,
  openWorkspaceUi,
  redeemExtensionConnectCode,
  openSidePanelForWindow,
  validateStoredAuthSession,
} from "../src/lib/auth-flow";
import {
  createPrivateVault,
  getPrivateVaultSummary,
  lockPrivateVault,
  requirePrivateVaultUnlocked,
  setPrivateAutoLock,
  unlockPrivateVault,
} from "../src/lib/private-vault";

const singleFileTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const logger = createLogger("background");
const BOOKMARKED_BADGE_COLOR = "#16a34a";
const BOOKMARKED_BADGE_TEXT = "✓";
const ERROR_BADGE_COLOR = "#dc2626";
const ERROR_BADGE_TEXT = "!";
const SIDE_PANEL_SAVE_MODE_INTENT_KEY = "sidePanelSaveModeIntent";
const SIDE_PANEL_NOTICE_KEY = "sidePanelNotice";
const PENDING_PRIVATE_CAPTURE_KEY = "pendingPrivateCapture";
const PENDING_PRIVATE_CAPTURE_TTL_MS = 10 * 60 * 1000;

type SaveModeValue = "standard" | "private";

interface PendingPrivateCapture {
  tabId: number;
  url: string;
  requestedAt: number;
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    logger.info("Extension installed or updated, registering context menu.");
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "keeppage-save-page",
        title: "保存到 KeepPage",
        contexts: ["page", "action"],
      });
      chrome.contextMenus.create({
        id: "keeppage-save-link",
        title: "仅保存为书签（不存档）",
        contexts: ["page", "action"],
      });
      chrome.contextMenus.create({
        id: "keeppage-save-page-private",
        title: "保存到 KP 私密模式",
        contexts: ["page", "action"],
      });
    });
    void drainLocalArchiveQueue();
    void refreshActiveTabBookmarkBadge();
  });

  chrome.runtime.onStartup?.addListener(() => {
    logger.info("Extension startup detected, resuming local archive queue.");
    void drainLocalArchiveQueue();
    void refreshActiveTabBookmarkBadge();
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId !== "keeppage-save-page" &&
      info.menuItemId !== "keeppage-save-link" &&
      info.menuItemId !== "keeppage-save-page-private"
    ) {
      return;
    }
    if (!tab?.id) {
      return;
    }
    if (info.menuItemId === "keeppage-save-link") {
      void (async () => {
        if (!await ensureAuthenticated("context-menu-link-bookmark")) {
          return;
        }
        await saveTabAsLinkBookmark(tab);
      })();
      return;
    }
    const saveMode = info.menuItemId === "keeppage-save-page-private" ? "private" : "standard";
    logger.info("Context menu capture requested.", {
      tabId: tab.id,
      url: tab.url,
      saveMode,
    });
    startQuickCapture(tab, saveMode, "context-menu");
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    logger.info("Command received.", { command });
    if (command === "save-current-page") {
      if (tab?.id != null) {
        startQuickCapture(tab, "standard", "keyboard-shortcut");
        return;
      }
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([activeTab]) => {
        if (activeTab?.id != null) {
          startQuickCapture(activeTab, "standard", "keyboard-shortcut");
        }
      });
      return;
    }
    if (command === "open-side-panel") {
      if (tab?.windowId != null) {
        void openSidePanelForWindow(tab.windowId);
        return;
      }
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([activeTab]) => {
        if (activeTab?.windowId != null) {
          void openSidePanelForWindow(activeTab.windowId);
        }
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isSingleFileRuntimeMessage(message)) {
      logger.info("SingleFile runtime message received.", {
        method: message.method,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      });
      void handleSingleFileRuntimeMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          logger.error("SingleFile runtime message failed.", {
            method: message.method,
            error: error instanceof Error ? error.message : String(error),
          });
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (!isBackgroundRequest(message)) {
      return false;
    }

    void (async () => {
      if (message.type === MESSAGE_TYPE.ListTasks) {
        const saveMode = saveModeSchema.parse(message.saveMode ?? "standard");
        logger.info("Listing recent tasks.", {
          limit: message.limit ?? 20,
          saveMode,
        });
        const tasks = await listRecentTasks(message.limit ?? 20, saveMode);
        const response: ListTasksResponse = {
          ok: true,
          tasks,
        };
        sendResponse(response);
        return;
      }
      if (message.type === MESSAGE_TYPE.StartSelectionCapture) {
        const saveMode = saveModeSchema.parse(message.saveMode ?? "standard");
        if (!await ensureAuthenticated("selection-capture")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const profile = captureProfileSchema.parse(message.profile ?? "standard");
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (!tab?.id) {
          sendResponse({ ok: false, error: "当前没有可操作的标签页。" });
          return;
        }
        logger.info("Starting interactive selection capture.", {
          profile,
          saveMode,
          tabId: tab.id,
          url: tab.url,
        });
        const response = await sendMessageToTab(tab.id, {
          type: MESSAGE_TYPE.StartSelectionCapture,
          profile,
          saveMode,
        });
        sendResponse(response);
        return;
      }
      if (
        message.type === MESSAGE_TYPE.SaveActiveTabAsBookmark ||
        message.type === MESSAGE_TYPE.ToggleActiveTabBookmark
      ) {
        if (!await ensureAuthenticated("toolbar-bookmark")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const [activeTab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (!activeTab) {
          sendResponse({ ok: false, error: "当前没有可操作的标签页。" });
          return;
        }
        const result = message.type === MESSAGE_TYPE.ToggleActiveTabBookmark
          ? await toggleBookmarkForTab(activeTab)
          : await createBookmarkForTab(activeTab);
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message.type === MESSAGE_TYPE.TriggerCaptureActiveTab) {
        const saveMode = saveModeSchema.parse(message.saveMode ?? "standard");
        if (!await ensureAuthenticated("sidepanel-capture")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const profile = captureProfileSchema.parse(message.profile ?? "standard");
        const captureScope = captureScopeSchema.parse(message.captureScope ?? "page");
        const [activeTab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        logger.info("Triggering active-tab capture.", { profile, saveMode, captureScope });
        const task = await captureActiveTab(profile, saveMode, captureScope);
        if (saveMode === "standard" && typeof activeTab?.id === "number") {
          void refreshTabBookmarkBadge(activeTab.id);
        }
        sendResponse({ ok: true, task });
        return;
      }
      if (message.type === MESSAGE_TYPE.EnqueueLocalArchiveQueue) {
        if (!await ensureAuthenticated("web-local-archive-queue")) {
          sendResponse({ ok: false, error: "请先在本地插件里登录 KeepPage。" });
          return;
        }
        const items = normalizeLocalArchiveQueueItems(message.items);
        const result = await enqueueLocalArchiveQueue(items);
        sendResponse({
          ok: true,
          acceptedCount: result.acceptedCount,
          skippedCount: result.skippedCount,
          queueSize: result.queueSize,
        });
        return;
      }
      if (message.type === MESSAGE_TYPE.RedeemExtensionConnectCode) {
        const session = await redeemExtensionConnectCode({
          apiBaseUrl: message.apiBaseUrl,
          code: message.code,
          connectNonce: message.connectNonce,
        });
        const currentWindow = await chrome.windows.getCurrent().catch(() => null);
        if (currentWindow?.id != null) {
          void openWorkspaceUi(currentWindow.id);
        }
        sendResponse({
          ok: true,
          user: session.user,
        });
        return;
      }
      if (message.type === MESSAGE_TYPE.RetryTask) {
        if (!await ensureAuthenticated("retry-task")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const profile = message.profile
          ? captureProfileSchema.parse(message.profile)
          : undefined;
        const saveMode = message.saveMode
          ? saveModeSchema.parse(message.saveMode)
          : undefined;
        logger.info("Retrying task.", {
          taskId: message.taskId,
          profile,
          saveMode,
        });
        const task = await retryTask(message.taskId, profile, saveMode);
        sendResponse({ ok: true, task });
        return;
      }
      if (message.type === MESSAGE_TYPE.OpenTaskPreview) {
        logger.info("Opening task preview.", {
          taskId: message.taskId,
        });
        await openTaskPreview(message.taskId);
        sendResponse({ ok: true });
        return;
      }
      if (message.type === MESSAGE_TYPE.GetPrivateVaultState) {
        const summary = await getPrivateVaultSummary();
        sendResponse({ ok: true, summary });
        return;
      }
      if (message.type === MESSAGE_TYPE.CreatePrivateVault) {
        const result = await createPrivateVault({
          passphrase: message.passphrase,
          autoLock: privateAutoLockSchema.parse(message.autoLock),
        });
        sendResponse({
          ok: true,
          summary: result.summary,
        });
        void resumePendingPrivateCapture();
        return;
      }
      if (message.type === MESSAGE_TYPE.UnlockPrivateVault) {
        const summary = await unlockPrivateVault(message.passphrase);
        sendResponse({ ok: true, summary });
        void resumePendingPrivateCapture();
        return;
      }
      if (message.type === MESSAGE_TYPE.SetPrivateAutoLock) {
        const summary = await setPrivateAutoLock(privateAutoLockSchema.parse(message.autoLock));
        sendResponse({ ok: true, summary });
        return;
      }
      if (message.type === MESSAGE_TYPE.LockPrivateVault) {
        const summary = await lockPrivateVault();
        sendResponse({ ok: true, summary });
        return;
      }
      if (message.type === MESSAGE_TYPE.RefreshAllBookmarkIcons) {
        if (!await ensureAuthenticated("refresh-all-bookmark-icons")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const result = await refreshAllBookmarkIcons();
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message.type === MESSAGE_TYPE.MoveActiveTabBookmarkToPrivate) {
        if (!await ensureAuthenticated("toolbar-move-to-private")) {
          sendResponse({ ok: false, error: "请先登录 KeepPage。" });
          return;
        }
        const [activeTab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (typeof activeTab?.id !== "number" || !isBookmarkablePageUrl(activeTab.url)) {
          sendResponse({ ok: false, error: "当前页面不支持私密保存。" });
          return;
        }
        sendResponse(await moveTabBookmarkToPrivate(activeTab, message.bookmarkId));
        return;
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Background request failed.", { error: message });
      sendResponse({ ok: false, error: message });
    });

    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const key of [...singleFileTimeouts.keys()]) {
      if (key.startsWith(`${tabId}:`)) {
        const timeoutId = singleFileTimeouts.get(key);
        if (typeof timeoutId === "number") {
          clearTimeout(timeoutId);
        }
        singleFileTimeouts.delete(key);
      }
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void refreshTabBookmarkBadge(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      void refreshTabBookmarkBadge(tabId, tab.url);
    }
  });
});

async function ensureAuthenticated(trigger: string) {
  const session = await validateStoredAuthSession();
  if (session.ok) {
    return true;
  }

  if (session.reason === "unreachable") {
    logger.warn("Auth validation is temporarily unavailable, keeping stored session.", {
      trigger,
      error: session.message,
    });
    return true;
  }

  logger.info("Auth validation failed, redirecting to login.", {
    trigger,
    reason: session.reason,
  });
  if (session.reason === "unauthorized") {
    await recoverUnauthorizedSession(trigger);
    return false;
  }

  await openExtensionAuthPage(trigger);
  return false;
}

/**
 * Runs a context-menu / shortcut capture. Must be called synchronously from the
 * user-gesture listener: chrome.sidePanel.open() is rejected once the gesture
 * has been consumed by an await.
 */
function startQuickCapture(tab: chrome.tabs.Tab, saveMode: SaveModeValue, trigger: string) {
  void chrome.storage.session.set({
    [SIDE_PANEL_SAVE_MODE_INTENT_KEY]: saveMode,
  });
  if (tab.windowId != null) {
    void openSidePanelForWindow(tab.windowId);
  }
  void attemptQuickCapture(tab, saveMode, trigger);
}

async function attemptQuickCapture(tab: chrome.tabs.Tab, saveMode: SaveModeValue, trigger: string) {
  if (typeof tab.id !== "number") {
    return;
  }
  const tabId = tab.id;
  try {
    if (!await ensureAuthenticated(trigger)) {
      return;
    }
    if (saveMode === "private") {
      const summary = await getPrivateVaultSummary();
      if (!summary.enabled || !summary.unlocked) {
        await deferPrivateCapture(tab, summary.enabled);
        return;
      }
    }
    const task = await captureTabById(tabId, undefined, saveMode);
    if (task.status === "synced") {
      // Also clears an error badge left by an earlier failed attempt.
      void refreshTabBookmarkBadge(tabId);
      return;
    }
    await reportQuickCaptureFailure(
      tabId,
      saveMode,
      task.failureReason ?? "保存没有完成，请在侧边栏查看详情。",
    );
  } catch (error) {
    await reportQuickCaptureFailure(
      tabId,
      saveMode,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function deferPrivateCapture(tab: chrome.tabs.Tab, vaultEnabled: boolean) {
  if (typeof tab.id !== "number" || !tab.url) {
    return;
  }
  const pending: PendingPrivateCapture = {
    tabId: tab.id,
    url: tab.url,
    requestedAt: Date.now(),
  };
  await chrome.storage.session.set({
    [PENDING_PRIVATE_CAPTURE_KEY]: pending,
  });
  const message = vaultEnabled
    ? "私密模式已锁定，请在侧边栏输入私密密码，解锁后会自动保存当前页。"
    : "还没有启用私密模式，请先在侧边栏设置私密密码，启用后会自动保存当前页。";
  logger.info("Private capture deferred until vault is unlocked.", {
    tabId: tab.id,
    vaultEnabled,
  });
  await setSidePanelNotice(message, "private");
  await showTabToast(tab.id, {
    title: vaultEnabled ? "私密模式已锁定" : "私密模式未启用",
    message,
    tone: "info",
  });
}

async function resumePendingPrivateCapture() {
  const result = await chrome.storage.session.get(PENDING_PRIVATE_CAPTURE_KEY);
  const pending = result[PENDING_PRIVATE_CAPTURE_KEY] as PendingPrivateCapture | undefined;
  if (!pending) {
    return;
  }
  await chrome.storage.session.remove(PENDING_PRIVATE_CAPTURE_KEY);
  if (Date.now() - pending.requestedAt > PENDING_PRIVATE_CAPTURE_TTL_MS) {
    logger.info("Pending private capture expired.", { tabId: pending.tabId });
    return;
  }
  const tab = await chrome.tabs.get(pending.tabId).catch(() => null);
  if (!tab?.id || tab.url !== pending.url) {
    await setSidePanelNotice("待私密保存的网页已关闭或已跳转，请回到该页面重新保存。", "private");
    return;
  }
  logger.info("Resuming pending private capture.", { tabId: tab.id });
  await attemptQuickCapture(tab, "private", "private-vault-unlocked");
}

async function reportQuickCaptureFailure(tabId: number, saveMode: SaveModeValue, reason: string) {
  logger.warn("Quick capture failed.", { tabId, saveMode, error: reason });
  const title = saveMode === "private" ? "私密保存失败" : "保存到 KeepPage 失败";
  await setSidePanelNotice(`${title}：${reason}`, saveMode);
  await showTabToast(tabId, { title, message: reason, tone: "error" });
  try {
    await chrome.action.setBadgeText({ tabId, text: ERROR_BADGE_TEXT });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ERROR_BADGE_COLOR });
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
  } catch {
    // Ignore: the tab may already be closed.
  }
}

async function setSidePanelNotice(message: string, saveMode: SaveModeValue) {
  await chrome.storage.session.set({
    [SIDE_PANEL_NOTICE_KEY]: {
      message,
      saveMode,
      createdAt: Date.now(),
    },
  });
}

async function showTabToast(
  tabId: number,
  toast: Pick<ShowInPageToastRequest, "title" | "message" | "tone">,
) {
  try {
    await sendMessageToTab(tabId, {
      type: MESSAGE_TYPE.ShowInPageToast,
      ...toast,
    });
  } catch (error) {
    // Pages without the content script (chrome://, Web Store) cannot show a toast;
    // the side panel notice still surfaces the message.
    logger.debug("In-page toast unavailable.", {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function moveTabBookmarkToPrivate(
  tab: chrome.tabs.Tab,
  bookmarkId: string,
): Promise<MoveActiveTabBookmarkToPrivateResponse> {
  const tabId = tab.id as number;
  await requirePrivateVaultUnlocked();
  logger.info("Moving bookmark to private mode.", { tabId, bookmarkId });
  const task = await captureTabById(tabId, undefined, "private");
  if (task.status !== "synced") {
    return {
      ok: false,
      task,
      error: `私密保存没有完成，原书签已保留：${task.failureReason ?? "请在侧边栏查看详情。"}`,
    };
  }
  // Only remove the standard bookmark after the private copy is safely stored.
  try {
    await deleteBookmark(bookmarkId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn("Private copy saved but standard bookmark removal failed.", {
      bookmarkId,
      error: reason,
    });
    return {
      ok: true,
      task,
      warning: `已私密保存，但普通书签删除失败：${reason}`,
    };
  } finally {
    await refreshTabBookmarkBadge(tabId, tab.url);
  }
  return { ok: true, task };
}

async function saveTabAsLinkBookmark(tab: chrome.tabs.Tab) {
  try {
    await createBookmarkForTab(tab);
  } catch (error) {
    logger.warn("Link bookmark save failed.", {
      tabId: tab.id,
      url: tab.url,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function createBookmarkForTab(tab: chrome.tabs.Tab) {
  if (typeof tab.id !== "number" || !isBookmarkablePageUrl(tab.url)) {
    logger.warn("Link bookmark skipped for unsupported page.", {
      tabId: tab.id,
      url: tab.url,
    });
    throw new Error("当前页面不支持保存为书签。");
  }

  const title = tab.title?.trim() || tab.url;
  const result = await createLinkBookmark(tab.url, title);
  logger.info("Link bookmark saved without archive.", {
    tabId: tab.id,
    bookmarkId: result.bookmarkId,
    status: result.status,
    deduplicated: result.deduplicated,
  });
  await refreshTabBookmarkBadge(tab.id, tab.url);
  return {
    action: "saved" as const,
    bookmarkId: result.bookmarkId,
    source: {
      url: tab.url,
      title,
    },
  };
}

async function toggleBookmarkForTab(tab: chrome.tabs.Tab) {
  if (typeof tab.id !== "number" || !isBookmarkablePageUrl(tab.url)) {
    throw new Error("当前页面不支持收藏。");
  }

  const status = await fetchBookmarkStatus(tab.url);
  if (!status.exists) {
    return createBookmarkForTab(tab);
  }
  if (!status.bookmark) {
    throw new Error("已收藏页面缺少书签记录，请刷新后重试。");
  }

  await deleteBookmark(status.bookmark.id);
  logger.info("Link bookmark removed.", {
    tabId: tab.id,
    bookmarkId: status.bookmark.id,
  });
  await refreshTabBookmarkBadge(tab.id, tab.url);
  return {
    action: "removed" as const,
    source: {
      url: tab.url,
      title: tab.title?.trim() || status.bookmark.title || tab.url,
    },
  };
}

async function refreshActiveTabBookmarkBadge() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (typeof tab?.id === "number") {
    await refreshTabBookmarkBadge(tab.id, tab.url);
  }
}

async function refreshTabBookmarkBadge(tabId: number, tabUrl?: string) {
  try {
    const url = tabUrl ?? (await chrome.tabs.get(tabId)).url;
    if (!isBookmarkablePageUrl(url)) {
      await clearBookmarkBadge(tabId);
      return;
    }

    const status = await fetchBookmarkStatus(url);
    if (status.exists) {
      await chrome.action.setBadgeText({ tabId, text: BOOKMARKED_BADGE_TEXT });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BOOKMARKED_BADGE_COLOR });
      await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
      await chrome.action.setTitle({
        tabId,
        title: `已保存到 KeepPage：${status.bookmark?.title ?? url}；点击取消收藏`,
      });
      return;
    }

    await clearBookmarkBadge(tabId);
  } catch (error) {
    await clearBookmarkBadge(tabId);
    logger.debug("Bookmark badge refresh skipped.", {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clearBookmarkBadge(tabId: number) {
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: "将当前页面保存为 KeepPage 书签" });
}

function isBookmarkablePageUrl(url: string | undefined): url is string {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeLocalArchiveQueueItems(
  input: Array<{ url: string; title?: string; bookmarkId?: string }> | undefined,
) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: Array<{ url: string; title?: string; bookmarkId?: string }> = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) {
      continue;
    }
    normalized.push({
      url,
      title: typeof item.title === "string" ? item.title.trim() || undefined : undefined,
      bookmarkId: typeof item.bookmarkId === "string"
        ? item.bookmarkId.trim() || undefined
        : undefined,
    });
  }
  return normalized;
}

function isSingleFileRuntimeMessage(message: unknown): message is {
  method: string;
  [key: string]: unknown;
} {
  return Boolean(
    message &&
      typeof message === "object" &&
      "method" in message &&
      typeof (message as { method?: unknown }).method === "string" &&
      (message as { method: string }).method.startsWith("singlefile."),
  );
}

async function handleSingleFileRuntimeMessage(
  message: { method: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
) {
  if (message.method === "singlefile.fetch") {
    return handleSingleFileFetch(message as {
      url?: unknown;
      requestId?: unknown;
      headers?: unknown;
    }, sender);
  }
  if (message.method === "singlefile.fetchFrame") {
    return handleSingleFileFrameFetch(message, sender);
  }
  if (
    message.method === "singlefile.frameTree.initResponse" ||
    message.method === "singlefile.frameTree.ackInitRequest"
  ) {
    if (!sender.tab?.id) {
      return {};
    }
    await sendMessageToTab(sender.tab.id, message, { frameId: 0 });
    return {};
  }
  if (message.method === "singlefile.lazyTimeout.setTimeout") {
    return handleSingleFileLazyTimeout(message as {
      type?: unknown;
      delay?: unknown;
    }, sender);
  }
  if (message.method === "singlefile.lazyTimeout.clearTimeout") {
    return clearSingleFileLazyTimeout(message as { type?: unknown }, sender);
  }
  return {};
}

async function handleSingleFileFetch(
  message: { url?: unknown; requestId?: unknown; headers?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  if (!sender.tab?.id) {
    throw new Error("singlefile.fetch requires a tab sender.");
  }

  const resourceUrl = String(message.url ?? "");
  const requestId = Number(message.requestId ?? 0);
  const headers = new Headers(
    Array.isArray(message.headers) ? message.headers as Array<[string, string]> : [],
  );

  try {
    logger.info("Proxy fetching resource through background.", {
      requestId,
      resourceUrl,
      tabId: sender.tab.id,
    });
    const response = await fetch(resourceUrl, {
      headers,
      cache: "force-cache",
      credentials: "include",
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    const body = Array.from(new Uint8Array(await response.arrayBuffer()));
    await sendChunkedFetchResponse(sender.tab.id, sender.frameId, {
      requestId,
      status: response.status,
      headers: [...response.headers],
      array: body,
    });
  } catch (error) {
    logger.warn("Background resource fetch failed.", {
      requestId,
      resourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    await sendChunkedFetchResponse(sender.tab.id, sender.frameId, {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      array: [],
    });
  }

  return {};
}

async function handleSingleFileFrameFetch(
  message: { frameId?: unknown; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
) {
  if (!sender.tab?.id) {
    throw new Error("singlefile.fetchFrame requires a tab sender.");
  }
  return sendMessageToTab(sender.tab.id, message);
}

async function handleSingleFileLazyTimeout(
  message: { type?: unknown; delay?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  const key = buildTimeoutKey(sender.tab?.id, sender.frameId, String(message.type ?? ""));
  const previous = singleFileTimeouts.get(key);
  if (typeof previous === "number") {
    clearTimeout(previous);
  }

  const timeoutId = globalThis.setTimeout(async () => {
    singleFileTimeouts.delete(key);
    if (!sender.tab?.id) {
      return;
    }
    try {
      await sendMessageToTab(
        sender.tab.id,
        {
          method: "singlefile.lazyTimeout.onTimeout",
          type: String(message.type ?? ""),
        },
        typeof sender.frameId === "number" ? { frameId: sender.frameId } : undefined,
      );
    } catch {
      // Ignore delivery failures when the frame has gone away.
    }
  }, Number(message.delay ?? 0));

  singleFileTimeouts.set(key, timeoutId);
  return {};
}

async function clearSingleFileLazyTimeout(
  message: { type?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  const key = buildTimeoutKey(sender.tab?.id, sender.frameId, String(message.type ?? ""));
  const timeoutId = singleFileTimeouts.get(key);
  if (typeof timeoutId === "number") {
    clearTimeout(timeoutId);
    singleFileTimeouts.delete(key);
  }
  return {};
}

async function sendChunkedFetchResponse(
  tabId: number,
  frameId: number | undefined,
  payload: {
    requestId: number;
    status?: number;
    headers?: Array<[string, string]>;
    array: number[];
    error?: string;
  },
) {
  const chunkSize = getFetchChunkSize();
  if (payload.array.length <= chunkSize) {
    await sendMessageToTab(
      tabId,
      {
        method: "singlefile.fetchResponse",
        ...payload,
      },
      typeof frameId === "number" ? { frameId } : undefined,
    );
    return;
  }

  for (let index = 0; index * chunkSize <= payload.array.length; index += 1) {
    const start = index * chunkSize;
    const end = start + chunkSize;
    await sendMessageToTab(
      tabId,
      {
        method: "singlefile.fetchResponse",
        requestId: payload.requestId,
        status: payload.status,
        headers: payload.headers,
        error: payload.error,
        truncated: true,
        finished: end >= payload.array.length,
        array: payload.array.slice(start, end),
      },
      typeof frameId === "number" ? { frameId } : undefined,
    );
  }
}

function sendMessageToTab(
  tabId: number,
  message: unknown,
  options?: chrome.tabs.MessageSendOptions,
) {
  return new Promise<unknown>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, options, (response) => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message);
        if (isStaleExtensionContextError(error)) {
          reject(new Error(getRefreshRequiredMessage()));
          return;
        }
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

function buildTimeoutKey(tabId: number | undefined, frameId: number | undefined, type: string) {
  return `${tabId ?? "unknown"}:${frameId ?? "top"}:${type}`;
}
