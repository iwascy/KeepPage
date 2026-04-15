import type {
  CaptureDownloadableMedia,
  CapturePageSignals,
  CaptureProfile,
  CaptureScope,
  CaptureSource,
  SaveMode,
} from "@keeppage/domain";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  MESSAGE_TYPE,
  isDebugLogEvent,
  isContentRequest,
  type CaptureArchiveHtmlResponse,
  type CollectLiveSignalsResponse,
  type ShowInPageToastResponse,
  type StartSelectionCaptureResponse,
} from "../src/lib/messages";
import {
  capturePageSignalsSchema,
  captureProfileSchema,
  captureScopeSchema,
  saveModeSchema,
} from "../src/lib/domain-runtime";
import { createLogger, logToConsole } from "../src/lib/logger";
import { optimizeSiteArchiveHtml } from "../src/lib/site-capture";
import { extractReaderArchiveHtml } from "../src/lib/site-archive";
import {
  parseXiaohongshuInitialState,
  readXiaohongshuNoteRecord,
} from "../src/lib/sites/xiaohongshu/state";

type SingleFilePageData = {
  content?: string | number[];
};

type SingleFileGlobal = {
  singlefile?: {
    getPageData?: (
      options?: Record<string, unknown>,
      initOptions?: unknown,
      doc?: Document,
      win?: Window,
    ) => Promise<SingleFilePageData>;
  };
};

type ArchiveCaptureResult =
  | {
      ok: true;
      archiveHtml: string;
      readerHtml?: string;
      downloadableMedia: CaptureDownloadableMedia[];
      usedSingleFile: boolean;
    }
  | {
      ok: false;
      error: string;
    };

type ToastElements = {
  host: HTMLDivElement;
  toast: HTMLDivElement;
  title: HTMLParagraphElement;
  message: HTMLParagraphElement;
};

type SelectionOverlayElements = {
  host: HTMLDivElement;
  frame: HTMLDivElement;
  label: HTMLDivElement;
  helper: HTMLDivElement;
};

type ActiveSelection = {
  root: HTMLElement;
  descriptor: string;
  textPreview: string;
};

type KeepPageBridgeRequest =
  | {
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

type KeepPageBridgeResponse = {
  source: "keeppage-extension";
  target: "keeppage-web";
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

type SelectionSession = {
  profile: CaptureProfile;
  saveMode: SaveMode;
  hoveredElement: HTMLElement | null;
  overlay: SelectionOverlayElements;
  detach: () => void;
};

const TOAST_HOST_ID = "keeppage-in-page-toast";
const SELECTION_OVERLAY_HOST_ID = "keeppage-selection-overlay";
const SELECTION_MARKER_ATTR = "data-keeppage-selection-root";
const MIN_COVER_IMAGE_WIDTH = 240;
const MIN_COVER_IMAGE_HEIGHT = 135;
const MIN_COVER_IMAGE_AREA = 48_000;
const PREFERRED_SELECTION_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGURE",
  "IMG",
  "LI",
  "MAIN",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
  "OL",
  "VIDEO",
]);

let toastElements: ToastElements | null = null;
let toastDismissTimer: number | null = null;
let toastRemovalTimer: number | null = null;
let selectionOverlayElements: SelectionOverlayElements | null = null;
let selectionSession: SelectionSession | null = null;
let activeSelection: ActiveSelection | null = null;

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    const logger = createLogger("content");
    logger.info("Content script ready.", {
      url: location.href,
      extensionVersion: chrome.runtime.getManifest().version,
    });
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isDebugLogEvent(message)) {
        logToConsole(message.scope, message.level, message.message, message.details);
        return false;
      }

      if (!isContentRequest(message)) {
        return false;
      }

      void (async () => {
        if (message.type === MESSAGE_TYPE.CollectLiveSignals) {
          const captureScope = captureScopeSchema.parse(message.captureScope ?? "page");
          logger.info("Collecting live signals.", {
            url: location.href,
            captureScope,
          });
          const sourcePatch = collectSourcePatch(captureScope);
          const liveSignals = collectLiveSignals(captureScope);
          logger.debug("Collecting source patch and DOM-based live signals.", {
            captureScope,
            canonicalUrl: sourcePatch.canonicalUrl,
            referrer: sourcePatch.referrer,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          });
          const response: CollectLiveSignalsResponse = {
            ok: true,
            sourcePatch,
            liveSignals,
          };
          logger.info("Live signals collected.", response.liveSignals);
          sendResponse(response);
          return;
        }
        if (message.type === MESSAGE_TYPE.CaptureArchiveHtml) {
          const profile = captureProfileSchema.parse(message.profile);
          const captureScope = captureScopeSchema.parse(message.captureScope ?? "page");
          logger.info("Capturing archive HTML.", {
            url: location.href,
            profile,
            captureScope,
          });
          const capture = await captureArchiveHtml(profile, captureScope);
          const response: CaptureArchiveHtmlResponse = capture.ok
            ? {
                ok: true,
                archiveHtml: capture.archiveHtml,
                readerHtml: capture.readerHtml,
                downloadableMedia: capture.downloadableMedia,
                usedSingleFile: capture.usedSingleFile,
              }
            : {
                ok: false,
                error: capture.error,
              };
          if (capture.ok) {
            logger.info("Archive HTML captured.", {
              captureScope,
              usedSingleFile: capture.usedSingleFile,
              archiveSize: capture.archiveHtml.length,
            });
          } else {
            logger.warn("Archive HTML capture failed.", {
              captureScope,
              error: capture.error,
            });
          }
          sendResponse(response);
          return;
        }
        if (message.type === MESSAGE_TYPE.StartSelectionCapture) {
          const profile = captureProfileSchema.parse(message.profile ?? "standard");
          const saveMode = saveModeSchema.parse(message.saveMode ?? "standard");
          logger.info("Starting interactive selection capture.", {
            url: location.href,
            profile,
            saveMode,
          });
          startSelectionCapture({
            profile,
            saveMode,
          });
          const response: StartSelectionCaptureResponse = {
            ok: true,
          };
          sendResponse(response);
          return;
        }
        if (message.type === MESSAGE_TYPE.ShowInPageToast) {
          showInPageToast({
            title: message.title,
            message: message.message,
          });
          const response: ShowInPageToastResponse = {
            ok: true,
          };
          sendResponse(response);
        }
      })().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("Content script request failed.", {
          url: location.href,
          error: reason,
        });
        sendResponse({ ok: false, error: reason });
      });

      return true;
    });

    installKeepPageWebBridge(logger);
  },
});

