import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureArchiveBaseHref,
  evaluateQuality,
  type CapturePageSignals,
  type CaptureSource,
} from "@keeppage/domain";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";

const extensionBuildRootUrl = new URL("../../../extension/.output/chrome-mv3/", import.meta.url);
const extensionBuildManifestPath = fileURLToPath(new URL("manifest.json", extensionBuildRootUrl));
const extensionContentScriptPath = fileURLToPath(
  new URL("content-scripts/content.js", extensionBuildRootUrl),
);
const extensionSingleFileBootstrapPath = fileURLToPath(
  new URL("content-scripts/singlefile-bootstrap.js", extensionBuildRootUrl),
);
const extensionSingleFileFramesPath = fileURLToPath(
  new URL("content-scripts/singlefile-frames.js", extensionBuildRootUrl),
);
const extensionSingleFileHooksMainPath = fileURLToPath(
  new URL("content-scripts/singlefile-hooks-main.js", extensionBuildRootUrl),
);

const CONTENT_MESSAGE_TYPE = {
  collectLiveSignals: "keeppage/collect-live-signals",
  captureArchiveHtml: "keeppage/capture-archive-html",
} as const;

type CloudArchiveSourcePatch = Pick<
  CaptureSource,
  "canonicalUrl" | "coverImageUrl" | "referrer" | "captureScope" | "viewport" | "savedAt"
>;

type BuiltExtensionRuntime = {
  manifestVersion: string;
  contentScriptPath: string;
  singlefileBootstrapSource: string;
  singlefileFramesSource: string;
  singlefileHooksMainSource: string;
};

type NodeFetchRequest = {
  url?: string;
  headers?: Array<[string, string]>;
  referrer?: string;
};

type NodeFetchResponse = {
  status?: number;
  headers?: Array<[string, string]>;
  array: number[];
  error?: string;
};

type CollectLiveSignalsResponse =
  | {
      ok: true;
      sourcePatch: CloudArchiveSourcePatch;
      liveSignals: CapturePageSignals;
    }
  | {
      ok: false;
      error?: string;
    };

type CaptureArchiveHtmlResponse =
  | {
      ok: true;
      archiveHtml: string;
      readerHtml?: string;
      usedSingleFile: boolean;
    }
  | {
      ok: false;
      error?: string;
    };

