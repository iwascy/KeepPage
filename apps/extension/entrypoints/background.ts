import { captureProfileSchema } from "@keeppage/domain";
import { defineBackground } from "wxt/utils/define-background";
import {
  captureActiveTab,
  listRecentTasks,
  openTaskPreview,
  retryTask,
} from "../src/lib/capture-pipeline";
import {
  MESSAGE_TYPE,
  isBackgroundRequest,
  type ListTasksResponse,
} from "../src/lib/messages";
import { getFetchChunkSize } from "../src/lib/singlefile-fetch";

const singleFileTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "keeppage-save-page",
      title: "保存到 KeepPage",
      contexts: ["page", "action"],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "keeppage-save-page" || !tab?.id) {
      return;
    }
    await captureActiveTab("standard");
    if (tab.windowId != null) {
      await openSidePanel(tab.windowId);
    }
  });

  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) {
      return;
    }
    await captureActiveTab("standard");
    if (tab.windowId != null) {
      await openSidePanel(tab.windowId);
    }
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "save-current-page") {
      await captureActiveTab("standard");
      return;
    }
    if (command === "open-side-panel") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.windowId != null) {
        await openSidePanel(tab.windowId);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isSingleFileRuntimeMessage(message)) {
      void handleSingleFileRuntimeMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
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
        const tasks = await listRecentTasks(message.limit ?? 20);
        const response: ListTasksResponse = {
          ok: true,
          tasks,
        };
        sendResponse(response);
        return;
      }
      if (message.type === MESSAGE_TYPE.TriggerCaptureActiveTab) {
        const profile = captureProfileSchema.parse(message.profile ?? "standard");
        const task = await captureActiveTab(profile);
        sendResponse({ ok: true, task });
        return;
      }
      if (message.type === MESSAGE_TYPE.RetryTask) {
        const profile = message.profile
          ? captureProfileSchema.parse(message.profile)
          : undefined;
        const task = await retryTask(message.taskId, profile);
        sendResponse({ ok: true, task });
        return;
      }
      if (message.type === MESSAGE_TYPE.OpenTaskPreview) {
        await openTaskPreview(message.taskId);
        sendResponse({ ok: true });
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
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
});

async function openSidePanel(windowId: number) {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch {
    // Ignore: old browser versions may not support sidePanel.open.
  }
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
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function buildTimeoutKey(tabId: number | undefined, frameId: number | undefined, type: string) {
  return `${tabId ?? "unknown"}:${frameId ?? "top"}:${type}`;
}