function installKeepPageWebBridge(logger: ReturnType<typeof createLogger>) {
  if (!isKeepPageAppOrigin(location.origin)) {
    return;
  }

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window) {
      return;
    }

    const request = parseKeepPageBridgeRequest(event.data);
    if (!request) {
      return;
    }

    void (async () => {
      logger.info("Received KeepPage web bridge request.", {
        requestId: request.requestId,
        requestType: request.type,
        url: location.href,
      });

      if (request.type === "enqueue-local-archive") {
        const response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPE.EnqueueLocalArchiveQueue,
          items: request.payload.items,
        });
        postKeepPageBridgeResponse({
          source: "keeppage-extension",
          target: "keeppage-web",
          requestId: request.requestId,
          ok: Boolean(response?.ok),
          payload: response?.ok ? response : undefined,
          error: response?.ok ? undefined : response?.error ?? "本地插件队列提交失败。",
        });
      }
    })().catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("KeepPage web bridge request failed.", {
        requestId: request.requestId,
        requestType: request.type,
        error: reason,
      });
      postKeepPageBridgeResponse({
        source: "keeppage-extension",
        target: "keeppage-web",
        requestId: request.requestId,
        ok: false,
        error: reason,
      });
    });
  });
}

function isKeepPageAppOrigin(origin: string) {
  return (
    origin === "https://keeppage.cccy.fun"
    || origin === "http://localhost:5173"
    || origin === "http://127.0.0.1:5173"
  );
}

function parseKeepPageBridgeRequest(input: unknown): KeepPageBridgeRequest | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybe = input as Record<string, unknown>;
  if (
    maybe.source !== "keeppage-web"
    || maybe.target !== "keeppage-extension"
    || maybe.type !== "enqueue-local-archive"
    || typeof maybe.requestId !== "string"
  ) {
    return null;
  }

  const payload = maybe.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  if (!Array.isArray(payloadRecord.items)) {
    return null;
  }

  return {
    source: "keeppage-web",
    target: "keeppage-extension",
    requestId: maybe.requestId,
    type: "enqueue-local-archive",
    payload: {
      items: normalizeBridgeItems(payloadRecord.items),
    },
  };
}

function postKeepPageBridgeResponse(response: KeepPageBridgeResponse) {
  window.postMessage(response, location.origin);
}

function normalizeBridgeItems(input: unknown[]) {
  const items: Array<{ url: string; title?: string; bookmarkId?: string }> = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url) {
      continue;
    }
    items.push({
      url,
      title: typeof row.title === "string" ? row.title.trim() || undefined : undefined,
      bookmarkId: typeof row.bookmarkId === "string"
        ? row.bookmarkId.trim() || undefined
        : undefined,
    });
  }
  return items;
}

function collectSourcePatch(captureScope: CaptureScope): Partial<CaptureSource> {
  const selection = captureScope === "selection"
    ? requireActiveSelection()
    : null;
  const coverImageRoot = selection?.root ?? document.body ?? document.documentElement;
  return {
    canonicalUrl: readCanonicalUrl(),
    coverImageUrl: readCoverImageUrl(coverImageRoot),
    referrer: document.referrer || undefined,
    selectionText: selection?.textPreview || window.getSelection()?.toString() || undefined,
    captureScope,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    savedAt: new Date().toISOString(),
  };
}

