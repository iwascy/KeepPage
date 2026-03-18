import { ensureBrowserRuntime } from "./browser-polyfill";
import {
  getRefreshRequiredMessage,
  isStaleExtensionContextError,
} from "./extension-errors";
import { createLogger } from "./logger";

const FETCH_CHUNK_SIZE = 8 * 1024 * 1024;
const logger = createLogger("singlefile-fetch");

type RuntimeFetchResponse = {
  status?: number;
  headers?: Array<[string, string]>;
  array?: number[];
  error?: string;
  truncated?: boolean;
  finished?: boolean;
  requestId?: number;
};

type PendingResponse = {
  resolve: (value: {
    status: number;
    headers: Map<string, string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }) => void;
  reject: (error: Error) => void;
  array?: number[];
};

type SingleFileFetchOptions = RequestInit & {
  frameId?: string | number;
  referrer?: string;
};

let initialized = false;
let requestId = 0;
const pendingResponses = new Map<number, PendingResponse>();

export function initSingleFileFetchBridge() {
  if (initialized) {
    return;
  }
  initialized = true;
  ensureBrowserRuntime();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    const incoming = message as {
      method?: string;
      frameId?: string | number;
      requestId?: number;
      url?: string;
      headers?: Array<[string, string]>;
      array?: number[];
      error?: string;
      status?: number;
      truncated?: boolean;
      finished?: boolean;
    };

    if (
      incoming.method === "singlefile.fetchFrame" &&
      typeof incoming.frameId !== "undefined" &&
      (globalThis as typeof globalThis & { frameId?: string | number }).frameId === incoming.frameId
    ) {
      void onFetchFrame(incoming).then(sendResponse);
      return true;
    }

    if (incoming.method === "singlefile.fetchResponse") {
      void onFetchResponse(incoming).then(sendResponse);
      return true;
    }

    return false;
  });
}

export async function singleFileFetch(resourceUrl: string, options: SingleFileFetchOptions = {}) {
  initSingleFileFetchBridge();
  const fetchOptions = buildFetchOptions(options);
  const resolvedResourceUrl = resolveResourceUrl(resourceUrl);

  if (shouldUseRuntimeFetch(resolvedResourceUrl)) {
    logger.info("Using background fetch for cross-origin resource.", {
      resourceUrl,
    });
    return fetchViaRuntime(resourceUrl, fetchOptions, options.referrer);
  }

  try {
    let response = await fetch(resourceUrl, fetchOptions);
    if (
      (response.status === 401 || response.status === 403 || response.status === 404) &&
      fetchOptions.referrerPolicy !== "no-referrer" &&
      !options.referrer
    ) {
      response = await fetch(resourceUrl, {
        ...fetchOptions,
        referrerPolicy: "no-referrer",
      });
    }
    return response;
  } catch {
    logger.warn("Page-context fetch failed, retrying through background.", {
      resourceUrl,
    });
    return fetchViaRuntime(resourceUrl, fetchOptions, options.referrer);
  }
}

export async function singleFileFrameFetch(resourceUrl: string, options: SingleFileFetchOptions = {}) {
  initSingleFileFetchBridge();
  const response = await sendRuntimeMessage({
    method: "singlefile.fetchFrame",
    url: resourceUrl,
    frameId: options.frameId,
    referrer: options.referrer,
    headers: headersToPairs(options.headers),
  }) as RuntimeFetchResponse;

  if (response.error) {
    throw new Error(response.error);
  }

  return {
    status: response.status ?? 200,
    headers: new Map(response.headers ?? []),
    arrayBuffer: async () => Uint8Array.from(response.array ?? []).buffer,
  };
}

function buildFetchOptions(options: SingleFileFetchOptions): RequestInit {
  const { frameId: _frameId, referrer, ...requestInit } = options;
  const headers = new Headers(requestInit.headers ?? {});
  if (referrer && !headers.has("referer")) {
    headers.set("referer", referrer);
  }
  return {
    cache: requestInit.cache ?? "force-cache",
    referrerPolicy: requestInit.referrerPolicy ?? "strict-origin-when-cross-origin",
    ...requestInit,
    headers,
  };
}

