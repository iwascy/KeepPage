import { ensureBrowserRuntime } from "./browser-polyfill";

const FETCH_CHUNK_SIZE = 8 * 1024 * 1024;

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
      referrer: options.referrer,
      headers: headersToPairs(fetchOptions.headers),
    });

    return promise;
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
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function headersToPairs(headers: HeadersInit | undefined) {
  if (!headers) {
    return undefined;
  }
  return Array.from(new Headers(headers).entries());
}