function collectLiveSignals(captureScope: CaptureScope): CapturePageSignals {
  if (captureScope === "selection") {
    const selectionRoot = requireActiveSelection().root;
    const rect = selectionRoot.getBoundingClientRect();
    return capturePageSignalsSchema.parse({
      textLength: normalizeText(selectionRoot.innerText || selectionRoot.textContent || "").length,
      imageCount: countScopedMatches(selectionRoot, "img"),
      iframeCount: countScopedMatches(selectionRoot, "iframe"),
      scrollHeight: Math.max(selectionRoot.scrollHeight, Math.round(rect.height)),
      renderHeight: Math.round(rect.height),
      hasCanvas: hasScopedMatch(selectionRoot, "canvas"),
      hasVideo: hasScopedMatch(selectionRoot, "video"),
      previewable: true,
      screenshotGenerated: false,
    });
  }

  return capturePageSignalsSchema.parse({
    textLength: normalizeText(document.body?.innerText ?? "").length,
    imageCount: document.images.length,
    iframeCount: document.querySelectorAll("iframe").length,
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
    renderHeight: window.innerHeight,
    hasCanvas: document.querySelector("canvas") !== null,
    hasVideo: document.querySelector("video") !== null,
    previewable: true,
    screenshotGenerated: false,
  });
}

function normalizeText(text: string) {
  return text.replaceAll(/\s+/g, " ").trim();
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function countScopedMatches(root: HTMLElement, selector: string) {
  return root.querySelectorAll(selector).length + (root.matches(selector) ? 1 : 0);
}

function hasScopedMatch(root: HTMLElement, selector: string) {
  return root.matches(selector) || root.querySelector(selector) !== null;
}

function readCoverImageUrl(root: ParentNode | HTMLElement) {
  const xiaohongshuCoverUrl = readXiaohongshuCoverImageUrl(root);
  if (xiaohongshuCoverUrl) {
    return xiaohongshuCoverUrl;
  }

  const images = root instanceof HTMLElement
    ? [
        ...(root.matches("img") ? [root as HTMLImageElement] : []),
        ...Array.from(root.querySelectorAll("img")),
      ]
    : Array.from(document.images);
  const firstMeaningfulImage = images.find((image) => isQualifiedCoverImage(image));

  return resolveCoverCandidateUrl(firstMeaningfulImage);
}

function readXiaohongshuCoverImageUrl(root: ParentNode | HTMLElement) {
  if (!isXiaohongshuNotePage(new URL(location.href))) {
    return undefined;
  }

  const stateImageUrls = readXiaohongshuStateImageUrls();
  if (stateImageUrls.length > 0) {
    return stateImageUrls[0];
  }

  const videoPosterUrl = readXiaohongshuVideoPosterUrl(root);
  if (videoPosterUrl) {
    return videoPosterUrl;
  }

  const scope = root instanceof HTMLElement ? root : document;
  const candidates = [
    ...scope.querySelectorAll<HTMLImageElement>(".note-slider .swiper-slide img"),
    ...scope.querySelectorAll<HTMLImageElement>(".media-container .img-container img"),
  ];
  const seen = new Set<string>();

  for (const image of candidates) {
    const url = resolveCoverCandidateUrl(image);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    if (isQualifiedCoverImage(image)) {
      return url;
    }
  }

  return undefined;
}

function isXiaohongshuNotePage(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, "");
  return hostname === "xiaohongshu.com" && /^\/explore\/[a-z0-9]+\/?$/i.test(url.pathname);
}

