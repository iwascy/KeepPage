import type { Bookmark } from "@keeppage/domain";

type BridgeRequest = {
  source: "keeppage-web";
  target: "keeppage-extension";
  requestId: string;
  type: "enqueue-local-archive";
  payload: {
    items: Array<{
      url: string;
      title?: string;
      bookmarkId?: string;
    }>;
  };
};

type BridgeResponse = {
  source: "keeppage-extension";
  target: "keeppage-web";
  requestId: string;
  ok: boolean;
  payload?: {
    acceptedCount?: number;
    skippedCount?: number;
    queueSize?: number;
  };
  error?: string;
};

export class LocalArchiveBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalArchiveBridgeError";
  }
}

export async function enqueueBookmarksToLocalExtension(bookmarks: Bookmark[]) {
  const items = bookmarks
    .map((bookmark) => ({
      url: bookmark.sourceUrl,
      title: bookmark.title,
      bookmarkId: bookmark.id,
    }))
    .filter((item) => item.url.trim());

  if (items.length === 0) {
    return {
      acceptedCount: 0,
      skippedCount: 0,
      queueSize: 0,
    };
  }

  const response = await sendBridgeRequest({
    source: "keeppage-web",
    target: "keeppage-extension",
    requestId: `keeppage-${crypto.randomUUID()}`,
    type: "enqueue-local-archive",
    payload: {
      items,
    },
  });

  if (!response.ok) {
    throw new LocalArchiveBridgeError(
      response.error || "无法把任务发送到本地插件队列。",
    );
  }

  return {
    acceptedCount: response.payload?.acceptedCount ?? 0,
    skippedCount: response.payload?.skippedCount ?? 0,
    queueSize: response.payload?.queueSize ?? 0,
  };
}

async function sendBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  if (typeof window === "undefined") {
    throw new LocalArchiveBridgeError("当前环境不支持本地插件桥接。");
  }

  return new Promise<BridgeResponse>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new LocalArchiveBridgeError("未检测到 KeepPage 本地插件，请确认扩展已安装并刷新当前页面。"));
    }, 5000);

    function onMessage(event: MessageEvent<unknown>) {
      if (event.source !== window) {
        return;
      }
      const response = parseBridgeResponse(event.data);
      if (!response || response.requestId !== request.requestId) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      resolve(response);
    }

    window.addEventListener("message", onMessage);
    window.postMessage(request, window.location.origin);
  });
}

function parseBridgeResponse(input: unknown): BridgeResponse | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybe = input as Record<string, unknown>;
  if (
    maybe.source !== "keeppage-extension"
    || maybe.target !== "keeppage-web"
    || typeof maybe.requestId !== "string"
    || typeof maybe.ok !== "boolean"
  ) {
    return null;
  }

  return {
    source: "keeppage-extension",
    target: "keeppage-web",
    requestId: maybe.requestId,
    ok: maybe.ok,
    payload: maybe.payload && typeof maybe.payload === "object"
      ? maybe.payload as BridgeResponse["payload"]
      : undefined,
    error: typeof maybe.error === "string" ? maybe.error : undefined,
  };
}