function resolveResourceUrl(resourceUrl: string) {
  try {
    return new URL(resourceUrl, globalThis.location?.href);
  } catch {
    return null;
  }
}

function shouldUseRuntimeFetch(resourceUrl: URL | null) {
  if (!resourceUrl) {
    return false;
  }
  if (resourceUrl.protocol !== "http:" && resourceUrl.protocol !== "https:") {
    return false;
  }
  const pageOrigin = globalThis.location?.origin;
  if (!pageOrigin) {
    return false;
  }
  return resourceUrl.origin !== pageOrigin;
}

async function fetchViaRuntime(
  resourceUrl: string,
  fetchOptions: RequestInit,
  referrer: string | undefined,
) {
  logger.info("Sending resource fetch request to background.", {
    resourceUrl,
    referrer,
  });
  requestId += 1;
  const currentRequestId = requestId;
  const promise = new Promise<{
    status: number;
    headers: Map<string, string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }>((resolve, reject) => {
    pendingResponses.set(currentRequestId, { resolve, reject });
  });

  await sendRuntimeMessage({
    method: "singlefile.fetch",
    url: resourceUrl,
    requestId: currentRequestId,
    referrer,
    headers: headersToPairs(fetchOptions.headers),
  });

  return promise;
}

async function onFetchFrame(message: {
  url?: string;
  headers?: Array<[string, string]>;
}) {
  try {
    const response = await fetch(message.url ?? "", {
      cache: "force-cache",
      headers: new Headers(message.headers ?? []),
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    return {
      status: response.status,
      headers: [...response.headers],
      array: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  } catch (error) {
    logger.warn("Frame fetch failed.", {
      url: message.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function onFetchResponse(message: RuntimeFetchResponse) {
  const pending = typeof message.requestId === "number"
    ? pendingResponses.get(message.requestId)
    : undefined;

  if (!pending || typeof message.requestId !== "number") {
    return {};
  }

  if (message.error) {
    logger.warn("Background fetch response returned error.", {
      requestId: message.requestId,
      error: message.error,
    });
    pending.reject(new Error(message.error));
    pendingResponses.delete(message.requestId);
    return {};
  }

  if (message.truncated) {
    pending.array = [...(pending.array ?? []), ...(message.array ?? [])];
    if (!message.finished) {
      return {};
    }
  }

  const fullArray = message.truncated ? pending.array ?? [] : message.array ?? [];
  logger.info("Background fetch response completed.", {
    requestId: message.requestId,
    status: message.status ?? 200,
    bytes: fullArray.length,
    truncated: Boolean(message.truncated),
  });
  pending.resolve({
    status: message.status ?? 200,
    headers: new Map(message.headers ?? []),
    arrayBuffer: async () => Uint8Array.from(fullArray).buffer,
  });
  pendingResponses.delete(message.requestId);
  return {};
}

export function getFetchChunkSize() {
  return FETCH_CHUNK_SIZE;
}

async function sendRuntimeMessage(message: unknown) {
  return new Promise<unknown>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const error = new Error(chrome.runtime.lastError.message);
          if (isStaleExtensionContextError(error)) {
            logger.warn("Runtime message failed because extension context is stale.", {
              error: error.message,
            });
            reject(new Error(getRefreshRequiredMessage()));
            return;
          }
          logger.error("Runtime message failed.", {
            error: error.message,
          });
          reject(error);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      if (isStaleExtensionContextError(error)) {
        logger.warn("Runtime message threw because extension context is stale.", {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(new Error(getRefreshRequiredMessage()));
        return;
      }
      logger.error("Runtime message threw unexpectedly.", {
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error);
    }
  });
}

function headersToPairs(headers: HeadersInit | undefined) {
  if (!headers) {
    return undefined;
  }
  return Array.from(new Headers(headers).entries());
}