type CloudArchivePage = {
  setBypassCSP: (enabled: boolean) => Promise<void>;
  setViewport: (viewport: { width: number; height: number }) => Promise<void>;
  exposeFunction: (
    name: string,
    fn: (input: NodeFetchRequest) => Promise<NodeFetchResponse>,
  ) => Promise<void>;
  evaluateOnNewDocument: (
    pageFunction: ((...args: any[]) => any) | string,
    ...args: any[]
  ) => Promise<void>;
  goto: (targetUrl: string, options: Record<string, unknown>) => Promise<unknown>;
  addScriptTag: (options: { path: string }) => Promise<unknown>;
  evaluate: <T>(pageFunction: (...args: any[]) => T | Promise<T>, ...args: any[]) => Promise<T>;
  screenshot: (options: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

type CloudArchiveBrowser = {
  newPage: () => Promise<CloudArchivePage>;
  close: () => Promise<void>;
};

type PuppeteerApi = {
  launch: (options: Record<string, unknown>) => Promise<CloudArchiveBrowser>;
};

export type CloudArchiveFetchResult = {
  title: string;
  archiveHtml: string;
  readerHtml?: string;
  liveSignals: CapturePageSignals;
  sourcePatch: CloudArchiveSourcePatch;
  screenshotGenerated: boolean;
};

let cachedBuiltExtensionRuntime: BuiltExtensionRuntime | null = null;

export async function fetchPageWithPuppeteer(
  url: string,
  timeoutMs: number,
): Promise<CloudArchiveFetchResult> {
  const builtExtensionRuntime = getBuiltExtensionRuntime();
  const puppeteerModuleName = "puppeteer";
  const puppeteer = await import(puppeteerModuleName) as {
    default?: PuppeteerApi;
    launch?: PuppeteerApi["launch"];
  };
  const puppeteerApi = (puppeteer.default ?? puppeteer) as PuppeteerApi;
  let browser: CloudArchiveBrowser | null = null;

  try {
    browser = await puppeteerApi.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (error) {
    throw new Error(
      "Failed to launch Puppeteer. Install Chrome/Chromium for the runtime environment, or set PUPPETEER_EXECUTABLE_PATH when browser download is skipped in CI.",
      { cause: error },
    );
  }

  try {
    if (!browser) {
      throw new Error("Puppeteer browser instance was not created.");
    }

    const page = await browser.newPage();
    let browserUserAgent = "";

    await page.setBypassCSP(true);
    await page.setViewport({ width: 1280, height: 720 });
    await page.exposeFunction("__KEEP_PAGE_NODE_FETCH__", async (input: NodeFetchRequest) =>
      proxySingleFileFetch(input, browserUserAgent));
    await page.evaluateOnNewDocument(
      installCloudArchiveExtensionRuntime,
      builtExtensionRuntime.manifestVersion,
    );
    await page.evaluateOnNewDocument(
      (scriptSource: string) => {
        (0, eval)(scriptSource);
      },
      builtExtensionRuntime.singlefileHooksMainSource,
    );
    await page.evaluateOnNewDocument(
      (scriptSource: string) => {
        (0, eval)(scriptSource);
      },
      builtExtensionRuntime.singlefileBootstrapSource,
    );
    await page.evaluateOnNewDocument(
      (scriptSource: string) => {
        (0, eval)(scriptSource);
      },
      builtExtensionRuntime.singlefileFramesSource,
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });
    browserUserAgent = await page.evaluate(() => navigator.userAgent);
    await page.addScriptTag({ path: builtExtensionRuntime.contentScriptPath });

    const title = await page.evaluate(() => document.title || location.hostname || location.href);
    const liveResult = await sendContentScriptMessage<CollectLiveSignalsResponse>(page, {
      type: CONTENT_MESSAGE_TYPE.collectLiveSignals,
      captureScope: "page",
    });

    if (!liveResult.ok) {
      throw new Error(
        liveResult.error || "KeepPage content script failed to collect live page signals.",
      );
    }

    let captureResult: CaptureArchiveHtmlResponse | null = null;
    try {
      captureResult = await sendContentScriptMessage<CaptureArchiveHtmlResponse>(page, {
        type: CONTENT_MESSAGE_TYPE.captureArchiveHtml,
        profile: "standard",
        captureScope: "page",
      });
    } catch {
      captureResult = null;
    }

    const resolvedTitle = normalizePageTitle(title, url);
    const fallbackSource = resolveCaptureSource(url, resolvedTitle, liveResult.sourcePatch);
    const archiveHtml = captureResult?.ok && captureResult.archiveHtml
      ? captureResult.archiveHtml
      : buildFallbackArchiveHtml(fallbackSource, liveResult.liveSignals);
    const readerHtml = captureResult?.ok ? captureResult.readerHtml : undefined;

    let screenshotGenerated = false;
    try {
      await page.screenshot({
        type: "png",
      });
      screenshotGenerated = true;
    } catch {
      screenshotGenerated = false;
    }

    await page.close();

    return {
      title: resolvedTitle,
      archiveHtml,
      readerHtml,
      liveSignals: liveResult.liveSignals,
      sourcePatch: liveResult.sourcePatch,
      screenshotGenerated,
    };
  } finally {
    await browser?.close();
  }
}

export async function processCloudArchive(input: {
  userId: string;
  url: string;
  title?: string;
  folderId?: string;
  folderPath?: string;
  tagIds?: string[];
  tags?: string[];
  config: ApiConfig;
  repository: BookmarkRepository;
  objectStorage: ObjectStorage;
}): Promise<{
  bookmarkId: string;
  versionId: string;
}> {
  const { userId, url, config, repository, objectStorage } = input;

  const fetchResult = await fetchPageWithPuppeteer(url, config.CLOUD_ARCHIVE_TIMEOUT_MS);
  const baseUrl = fetchResult.sourcePatch.canonicalUrl ?? url;
  const resolvedTitle = input.title || fetchResult.title || new URL(url).hostname;

  const archiveHtml = ensureArchiveBaseHref(fetchResult.archiveHtml, baseUrl);
  const readerHtml = fetchResult.readerHtml
    ? ensureArchiveBaseHref(fetchResult.readerHtml, baseUrl)
    : undefined;
  const extractedText = extractTextFromHtml(readerHtml ?? archiveHtml);
  const archiveBuffer = Buffer.from(archiveHtml, "utf-8");
  const htmlSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  const textSha256 = extractedText
    ? createHash("sha256").update(Buffer.from(extractedText, "utf-8")).digest("hex")
    : undefined;

  const initResult = await repository.initCapture(userId, {
    url,
    title: resolvedTitle,
    fileSize: archiveBuffer.byteLength,
    htmlSha256,
    profile: "standard",
    deviceId: "cloud-archive",
  });

  if (!initResult.alreadyExists) {
    await objectStorage.putObject(initResult.objectKey, archiveBuffer, {
      contentType: "text/html;charset=utf-8",
    });
  }

  const archiveSignals = buildArchiveSignals(archiveHtml, fetchResult.screenshotGenerated);
  const quality = evaluateQuality({
    liveSignals: fetchResult.liveSignals,
    archiveSignals,
    missingIframeLikely: archiveSignals.iframeCount < fetchResult.liveSignals.iframeCount,
  });
  const source = resolveCaptureSource(url, resolvedTitle, fetchResult.sourcePatch);

  const completeResult = await repository.completeCapture(userId, {
    objectKey: initResult.objectKey,
    htmlSha256,
    readerHtml,
    textSha256,
    extractedText,
    quality,
    source,
    deviceId: "cloud-archive",
  });

  if (
    input.folderId
    || input.folderPath
    || input.tagIds?.length
    || input.tags !== undefined
  ) {
    await repository.updateBookmarkMetadata(userId, completeResult.bookmark.id, {
      folderId: input.folderId,
      folderPath: input.folderPath,
      tagIds: input.tagIds,
      tags: input.tags,
    });
  }

  return {
    bookmarkId: completeResult.bookmark.id,
    versionId: completeResult.versionId,
  };
}

function getBuiltExtensionRuntime() {
  if (cachedBuiltExtensionRuntime) {
    return cachedBuiltExtensionRuntime;
  }

  const requiredPaths = [
    extensionBuildManifestPath,
    extensionContentScriptPath,
    extensionSingleFileBootstrapPath,
    extensionSingleFileFramesPath,
    extensionSingleFileHooksMainPath,
  ];
  const missingPaths = requiredPaths.filter((path) => !existsSync(path));
  if (missingPaths.length > 0) {
    throw new Error(
      `KeepPage cloud archive requires extension build output. Missing: ${missingPaths.join(", ")}. Run \`npm run build -w @keeppage/extension\` first.`,
    );
  }

  const manifestVersion = readBuiltExtensionManifestVersion();
  cachedBuiltExtensionRuntime = {
    manifestVersion,
    contentScriptPath: extensionContentScriptPath,
    singlefileBootstrapSource: readFileSync(extensionSingleFileBootstrapPath, "utf8"),
    singlefileFramesSource: readFileSync(extensionSingleFileFramesPath, "utf8"),
    singlefileHooksMainSource: readFileSync(extensionSingleFileHooksMainPath, "utf8"),
  };
  return cachedBuiltExtensionRuntime;
}

function readBuiltExtensionManifestVersion() {
  try {
    const manifest = JSON.parse(readFileSync(extensionBuildManifestPath, "utf8")) as {
      version?: string;
    };
    return manifest.version?.trim() || "cloud-archive";
  } catch {
    return "cloud-archive";
  }
}

async function proxySingleFileFetch(
  input: NodeFetchRequest,
  browserUserAgent: string,
): Promise<NodeFetchResponse> {
  const url = typeof input.url === "string" ? input.url : "";
  if (!url) {
    return {
      error: "SingleFile resource URL is required.",
      array: [],
    };
  }

  const headers = new Headers(Array.isArray(input.headers) ? input.headers : []);
  if (browserUserAgent && !headers.has("user-agent")) {
    headers.set("user-agent", browserUserAgent);
  }
  if (input.referrer && !headers.has("referer")) {
    headers.set("referer", input.referrer);
  }

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
    });
    return {
      status: response.status,
      headers: [...response.headers],
      array: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      array: [],
    };
  }
}

