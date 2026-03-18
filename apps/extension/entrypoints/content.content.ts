import {
  capturePageSignalsSchema,
  captureProfileSchema,
  type CapturePageSignals,
  type CaptureProfile,
  type CaptureSource,
} from "@keeppage/domain";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  MESSAGE_TYPE,
  isContentRequest,
  type CaptureArchiveHtmlResponse,
  type CollectLiveSignalsResponse,
} from "../src/lib/messages";

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

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isContentRequest(message)) {
        return false;
      }

      void (async () => {
        if (message.type === MESSAGE_TYPE.CollectLiveSignals) {
          const response: CollectLiveSignalsResponse = {
            ok: true,
            sourcePatch: collectSourcePatch(),
            liveSignals: collectLiveSignals(),
          };
          sendResponse(response);
          return;
        }
        if (message.type === MESSAGE_TYPE.CaptureArchiveHtml) {
          const profile = captureProfileSchema.parse(message.profile);
          const capture = await captureArchiveHtml(profile);
          const response: CaptureArchiveHtmlResponse = capture.ok
            ? {
                ok: true,
                archiveHtml: capture.archiveHtml,
                usedSingleFile: capture.usedSingleFile,
              }
            : {
                ok: false,
                error: capture.error,
              };
          sendResponse(response);
        }
      })().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: reason });
      });

      return true;
    });
  },
});

function collectSourcePatch(): Partial<CaptureSource> {
  return {
    canonicalUrl: readCanonicalUrl(),
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

function readCanonicalUrl() {
  const canonicalElement = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  return canonicalElement?.href || location.href;
}

async function captureArchiveHtml(profile: CaptureProfile) {
  const singlefile = (globalThis as SingleFileGlobal).singlefile;
  const options = profileToSingleFileOptions(profile);

  // Official integration slot:
  // Once SingleFile MV3 core bundles are wired in document_start hooks,
  // this call will produce canonical archive HTML directly.
  if (singlefile?.getPageData) {
    try {
      const pageData = await singlefile.getPageData(options);
      if (typeof pageData?.content === "string") {
        return {
          ok: true as const,
          archiveHtml: pageData.content,
          usedSingleFile: true,
        };
      }
      if (Array.isArray(pageData?.content)) {
        const html = new TextDecoder().decode(Uint8Array.from(pageData.content));
        return {
          ok: true as const,
          archiveHtml: html,
          usedSingleFile: true,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false as const,
        error: `singlefile.getPageData failed: ${message}`,
      };
    }
  }

  return {
    ok: true as const,
    archiveHtml: serializeDocumentForFallback(),
    usedSingleFile: false,
  };
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