function readXiaohongshuStateImageUrls() {
  const noteState = readXiaohongshuStateNoteRecord();
  const imageList = Array.isArray(noteState?.imageList) ? noteState.imageList : [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of imageList) {
    const record = isRecord(item) ? item : null;
    if (!record) {
      continue;
    }

    const url = normalizeXiaohongshuStateUrl(readXiaohongshuStateImageUrl(record));
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function collectDownloadableMedia() {
  if (!isXiaohongshuNotePage(new URL(location.href))) {
    return [];
  }

  return collectXiaohongshuDownloadableMedia();
}

function collectXiaohongshuDownloadableMedia() {
  const scope = document;
  const media = new Map<string, CaptureDownloadableMedia>();

  const stateImageUrls = readXiaohongshuStateImageUrls();
  stateImageUrls.forEach((url, index) => {
    media.set(`image:${url}`, {
      id: `image-${index + 1}`,
      kind: "image",
      url,
    });
  });

  const domImages = [
    ...scope.querySelectorAll<HTMLImageElement>(".note-slider .swiper-slide img"),
    ...scope.querySelectorAll<HTMLImageElement>(".media-container .img-container img"),
  ];
  for (const [index, image] of domImages.entries()) {
    const url = resolveCoverCandidateUrl(image);
    if (!url) {
      continue;
    }
    media.set(`image:${url}`, {
      id: media.get(`image:${url}`)?.id ?? `image-${index + 1}`,
      kind: "image",
      url,
      width: readPositiveInt(image.naturalWidth || image.width || image.clientWidth),
      height: readPositiveInt(image.naturalHeight || image.height || image.clientHeight),
    });
  }

  const videoUrls = collectXiaohongshuVideoUrls();
  videoUrls.forEach((url, index) => {
    media.set(`video:${url}`, {
      id: `video-${index + 1}`,
      kind: "video",
      url,
    });
  });

  if (videoUrls.length > 0) {
    const coverUrl = readXiaohongshuVideoPosterUrl(document) ?? readXiaohongshuCoverImageUrl(document);
    if (coverUrl) {
      media.set(`video_cover:${coverUrl}`, {
        id: "video-cover-1",
        kind: "video_cover",
        url: coverUrl,
      });
    }
  }

  return [...media.values()];
}

function readXiaohongshuStateNoteRecord() {
  const state = (globalThis as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__
    ?? parseXiaohongshuInitialState(document);
  return readXiaohongshuNoteRecord(state);
}

function readXiaohongshuStateImageUrl(record: Record<string, unknown>) {
  const infoList = Array.isArray(record.infoList) ? record.infoList : [];
  const preferredInfo = infoList.find((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return entry.imageScene === "WB_DFT" && typeof entry.url === "string";
  });
  if (isRecord(preferredInfo) && typeof preferredInfo.url === "string") {
    return preferredInfo.url;
  }

  const fallbackInfo = infoList.find((entry) => isRecord(entry) && typeof entry.url === "string");
  if (isRecord(fallbackInfo) && typeof fallbackInfo.url === "string") {
    return fallbackInfo.url;
  }

  const directCandidates = [record.urlDefault, record.urlPre, record.url];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "";
}

function normalizeXiaohongshuStateUrl(rawUrl: string) {
  const normalized = normalizeCoverImageUrl(rawUrl);
  if (!normalized) {
    return undefined;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol === "http:") {
      url.protocol = "https:";
    }
    url.hash = "";
    return url.href;
  } catch {
    return normalized.replace(/^http:\/\//iu, "https://");
  }
}

function collectXiaohongshuVideoUrls() {
  const urls = new Set<string>();
  const noteState = readXiaohongshuStateNoteRecord();

  for (const video of document.querySelectorAll<HTMLVideoElement>("video")) {
    const candidates = [
      video.currentSrc,
      video.src,
      video.getAttribute("src"),
      ...Array.from(video.querySelectorAll("source"))
        .map((source) => source.getAttribute("src") ?? ""),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeXiaohongshuStateUrl(candidate ?? "");
      if (normalized && isLikelyVideoUrl(normalized)) {
        urls.add(normalized);
      }
    }
  }

  if (noteState) {
    const candidates = collectUrlsFromUnknown(noteState);
    const prioritized = candidates
      .filter((candidate) => candidate.url && isLikelyVideoUrl(candidate.url))
      .sort((left, right) => scoreVideoCandidate(right) - scoreVideoCandidate(left));
    for (const candidate of prioritized) {
      urls.add(candidate.url);
    }
  }

  return [...urls];
}

function readXiaohongshuVideoPosterUrl(root: ParentNode | HTMLElement) {
  const scope = root instanceof HTMLElement ? root : document;
  for (const video of scope.querySelectorAll<HTMLVideoElement>("video")) {
    const poster = normalizeXiaohongshuStateUrl(video.poster);
    if (poster) {
      return poster;
    }
  }

  const noteState = readXiaohongshuStateNoteRecord();
  if (!noteState) {
    return undefined;
  }

  const candidates = collectUrlsFromUnknown(noteState)
    .filter((candidate) => candidate.url && isLikelyImageUrl(candidate.url))
    .sort((left, right) => scorePosterCandidate(right) - scorePosterCandidate(left));
  return candidates[0]?.url;
}

function collectUrlsFromUnknown(
  value: unknown,
  path: string[] = [],
  seen = new Set<unknown>(),
): Array<{ path: string[]; url: string }> {
  if (seen.has(value)) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = normalizeXiaohongshuStateUrl(value);
    return normalized ? [{ path, url: normalized }] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUrlsFromUnknown(item, [...path, String(index)], seen));
  }

  return Object.entries(value).flatMap(([key, nested]) =>
    collectUrlsFromUnknown(nested, [...path, key], seen)
  );
}

function scoreVideoCandidate(candidate: { path: string[]; url: string }) {
  const pathText = candidate.path.join(".").toLowerCase();
  let score = 0;
  if (candidate.url.includes(".mp4") || candidate.url.includes("mp4")) {
    score += 10;
  }
  if (pathText.includes("master") || pathText.includes("origin")) {
    score += 5;
  }
  if (pathText.includes("video") || pathText.includes("stream") || pathText.includes("play")) {
    score += 3;
  }
  if (candidate.url.includes(".m3u8")) {
    score -= 4;
  }
  return score;
}

function scorePosterCandidate(candidate: { path: string[]; url: string }) {
  const pathText = candidate.path.join(".").toLowerCase();
  let score = 0;
  if (pathText.includes("poster") || pathText.includes("cover")) {
    score += 6;
  }
  if (pathText.includes("image") || pathText.includes("thumbnail") || pathText.includes("firstframe")) {
    score += 3;
  }
  return score;
}

function isLikelyVideoUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes(".mp4")
    || lower.includes(".mov")
    || lower.includes(".webm")
    || lower.includes(".m3u8")
    || lower.includes("/video/")
    || lower.includes("videoplay");
}

function isLikelyImageUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes(".jpg")
    || lower.includes(".jpeg")
    || lower.includes(".png")
    || lower.includes(".webp")
    || lower.includes(".gif")
    || lower.includes("/image/")
    || (!isLikelyVideoUrl(url) && (
      lower.includes("poster")
      || lower.includes("cover")
      || lower.includes("thumbnail")
      || lower.includes("firstframe")
      || lower.includes("image")
    ));
}

