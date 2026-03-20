import type {
  CapturePageSignals,
  CaptureProfile,
  CaptureSource,
} from "@keeppage/domain";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  MESSAGE_TYPE,
  isDebugLogEvent,
  isContentRequest,
  type CaptureArchiveHtmlResponse,
  type CollectLiveSignalsResponse,
  type ShowInPageToastResponse,
} from "../src/lib/messages";
import {
  capturePageSignalsSchema,
  captureProfileSchema,
} from "../src/lib/domain-runtime";
import { createLogger, logToConsole } from "../src/lib/logger";
import { extractReaderArchiveHtml } from "../src/lib/site-archive";

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

type ToastElements = {
  host: HTMLDivElement;
  toast: HTMLDivElement;
  title: HTMLParagraphElement;
  message: HTMLParagraphElement;
};

const TOAST_HOST_ID = "keeppage-in-page-toast";
let toastElements: ToastElements | null = null;
let toastDismissTimer: number | null = null;
let toastRemovalTimer: number | null = null;

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
          logger.info("Collecting live signals.", {
            url: location.href,
          });
          logger.debug("Collecting source patch and DOM-based live signals.", {
            canonicalUrl: readCanonicalUrl(),
            referrer: document.referrer || undefined,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          });
          const response: CollectLiveSignalsResponse = {
            ok: true,
            sourcePatch: collectSourcePatch(),
            liveSignals: collectLiveSignals(),
          };
          logger.info("Live signals collected.", response.liveSignals);
          sendResponse(response);
          return;
        }
        if (message.type === MESSAGE_TYPE.CaptureArchiveHtml) {
          const profile = captureProfileSchema.parse(message.profile);
          logger.info("Capturing archive HTML.", {
            url: location.href,
            profile,
          });
          const capture = await captureArchiveHtml(profile);
          const response: CaptureArchiveHtmlResponse = capture.ok
            ? {
                ok: true,
                archiveHtml: capture.archiveHtml,
                readerHtml: capture.readerHtml,
                usedSingleFile: capture.usedSingleFile,
              }
            : {
                ok: false,
                error: capture.error,
              };
          if (capture.ok) {
            logger.info("Archive HTML captured.", {
              usedSingleFile: capture.usedSingleFile,
              archiveSize: capture.archiveHtml.length,
            });
          } else {
            logger.warn("Archive HTML capture failed.", {
              error: capture.error,
            });
          }
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
  },
});

function collectSourcePatch(): Partial<CaptureSource> {
  return {
    canonicalUrl: readCanonicalUrl(),
    coverImageUrl: readCoverImageUrl(),
    referrer: document.referrer || undefined,
    selectionText: window.getSelection()?.toString() || undefined,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    savedAt: new Date().toISOString(),
  };
}

function collectLiveSignals(): CapturePageSignals {
  return capturePageSignalsSchema.parse({
    textLength: normalizeText(document.body?.innerText ?? "").length,
    imageCount: document.images.length,
    iframeCount: document.querySelectorAll("iframe").length,
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
    hasCanvas: document.querySelector("canvas") !== null,
    hasVideo: document.querySelector("video") !== null,
    previewable: true,
    screenshotGenerated: false,
  });
}

function normalizeText(text: string) {
  return text.replaceAll(/\s+/g, " ").trim();
}

function readCoverImageUrl() {
  const firstMeaningfulImage = Array.from(document.images).find((image) => {
    const url = resolveCoverCandidateUrl(image);
    if (!url) {
      return false;
    }
    const width = image.naturalWidth || image.width || image.clientWidth;
    const height = image.naturalHeight || image.height || image.clientHeight;
    return width >= 96 && height >= 96;
  });

  return resolveCoverCandidateUrl(firstMeaningfulImage);
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

async function captureArchiveHtml(profile: CaptureProfile) {
  const logger = createLogger("content");
  const singlefile = (globalThis as SingleFileGlobal).singlefile;
  const options = profileToSingleFileOptions(profile);
  logger.debug("Resolved SingleFile capture options.", {
    profile,
    options,
  });

  const buildSuccessResult = (archiveHtml: string, usedSingleFile: boolean) => {
    let readerHtml: string | undefined;
    try {
      readerHtml = extractReaderArchiveHtml({
        archiveHtml,
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
        archiveSize: archiveHtml.length,
        readerSize: readerHtml.length,
      });
    }

    return {
      ok: true as const,
      archiveHtml,
      readerHtml,
      usedSingleFile,
    };
  };

  // Official integration slot:
  // Once SingleFile MV3 core bundles are wired in document_start hooks,
  // this call will produce canonical archive HTML directly.
  if (singlefile?.getPageData) {
    try {
      const pageData = await singlefile.getPageData(options);
      if (typeof pageData?.content === "string") {
        logger.info("SingleFile returned string content.", {
          size: pageData.content.length,
        });
        return buildSuccessResult(pageData.content, true);
      }
      if (Array.isArray(pageData?.content)) {
        const html = new TextDecoder().decode(Uint8Array.from(pageData.content));
        logger.info("SingleFile returned byte-array content.", {
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
        ok: false as const,
        error: `singlefile.getPageData failed: ${message}`,
      };
    }
  }

  logger.warn("SingleFile API unavailable, using DOM serialization fallback.");
  return buildSuccessResult(serializeDocumentForFallback(), false);
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
