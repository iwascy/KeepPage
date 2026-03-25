import { createHash } from "node:crypto";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const readabilityRuntimePath = require.resolve("@mozilla/readability/Readability.js");
const cloudArchivePageRuntimePath = fileURLToPath(
  new URL("../../browser-assets/cloud-archive-page-runtime.js", import.meta.url),
);

type CloudArchiveSourcePatch = Pick<
  CaptureSource,
  "canonicalUrl" | "coverImageUrl" | "referrer" | "captureScope" | "viewport" | "savedAt"
>;

export type CloudArchiveFetchResult = {
  title: string;
  archiveHtml: string;
  readerHtml?: string;
  liveSignals: CapturePageSignals;
  sourcePatch: CloudArchiveSourcePatch;
  screenshotGenerated: boolean;
};

export async function fetchPageWithPuppeteer(
  url: string,
  timeoutMs: number,
): Promise<CloudArchiveFetchResult> {
  const puppeteerModuleName = "puppeteer";
  const puppeteer = await import(puppeteerModuleName);
  const puppeteerApi = (
    puppeteer as {
      default?: { launch: (options: Record<string, unknown>) => Promise<unknown> };
      launch?: (options: Record<string, unknown>) => Promise<unknown>;
    }
  ).default ?? puppeteer;
  let browser: {
    newPage: () => Promise<{
      setBypassCSP: (enabled: boolean) => Promise<void>;
      setViewport: (viewport: { width: number; height: number }) => Promise<void>;
      goto: (targetUrl: string, options: Record<string, unknown>) => Promise<unknown>;
      addScriptTag: (options: { path: string }) => Promise<unknown>;
      evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
      screenshot: (options: Record<string, unknown>) => Promise<unknown>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  } | null = null;

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
    await page.setBypassCSP(true);
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });
    await page.addScriptTag({ path: readabilityRuntimePath });
    await page.addScriptTag({ path: cloudArchivePageRuntimePath });

    const result = await page.evaluate(() => {
      const runtime = (
        globalThis as unknown as {
          __KEEPPAGE_CLOUD_ARCHIVE__?: {
            collectPageCaptureArtifacts: () => unknown;
          };
        }
      ).__KEEPPAGE_CLOUD_ARCHIVE__;
      if (!runtime) {
        throw new Error("KeepPage cloud archive runtime is not available in the page context.");
      }
      return runtime.collectPageCaptureArtifacts();
    }) as {
      title: string;
      archiveHtml: string;
      readerHtml?: string;
      liveSignals: CapturePageSignals;
      sourcePatch: CloudArchiveSourcePatch;
    };

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
      title: result.title,
      archiveHtml: result.archiveHtml,
      readerHtml: result.readerHtml,
      liveSignals: result.liveSignals,
      sourcePatch: result.sourcePatch,
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