function readPositiveInt(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isQualifiedCoverImage(image: HTMLImageElement) {
  const url = resolveCoverCandidateUrl(image);
  if (!url) {
    return false;
  }

  const width = image.naturalWidth || image.width || image.clientWidth;
  const height = image.naturalHeight || image.height || image.clientHeight;
  if (width < MIN_COVER_IMAGE_WIDTH || height < MIN_COVER_IMAGE_HEIGHT) {
    return false;
  }

  return width * height >= MIN_COVER_IMAGE_AREA;
}

function resolveCoverCandidateUrl(image: HTMLImageElement | undefined) {
  if (!image) {
    return undefined;
  }

  const candidates = [
    image.currentSrc,
    image.src,
    image.getAttribute("src"),
    image.getAttribute("data-src"),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCoverImageUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeCoverImageUrl(rawUrl: string | null | undefined) {
  const value = rawUrl?.trim();
  if (!value) {
    return undefined;
  }

  try {
    const normalized = new URL(value, location.href);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return undefined;
    }
    return normalized.href;
  } catch {
    return undefined;
  }
}

function readCanonicalUrl() {
  const canonicalElement = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  return canonicalElement?.href || location.href;
}

async function captureArchiveHtml(
  profile: CaptureProfile,
  captureScope: CaptureScope,
): Promise<ArchiveCaptureResult> {
  const logger = createLogger("content");
  const singlefile = (globalThis as SingleFileGlobal).singlefile;
  const options = profileToSingleFileOptions(profile);
  logger.debug("Resolved SingleFile capture options.", {
    profile,
    captureScope,
    options,
  });

  const buildSuccessResult = (archiveHtml: string, usedSingleFile: boolean): ArchiveCaptureResult => {
    const optimizedArchive = optimizeSiteArchiveHtml({
      archiveHtml,
      sourceUrl: location.href,
    });
    const finalizedArchiveHtml = optimizedArchive.archiveHtml;
    if (optimizedArchive.optimized) {
      logger.info("Applied site-specific archive optimization.", {
        rule: optimizedArchive.rule,
        beforeSize: archiveHtml.length,
        afterSize: finalizedArchiveHtml.length,
      });
    }

    let readerHtml: string | undefined;
    try {
      readerHtml = extractReaderArchiveHtml({
        archiveHtml: finalizedArchiveHtml,
        sourceUrl: location.href,
        liveDocument: document,
      }) ?? undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Reader archive extraction failed.", {
        error: message,
      });
    }

    if (readerHtml) {
      logger.info("Reader archive extracted.", {
        archiveSize: finalizedArchiveHtml.length,
        readerSize: readerHtml.length,
      });
    }

    const downloadableMedia = collectDownloadableMedia();

    return {
      ok: true,
      archiveHtml: finalizedArchiveHtml,
      readerHtml,
      downloadableMedia,
      usedSingleFile,
    };
  };

  if (captureScope === "selection") {
    return captureSelectedArchiveHtml({
      logger,
      options,
      singlefile,
      buildSuccessResult,
    });
  }

  if (singlefile?.getPageData) {
    try {
      const pageData = await singlefile.getPageData(options);
      const html = decodeSingleFilePageData(pageData);
      if (html) {
        logger.info("SingleFile returned archive content.", {
          size: html.length,
        });
        return buildSuccessResult(html, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("SingleFile capture failed.", {
        error: message,
      });
      return {
        ok: false,
        error: `singlefile.getPageData failed: ${message}`,
      };
    }
  }

  logger.warn("SingleFile API unavailable, using DOM serialization fallback.");
  return buildSuccessResult(serializeDocumentForFallback(), false);
}

async function captureSelectedArchiveHtml(input: {
  logger: ReturnType<typeof createLogger>;
  options: Record<string, unknown>;
  singlefile: SingleFileGlobal["singlefile"];
  buildSuccessResult: (archiveHtml: string, usedSingleFile: boolean) => ArchiveCaptureResult;
}): Promise<ArchiveCaptureResult> {
  const selection = requireActiveSelection();
  const marker = `keeppage-selection-${crypto.randomUUID()}`;
  selection.root.setAttribute(SELECTION_MARKER_ATTR, marker);

  try {
    if (input.singlefile?.getPageData) {
      try {
        const pageData = await input.singlefile.getPageData(input.options);
        const fullArchiveHtml = decodeSingleFilePageData(pageData);
        if (fullArchiveHtml) {
          const selectedArchiveHtml = extractSelectionArchiveFromHtml(fullArchiveHtml, marker);
          if (selectedArchiveHtml) {
            input.logger.info("SingleFile selection archive extracted.", {
              size: selectedArchiveHtml.length,
              descriptor: selection.descriptor,
            });
            return input.buildSuccessResult(selectedArchiveHtml, true);
          }
          input.logger.warn("Selection marker was not found in archived HTML, using fallback.", {
            descriptor: selection.descriptor,
          });
        }
      } catch (error) {
        input.logger.warn("SingleFile selection capture failed, using fallback.", {
          error: error instanceof Error ? error.message : String(error),
          descriptor: selection.descriptor,
        });
      }
    } else {
      input.logger.warn("SingleFile API unavailable for selection capture, using fallback.");
    }

    return input.buildSuccessResult(serializeSelectionForFallback(selection.root), false);
  } finally {
    selection.root.removeAttribute(SELECTION_MARKER_ATTR);
    clearActiveSelection();
  }
}

function decodeSingleFilePageData(pageData: SingleFilePageData | undefined) {
  if (typeof pageData?.content === "string") {
    return pageData.content;
  }
  if (Array.isArray(pageData?.content)) {
    return new TextDecoder().decode(Uint8Array.from(pageData.content));
  }
  return null;
}

function extractSelectionArchiveFromHtml(archiveHtml: string, marker: string) {
  const archivedDocument = new DOMParser().parseFromString(archiveHtml, "text/html");
  const selectionRoot = archivedDocument.querySelector<HTMLElement>(
    `[${SELECTION_MARKER_ATTR}="${marker}"]`,
  );
  if (!selectionRoot) {
    return null;
  }
  selectionRoot.removeAttribute(SELECTION_MARKER_ATTR);
  return buildStandaloneSelectionDocument(
    archivedDocument.documentElement,
    archivedDocument.head,
    archivedDocument.body,
    selectionRoot,
  );
}

function serializeSelectionForFallback(selectionRoot: HTMLElement) {
  const htmlElement = document.documentElement.cloneNode(false) as HTMLElement;
  const headElement = (document.head ?? document.createElement("head")).cloneNode(true) as HTMLHeadElement;
  const bodyElement = (document.body ?? document.createElement("body")).cloneNode(false) as HTMLBodyElement;
  headElement.querySelectorAll("script, noscript, template").forEach((node) => node.remove());
  return buildStandaloneSelectionDocument(
    htmlElement,
    headElement,
    bodyElement,
    selectionRoot,
  );
}

function buildStandaloneSelectionDocument(
  htmlElement: Element,
  headElement: Element | null,
  bodyElement: Element | null,
  selectionRoot: HTMLElement,
) {
  const branch = buildPrunedSelectionBranch(selectionRoot);
  const headHtml = headElement?.innerHTML.trim() || '<meta charset="UTF-8" />';
  const htmlAttributes = serializeElementAttributes(htmlElement);
  const bodyAttributes = serializeElementAttributes(bodyElement);
  return `<!DOCTYPE html>
<html${htmlAttributes}>
  <head>
${indentHtml(headHtml, 4)}
  </head>
  <body${bodyAttributes}>
${indentHtml(branch.outerHTML, 4)}
  </body>
</html>`;
}

function buildPrunedSelectionBranch(selectionRoot: HTMLElement) {
  let branch = selectionRoot.cloneNode(true) as HTMLElement;
  branch.removeAttribute(SELECTION_MARKER_ATTR);
  let current = selectionRoot.parentElement;
  while (current && current.tagName !== "BODY") {
    const ancestorClone = current.cloneNode(false) as HTMLElement;
    ancestorClone.append(branch);
    branch = ancestorClone;
    current = current.parentElement;
  }
  return branch;
}

function serializeElementAttributes(element: Element | null | undefined) {
  if (!element) {
    return "";
  }
  const entries = Array.from(element.attributes)
    .filter((attribute) => attribute.name !== SELECTION_MARKER_ATTR)
    .map((attribute) => `${attribute.name}="${escapeHtmlAttribute(attribute.value)}"`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

function indentHtml(content: string, size: number) {
  const indent = " ".repeat(size);
  return content
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function escapeHtmlAttribute(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeDocumentForFallback() {
  const docType = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}>`
    : "<!DOCTYPE html>";
  return `${docType}\n${document.documentElement.outerHTML}`;
}

function profileToSingleFileOptions(profile: CaptureProfile) {
  const shared = {
    blockScripts: true,
    removeFrames: false,
    url: location.href,
  };

  if (profile === "complete") {
    return {
      ...shared,
      removeHiddenElements: false,
      compressHTML: false,
      removeUnusedStyles: false,
      removeUnusedFonts: false,
      loadDeferredImages: true,
      loadDeferredImagesMaxIdleTime: 1500,
    };
  }
  if (profile === "dynamic") {
    return {
      ...shared,
      removeHiddenElements: false,
      loadDeferredImages: true,
      loadDeferredImagesBeforeFrames: false,
      loadDeferredImagesMaxIdleTime: 2500,
      autoSaveExternalSave: false,
    };
  }
  if (profile === "lightweight") {
    return {
      ...shared,
      compressHTML: true,
      removeUnusedStyles: true,
      removeUnusedFonts: true,
      loadDeferredImages: false,
      removeAlternativeImages: true,
      removeAlternativeFonts: true,
    };
  }
  return {
    ...shared,
    compressHTML: true,
    loadDeferredImages: true,
    loadDeferredImagesMaxIdleTime: 1000,
  };
}

function startSelectionCapture(input: { profile: CaptureProfile; saveMode: SaveMode }) {
  stopSelectionCapture();
  clearActiveSelection();
  const overlay = ensureSelectionOverlay();
  overlay.host.hidden = false;
  overlay.helper.textContent = "点击页面内容开始保存，按 Esc 取消";

  const session: SelectionSession = {
    ...input,
    hoveredElement: null,
    overlay,
    detach: () => {},
  };

  const handlePointerMove = (event: PointerEvent) => {
    setSelectionHoverTarget(resolveSelectableElement(document.elementFromPoint(
      event.clientX,
      event.clientY,
    )));
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = resolveSelectableElement(event.target);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void confirmSelectionCapture(target);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    stopSelectionCapture();
    showInPageToast({
      title: "已取消选区保存",
      message: "需要时可以重新点击“选择区域保存”。",
    });
  };

  const handleViewportChange = () => {
    refreshSelectionOverlay();
  };

  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);

  session.detach = () => {
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange);
  };

  selectionSession = session;
  const initialTarget = resolveSelectableElement(
    document.elementFromPoint(
      Math.round(window.innerWidth / 2),
      Math.round(Math.min(window.innerHeight - 32, Math.max(80, window.innerHeight * 0.3))),
    ),
  );
  setSelectionHoverTarget(initialTarget);
}

async function confirmSelectionCapture(target: HTMLElement) {
  const session = selectionSession;
  if (!session) {
    return;
  }

  const selection: ActiveSelection = {
    root: target,
    descriptor: describeElement(target),
    textPreview: buildSelectionTextPreview(target),
  };
  activeSelection = selection;
  stopSelectionCapture();
  showInPageToast({
    title: "已选中保存区域",
    message: selection.textPreview
      ? `正在保存：${truncateText(selection.textPreview, 40)}`
      : "正在生成该区域的归档。",
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.TriggerCaptureActiveTab,
      profile: session.profile,
      saveMode: session.saveMode,
      captureScope: "selection",
    });
    if (!response?.ok) {
      clearActiveSelection();
      showInPageToast({
        title: "选区保存启动失败",
        message: response?.error ?? "请稍后重试。",
      });
    }
  } catch (error) {
    clearActiveSelection();
    showInPageToast({
      title: "选区保存启动失败",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function stopSelectionCapture() {
  if (!selectionSession) {
    hideSelectionOverlay();
    return;
  }
  selectionSession.detach();
  selectionSession = null;
  hideSelectionOverlay();
}

function setSelectionHoverTarget(target: HTMLElement | null) {
  if (!selectionSession) {
    return;
  }
  selectionSession.hoveredElement = target;
  refreshSelectionOverlay();
}

function refreshSelectionOverlay() {
  const session = selectionSession;
  if (!session) {
    hideSelectionOverlay();
    return;
  }

  const target = session.hoveredElement;
  if (!target || !target.isConnected) {
    session.overlay.frame.dataset.visible = "false";
    session.overlay.label.dataset.visible = "false";
    return;
  }

  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    session.overlay.frame.dataset.visible = "false";
    session.overlay.label.dataset.visible = "false";
    return;
  }

  session.overlay.frame.dataset.visible = "true";
  session.overlay.label.dataset.visible = "true";
  session.overlay.frame.style.left = `${Math.round(rect.left)}px`;
  session.overlay.frame.style.top = `${Math.round(rect.top)}px`;
  session.overlay.frame.style.width = `${Math.round(rect.width)}px`;
  session.overlay.frame.style.height = `${Math.round(rect.height)}px`;

  const labelText = `${describeElement(target)}${buildSelectionTextPreview(target) ? ` · ${truncateText(buildSelectionTextPreview(target), 34)}` : ""}`;
  session.overlay.label.textContent = labelText;
  session.overlay.label.style.left = `${Math.round(clamp(rect.left, 12, window.innerWidth - 220))}px`;
  session.overlay.label.style.top = `${Math.round(
    rect.top > 48 ? rect.top - 42 : Math.min(window.innerHeight - 44, rect.bottom + 10),
  )}px`;
}

function hideSelectionOverlay() {
  if (!selectionOverlayElements) {
    return;
  }
  selectionOverlayElements.host.hidden = true;
  selectionOverlayElements.frame.dataset.visible = "false";
  selectionOverlayElements.label.dataset.visible = "false";
}

function resolveSelectableElement(target: EventTarget | Element | null) {
  let element = target instanceof Element ? target : null;
  let fallback: HTMLElement | null = null;

  while (element) {
    if (!(element instanceof HTMLElement)) {
      element = element.parentElement;
      continue;
    }
    if (element.id === TOAST_HOST_ID || element.id === SELECTION_OVERLAY_HOST_ID) {
      return null;
    }
    if (isIgnoredSelectionElement(element)) {
      element = element.parentElement;
      continue;
    }
    if (!isVisibleSelectionElement(element)) {
      element = element.parentElement;
      continue;
    }
    if (!fallback) {
      fallback = element;
    }
    if (PREFERRED_SELECTION_TAGS.has(element.tagName)) {
      return element;
    }
    element = element.parentElement;
  }

  return fallback;
}

function isIgnoredSelectionElement(element: HTMLElement) {
  return [
    "BODY",
    "HEAD",
    "HTML",
    "IFRAME",
    "LINK",
    "META",
    "NOSCRIPT",
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
  ].includes(element.tagName);
}

function isVisibleSelectionElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width >= 18 && rect.height >= 18;
}

function describeElement(element: HTMLElement) {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${truncateText(element.id, 18)}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((token) => `.${truncateText(token, 14)}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function buildSelectionTextPreview(element: HTMLElement) {
  const directText = normalizeText(element.innerText || element.textContent || "");
  if (directText) {
    return truncateText(directText, 120);
  }
  const altText = normalizeText(
    element.getAttribute("aria-label")
      || element.getAttribute("title")
      || (element instanceof HTMLImageElement ? element.alt : ""),
  );
  return truncateText(altText, 120);
}

function requireActiveSelection() {
  if (!activeSelection?.root?.isConnected) {
    activeSelection = null;
    throw new Error("没有找到已选中的页面区域，请重新选择后再保存。");
  }
  return activeSelection;
}

function clearActiveSelection() {
  activeSelection = null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function showInPageToast(input: { title: string; message?: string }) {
  const ui = ensureToastElements();

  ui.title.textContent = input.title;
  const normalizedMessage = input.message?.trim() ?? "";
  ui.message.textContent = normalizedMessage;
  ui.message.hidden = normalizedMessage.length === 0;
  ui.host.hidden = false;
  ui.toast.dataset.state = "hidden";

  if (toastDismissTimer != null) {
    window.clearTimeout(toastDismissTimer);
  }
  if (toastRemovalTimer != null) {
    window.clearTimeout(toastRemovalTimer);
  }

  requestAnimationFrame(() => {
    ui.toast.dataset.state = "visible";
  });

  toastDismissTimer = window.setTimeout(() => {
    ui.toast.dataset.state = "leaving";
    toastRemovalTimer = window.setTimeout(() => {
      ui.host.hidden = true;
    }, 220);
  }, 2600);
}

function ensureToastElements() {
  if (toastElements && document.contains(toastElements.host)) {
    return toastElements;
  }

  const host = document.createElement("div");
  host.id = TOAST_HOST_ID;
  host.hidden = true;

  const shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .viewport {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }

    .toast {
      position: absolute;
      top: 22px;
      right: 22px;
      width: min(360px, calc(100vw - 28px));
      box-sizing: border-box;
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(110, 231, 183, 0.28);
      background:
        linear-gradient(135deg, rgba(15, 118, 110, 0.98), rgba(15, 23, 42, 0.98));
      box-shadow:
        0 18px 60px rgba(15, 23, 42, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
      color: #f8fafc;
      opacity: 0;
      transform: translateY(-14px) scale(0.96);
      transition:
        opacity 180ms ease,
        transform 220ms ease;
      backdrop-filter: blur(16px);
    }

    .toast[data-state="visible"] {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .toast[data-state="leaving"] {
      opacity: 0;
      transform: translateY(-10px) scale(0.98);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      color: rgba(236, 253, 245, 0.9);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .eyebrow::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #6ee7b7;
      box-shadow: 0 0 0 6px rgba(110, 231, 183, 0.18);
      flex: none;
    }

    .title {
      margin: 0;
      font-size: 16px;
      line-height: 1.35;
      font-weight: 700;
    }

    .message {
      margin: 6px 0 0;
      color: rgba(241, 245, 249, 0.82);
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
  `;

  const viewport = document.createElement("div");
  viewport.className = "viewport";

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.state = "hidden";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "KeepPage";

  const title = document.createElement("p");
  title.className = "title";

  const message = document.createElement("p");
  message.className = "message";

  toast.append(eyebrow, title, message);
  viewport.append(toast);
  shadowRoot.append(style, viewport);
  (document.body ?? document.documentElement).append(host);

  toastElements = {
    host,
    toast,
    title,
    message,
  };
  return toastElements;
}

function ensureSelectionOverlay() {
  if (selectionOverlayElements && document.contains(selectionOverlayElements.host)) {
    return selectionOverlayElements;
  }

  const host = document.createElement("div");
  host.id = SELECTION_OVERLAY_HOST_ID;
  host.hidden = true;

  const shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .viewport {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      font-family: "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }

    .frame {
      position: fixed;
      border-radius: 18px;
      border: 2px solid rgba(15, 118, 110, 0.95);
      background: rgba(45, 212, 191, 0.12);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.3),
        0 18px 48px rgba(15, 23, 42, 0.2);
      opacity: 0;
      transition:
        left 80ms ease,
        top 80ms ease,
        width 80ms ease,
        height 80ms ease,
        opacity 80ms ease;
    }

    .frame[data-visible="true"] {
      opacity: 1;
    }

    .label {
      position: fixed;
      max-width: min(60vw, 420px);
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
      opacity: 0;
      transition:
        left 80ms ease,
        top 80ms ease,
        opacity 80ms ease;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .label[data-visible="true"] {
      opacity: 1;
    }

    .helper {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.92);
      color: rgba(248, 250, 252, 0.96);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.2);
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
    }
  `;

  const viewport = document.createElement("div");
  viewport.className = "viewport";

  const frame = document.createElement("div");
  frame.className = "frame";
  frame.dataset.visible = "false";

  const label = document.createElement("div");
  label.className = "label";
  label.dataset.visible = "false";

  const helper = document.createElement("div");
  helper.className = "helper";
  helper.textContent = "点击页面内容开始保存，按 Esc 取消";

  viewport.append(frame, label, helper);
  shadowRoot.append(style, viewport);
  (document.body ?? document.documentElement).append(host);

  selectionOverlayElements = {
    host,
    frame,
    label,
    helper,
  };
  return selectionOverlayElements;
}
