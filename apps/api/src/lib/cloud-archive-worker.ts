import { createHash } from "node:crypto";
import { ensureArchiveBaseHref, type QualityReport } from "@keeppage/domain";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";

export type CloudArchiveFetchResult = {
  html: string;
  title: string;
  textLength: number;
  imageCount: number;
};

export async function fetchPageWithPuppeteer(
  url: string,
  timeoutMs: number,
): Promise<CloudArchiveFetchResult> {
  const puppeteer = await import("puppeteer");
  let browser;

  try {
    browser = await puppeteer.default.launch({
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
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });

    const result = await page.evaluate(() => {
      const title = document.title || "";
      const textLength = (document.body?.innerText || "").length;
      const imageCount = document.querySelectorAll("img").length;
      return { title, textLength, imageCount };
    });

    const html = await page.content();
    await page.close();

    return {
      html,
      title: result.title,
      textLength: result.textLength,
      imageCount: result.imageCount,
    };
  } finally {
    await browser.close();
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
  const resolvedTitle = input.title || fetchResult.title || new URL(url).hostname;

  const archiveHtml = ensureArchiveBaseHref(fetchResult.html, url);
  const archiveBuffer = Buffer.from(archiveHtml, "utf-8");
  const htmlSha256 = createHash("sha256").update(archiveBuffer).digest("hex");

  const initResult = await repository.initCapture(userId, {
    url,
    title: resolvedTitle,
    fileSize: archiveBuffer.byteLength,
    htmlSha256,
    profile: "standard",
    deviceId: "cloud-archive",
  });

  await objectStorage.putObject(initResult.objectKey, archiveBuffer, {
    contentType: "text/html;charset=utf-8",
  });

  const now = new Date().toISOString();
  const domain = new URL(url).hostname;

  const quality: QualityReport = {
    score: 70,
    grade: "medium",
    reasons: [{
      code: "cloud-archive",
      message: "云端存档：未使用扩展本地抓取，保真度可能低于本地存档。",
      impact: 10,
    }],
    liveSignals: {
      textLength: fetchResult.textLength,
      imageCount: fetchResult.imageCount,
      iframeCount: 0,
      scrollHeight: 0,
      hasCanvas: false,
      hasVideo: false,
      previewable: true,
      screenshotGenerated: false,
    },
    archiveSignals: {
      textLength: fetchResult.textLength,
      imageCount: fetchResult.imageCount,
      iframeCount: 0,
      scrollHeight: 0,
      fileSize: archiveBuffer.byteLength,
      hasCanvas: false,
      hasVideo: false,
      previewable: true,
      screenshotGenerated: false,
    },
  };

  const completeResult = await repository.completeCapture(userId, {
    objectKey: initResult.objectKey,
    htmlSha256,
    quality,
    source: {
      url,
      title: resolvedTitle,
      domain,
      captureScope: "page",
      viewport: { width: 1280, height: 900 },
      savedAt: now,
    },
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