async function sendContentScriptMessage<T>(
  page: CloudArchivePage,
  message: Record<string, unknown>,
): Promise<T> {
  return page.evaluate((payload) => new Promise((resolve, reject) => {
    const chromeApi = (globalThis as {
      chrome?: {
        runtime?: {
          sendMessage?: (message: unknown, callback: (response: unknown) => void) => unknown;
          lastError?: { message?: string };
        };
      };
    }).chrome;
    const runtime = chromeApi?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error("KeepPage runtime bridge is not available in the page context."));
      return;
    }

    try {
      runtime.sendMessage(payload, (response) => {
        const lastError = runtime.lastError;
        if (lastError?.message) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }), message) as Promise<T>;
}

function installCloudArchiveExtensionRuntime(manifestVersion: string) {
  const globalScope = globalThis as typeof globalThis & {
    __KEEP_PAGE_CLOUD_ARCHIVE_RUNTIME_INSTALLED__?: boolean;
    __KEEP_PAGE_NODE_FETCH__?: (input: NodeFetchRequest) => Promise<NodeFetchResponse>;
    frameId?: string | number;
  };
  if (globalScope.__KEEP_PAGE_CLOUD_ARCHIVE_RUNTIME_INSTALLED__) {
    return;
  }
  globalScope.__KEEP_PAGE_CLOUD_ARCHIVE_RUNTIME_INSTALLED__ = true;

  type RuntimeListener = (
    message: unknown,
    sender: Record<string, unknown>,
    sendResponse: (value: unknown) => void,
  ) => unknown;

  const runtimeListeners = new Set<RuntimeListener>();
  const storageChangeListeners = new Set<(changes: Record<string, unknown>, areaName: string) => void>();
  const lazyTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const storageState: Record<string, unknown> = {
    debugMode: false,
  };
  const topBridgeRequestType = "__KEEP_PAGE_RUNTIME_BRIDGE_REQUEST__";
  const topBridgeReplyType = "__KEEP_PAGE_RUNTIME_BRIDGE_REPLY__";
  let lastError: { message: string } | undefined;

  const normalizeErrorMessage = (error: unknown) => (
    error instanceof Error ? error.message : String(error)
  );

  const cloneValue = <T>(value: T): T => {
    if (value === undefined) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  };

  const readStorageKeys = (keys: unknown) => {
    if (keys == null) {
      return cloneValue(storageState);
    }
    if (typeof keys === "string") {
      return {
        [keys]: cloneValue(storageState[keys]),
      };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, cloneValue(storageState[key])])); 
    }
    if (typeof keys === "object") {
      return Object.fromEntries(
        Object.entries(keys as Record<string, unknown>).map(([key, fallback]) => [
          key,
          key in storageState ? cloneValue(storageState[key]) : fallback,
        ]),
      );
    }
    return {};
  };

  const dispatchRuntimeMessage = async (
    message: unknown,
    sender: Record<string, unknown>,
  ) => {
    for (const listener of [...runtimeListeners]) {
      let responseResolve: ((value: unknown) => void) | null = null;
      let responseSent = false;
      const responsePromise = new Promise((resolve) => {
        responseResolve = resolve;
      });
      const sendResponse = (value: unknown) => {
        if (responseSent) {
          return;
        }
        responseSent = true;
        responseResolve?.(value);
      };

      const result = listener(message, sender, sendResponse);
      if (result === true) {
        return {
          handled: true,
          response: await responsePromise,
        };
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        const awaited = await result;
        if (awaited !== undefined) {
          return {
            handled: true,
            response: awaited,
          };
        }
        if (responseSent) {
          return {
            handled: true,
            response: await responsePromise,
          };
        }
        continue;
      }
      if (responseSent) {
        return {
          handled: true,
          response: await responsePromise,
        };
      }
      if (result !== undefined && result !== false) {
        return {
          handled: true,
          response: result,
        };
      }
    }

    return {
      handled: false,
      response: undefined,
    };
  };

  const sendBridgeMessageToTop = async (message: Record<string, unknown>) => {
    const topWindow = globalScope.top;
    if (!topWindow || topWindow === window) {
      return dispatchRuntimeMessage(message, {
        frameId: globalScope.frameId ?? 0,
        url: location.href,
      });
    }

    const requestId = `kp-runtime-${Math.random().toString(36).slice(2)}`;
    return new Promise<{ handled: boolean; response: unknown }>((resolve) => {
      const handleReply = (event: MessageEvent) => {
        const reply = event.data as {
          type?: string;
          id?: string;
          handled?: boolean;
          response?: unknown;
        } | null;
        if (!reply || reply.type !== topBridgeReplyType || reply.id !== requestId) {
          return;
        }
        globalScope.removeEventListener("message", handleReply);
        resolve({
          handled: reply.handled === true,
          response: reply.response,
        });
      };

      globalScope.addEventListener("message", handleReply);
      (topWindow as Window).postMessage({
        type: topBridgeRequestType,
        id: requestId,
        message,
      }, "*");
    });
  };

  const handleSingleFileRuntimeMessage = async (message: unknown) => {
    if (!message || typeof message !== "object") {
      return undefined;
    }

    const input = message as {
      method?: string;
      requestId?: number;
      url?: string;
      headers?: Array<[string, string]>;
      referrer?: string;
      type?: string;
      delay?: number;
    };
    const method = typeof input.method === "string" ? input.method : "";
    if (!method) {
      return undefined;
    }

    if (
      (method === "singlefile.frameTree.initResponse"
        || method === "singlefile.frameTree.ackInitRequest"
        || method === "singlefile.frameTree.cleanupRequest")
      && globalScope.top
      && globalScope.top !== window
    ) {
      const bridged = await sendBridgeMessageToTop(input as Record<string, unknown>);
      return bridged.handled ? bridged.response : {};
    }

    if (method === "singlefile.fetch") {
      const fetchResponse = await globalScope.__KEEP_PAGE_NODE_FETCH__?.({
        url: input.url,
        headers: input.headers,
        referrer: input.referrer,
      }) ?? {
        error: "SingleFile node fetch bridge is unavailable.",
        array: [],
      };
      await dispatchRuntimeMessage({
        method: "singlefile.fetchResponse",
        requestId: Number(input.requestId ?? 0),
        status: fetchResponse.status,
        headers: fetchResponse.headers,
        array: fetchResponse.array,
        error: fetchResponse.error,
      }, {
        frameId: globalScope.frameId ?? 0,
        url: location.href,
      });
      return {};
    }

    if (method === "singlefile.fetchFrame") {
      return globalScope.__KEEP_PAGE_NODE_FETCH__?.({
        url: input.url,
        headers: input.headers,
        referrer: input.referrer,
      }) ?? {
        error: "SingleFile node fetch bridge is unavailable.",
        array: [],
      };
    }

    if (method === "singlefile.lazyTimeout.setTimeout") {
      const key = String(input.type ?? "");
      const previous = lazyTimeouts.get(key);
      if (previous) {
        globalScope.clearTimeout(previous);
      }
      const timeoutId = globalScope.setTimeout(() => {
        lazyTimeouts.delete(key);
        void dispatchRuntimeMessage({
          method: "singlefile.lazyTimeout.onTimeout",
          type: key,
        }, {
          frameId: globalScope.frameId ?? 0,
          url: location.href,
        });
      }, Number(input.delay ?? 0));
      lazyTimeouts.set(key, timeoutId);
      return {};
    }

    if (method === "singlefile.lazyTimeout.clearTimeout") {
      const key = String(input.type ?? "");
      const timeoutId = lazyTimeouts.get(key);
      if (timeoutId) {
        globalScope.clearTimeout(timeoutId);
        lazyTimeouts.delete(key);
      }
      return {};
    }

    return undefined;
  };

  const runtime = {
    id: "keeppage-cloud-archive",
    getManifest() {
      return {
        version: manifestVersion,
      };
    },
    getURL(path: string) {
      const normalizedPath = path.replace(/^\/+/, "");
      return `chrome-extension://keeppage-cloud-archive/${normalizedPath}`;
    },
    sendMessage(message: unknown, callback?: (response: unknown) => void) {
      const work = (async () => {
        const sender = {
          frameId: globalScope.frameId ?? 0,
          url: location.href,
        };
        const dispatched = await dispatchRuntimeMessage(message, sender);
        if (dispatched.handled) {
          return dispatched.response;
        }
        return handleSingleFileRuntimeMessage(message);
      })();

      if (typeof callback === "function") {
        work
          .then((response) => {
            lastError = undefined;
            callback(response);
          })
          .catch((error) => {
            lastError = {
              message: normalizeErrorMessage(error),
            };
            callback(undefined);
            lastError = undefined;
          });
        return undefined;
      }

      return work;
    },
    onMessage: {
      addListener(listener: RuntimeListener) {
        runtimeListeners.add(listener);
      },
      removeListener(listener: RuntimeListener) {
        runtimeListeners.delete(listener);
      },
    },
    get lastError() {
      return lastError;
    },
  };

  const storage = {
    local: {
      async get(keys?: unknown) {
        return readStorageKeys(keys);
      },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(items)) {
          const previousValue = cloneValue(storageState[key]);
          storageState[key] = cloneValue(value);
          changes[key] = {
            oldValue: previousValue,
            newValue: cloneValue(value),
          };
        }
        if (Object.keys(changes).length > 0) {
          for (const listener of [...storageChangeListeners]) {
            listener(changes, "local");
          }
        }
      },
    },
    onChanged: {
      addListener(listener: (changes: Record<string, unknown>, areaName: string) => void) {
        storageChangeListeners.add(listener);
      },
      removeListener(listener: (changes: Record<string, unknown>, areaName: string) => void) {
        storageChangeListeners.delete(listener);
      },
    },
  };

  globalScope.addEventListener("message", (event: MessageEvent) => {
    if (globalScope.top !== window) {
      return;
    }

    const data = event.data as {
      type?: string;
      id?: string;
      message?: unknown;
    } | null;
    if (!data || data.type !== topBridgeRequestType || !data.id) {
      return;
    }

    void dispatchRuntimeMessage(data.message, {
      frameId: "bridged",
      url: location.href,
    }).then((result) => {
      (event.source as Window | null)?.postMessage({
        type: topBridgeReplyType,
        id: data.id,
        handled: result.handled,
        response: result.response,
      }, "*");
    });
  });

  const chromeApi = (globalScope.chrome ?? {}) as typeof chrome;
  (chromeApi as typeof chrome & {
    dom?: {
      openOrClosedShadowRoot: (element: Element) => ShadowRoot | null;
    };
  }).runtime = runtime as typeof chrome.runtime;
  (chromeApi as typeof chrome & {
    storage?: typeof chrome.storage;
  }).storage = storage as typeof chrome.storage;
  (chromeApi as typeof chrome & {
    dom?: {
      openOrClosedShadowRoot: (element: Element) => ShadowRoot | null;
    };
  }).dom = {
    openOrClosedShadowRoot(element: Element) {
      return element.shadowRoot ?? null;
    },
  };
  (globalScope as typeof globalThis & { chrome: typeof chrome }).chrome = chromeApi;
  (globalScope as typeof globalThis & { browser: Record<string, unknown> }).browser = {
    runtime,
    storage,
  };
}

function normalizePageTitle(title: unknown, url: string) {
  if (typeof title === "string" && title.trim()) {
    return title.trim();
  }
  return safeUrl(url).hostname || url;
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

function buildArchiveSignals(
  html: string,
  screenshotGenerated: boolean,
): CapturePageSignals {
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
    screenshotGenerated,
  };
}

function countMatches(text: string, pattern: RegExp) {
  const matched = text.match(pattern);
  return matched ? matched.length : 0;
}

function resolveCaptureSource(
  url: string,
  title: string,
  sourcePatch: CloudArchiveSourcePatch,
): CaptureSource {
  const resolvedDomain = safeUrl(sourcePatch.canonicalUrl ?? url).hostname || safeUrl(url).hostname;
  return {
    url,
    title,
    canonicalUrl: sourcePatch.canonicalUrl,
    domain: resolvedDomain,
    coverImageUrl: sourcePatch.coverImageUrl,
    referrer: sourcePatch.referrer,
    captureScope: sourcePatch.captureScope ?? "page",
    viewport: sourcePatch.viewport,
    savedAt: sourcePatch.savedAt,
  };
}

function safeUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    return new URL("https://invalid.local");
  }
}
