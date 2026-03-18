import {
  type Bookmark,
  type BookmarkDetailResponse,
  type BookmarkDetailVersion,
  bookmarkDetailResponseSchema,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  type QualityGrade,
  type QualityReport,
} from "@keeppage/domain";
import { mockBookmarks } from "./mockData";

type DataSource = "api" | "mock";

export type BookmarkQuery = {
  search: string;
  quality: "all" | QualityGrade;
};

export type BookmarkResult = {
  items: Bookmark[];
  source: DataSource;
};

export type BookmarkViewerVersion = BookmarkDetailVersion & {
  previewUrl?: string;
  downloadUrl?: string;
};

export type BookmarkDetailResult = {
  bookmark: Bookmark;
  versions: BookmarkViewerVersion[];
  source: DataSource;
};

function resolveApiBase() {
  return (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

function buildObjectUrl(objectKey: string) {
  return `${resolveApiBase()}/objects/${encodeURIComponent(objectKey)}`;
}

function applyLocalFilter(items: Bookmark[], query: BookmarkQuery) {
  const searchNeedle = query.search.trim().toLowerCase();
  return items.filter((item) => {
    const gradePass = query.quality === "all" || item.latestQuality?.grade === query.quality;
    if (!gradePass) {
      return false;
    }
    if (!searchNeedle) {
      return true;
    }
    const textToSearch = [
      item.title,
      item.sourceUrl,
      item.domain,
      item.note,
      item.folder?.path ?? "",
      ...item.tags.map((tag) => tag.name),
    ]
      .join(" ")
      .toLowerCase();
    return textToSearch.includes(searchNeedle);
  });
}

function normalizeBookmarks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => bookmarkSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function buildPreviewVersion(version: BookmarkDetailVersion): BookmarkViewerVersion {
  if (!version.archiveAvailable) {
    return version;
  }
  const objectUrl = buildObjectUrl(version.htmlObjectKey);
  return {
    ...version,
    previewUrl: objectUrl,
    downloadUrl: objectUrl,
  };
}

function createFallbackQuality(bookmark: Bookmark): QualityReport {
  return (
    bookmark.latestQuality ?? {
      score: 80,
      grade: "medium",
      reasons: [],
      liveSignals: {
        textLength: 4000,
        imageCount: 3,
        iframeCount: 0,
        scrollHeight: 4800,
        renderHeight: 4780,
        fileSize: 180000,
        previewable: true,
        screenshotGenerated: true,
        hasCanvas: false,
        hasVideo: false,
      },
      archiveSignals: {
        textLength: 3920,
        imageCount: 3,
        iframeCount: 0,
        scrollHeight: 4780,
        renderHeight: 4760,
        fileSize: 178000,
        previewable: true,
        screenshotGenerated: true,
        hasCanvas: false,
        hasVideo: false,
      },
    }
  );
}

function createMockPreviewHtml(bookmark: Bookmark, versionNo: number) {
  const quality = createFallbackQuality(bookmark);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(bookmark.title)} - v${versionNo}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; color: #1c1b17; }
      .card { max-width: 840px; margin: 0 auto; border: 1px solid #e8dcc6; border-radius: 18px; padding: 24px; background: #fffdf9; }
      h1 { margin-top: 0; }
      code { background: #f5efe3; padding: 2px 6px; border-radius: 6px; }
      .meta { color: #5f5a4f; }
    </style>
  </head>
  <body>
    <article class="card">
      <p class="meta">KeepPage Mock Archive · Version ${versionNo}</p>
      <h1>${escapeHtml(bookmark.title)}</h1>
      <p>这是开发态 mock 归档预览，用来验证三栏归档查看页布局。</p>
      <p>原始链接：<a href="${escapeHtml(bookmark.sourceUrl)}">${escapeHtml(bookmark.sourceUrl)}</a></p>
      <p>当前质量：<strong>${quality.grade}</strong> / ${quality.score}</p>
      <p>${escapeHtml(bookmark.note || "暂无备注。")}</p>
      <hr />
      <p>真实环境下，这里会渲染 API 返回的 <code>archive.html</code> 主档内容。</p>
    </article>
  </body>
</html>`;
}

function buildMockDetail(bookmarkId: string): BookmarkDetailResult | null {
  const bookmark = mockBookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    return null;
  }

  const total = Math.max(1, bookmark.versionCount);
  const versions: BookmarkViewerVersion[] = Array.from({ length: total }, (_, index) => {
    const versionNo = total - index;
    const html = createMockPreviewHtml(bookmark, versionNo);
    const quality = createFallbackQuality(bookmark);
    const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    const createdAt = new Date(
      new Date(bookmark.updatedAt).getTime() - index * 1000 * 60 * 90,
    ).toISOString();

    return {
      id: versionNo === total ? (bookmark.latestVersionId ?? `${bookmark.id}_latest`) : `${bookmark.id}_v${versionNo}`,
      bookmarkId: bookmark.id,
      versionNo,
      htmlObjectKey: `mock/${bookmark.id}/v${versionNo}.html`,
      htmlSha256: `${bookmark.id}_sha_${versionNo}`,
      textSha256: `${bookmark.id}_text_${versionNo}`,
      textSimhash: `${bookmark.id}_sim_${versionNo}`,
      captureProfile: versionNo === total ? "complete" : "standard",
      quality,
      createdAt,
      archiveAvailable: true,
      archiveSizeBytes: new TextEncoder().encode(html).byteLength,
      previewUrl,
      downloadUrl: previewUrl,
    } satisfies BookmarkViewerVersion;
  });

  return {
    bookmark,
    versions,
    source: "mock",
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseBookmarkDetail(value: unknown): BookmarkDetailResponse | null {
  const parsed = bookmarkDetailResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export async function fetchBookmarks(query: BookmarkQuery): Promise<BookmarkResult> {
  const params = new URLSearchParams();
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }
  if (query.quality !== "all") {
    params.set("quality", query.quality);
  }
  const apiUrl = `${resolveApiBase()}/bookmarks${params.toString() ? `?${params.toString()}` : ""}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`API response ${response.status}`);
    }
    const json = (await response.json()) as unknown;
    const parsed = bookmarkSearchResponseSchema.safeParse(json);
    if (parsed.success) {
      return {
        items: applyLocalFilter(parsed.data.items, query),
        source: "api",
      };
    }

    const fallbackArray = normalizeBookmarks(json);
    if (fallbackArray.length > 0) {
      return {
        items: applyLocalFilter(fallbackArray, query),
        source: "api",
      };
    }
    throw new Error("Invalid API payload format");
  } catch {
    return {
      items: applyLocalFilter(mockBookmarks, query),
      source: "mock",
    };
  }
}

export async function fetchBookmarkDetail(bookmarkId: string): Promise<BookmarkDetailResult | null> {
  const apiUrl = `${resolveApiBase()}/bookmarks/${encodeURIComponent(bookmarkId)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
      },
    });
    if (response.status === 404) {
      return buildMockDetail(bookmarkId);
    }
    if (!response.ok) {
      throw new Error(`API response ${response.status}`);
    }

    const json = (await response.json()) as unknown;
    const parsed = parseBookmarkDetail(json);
    if (!parsed) {
      throw new Error("Invalid bookmark detail payload");
    }

    return {
      bookmark: parsed.bookmark,
      versions: parsed.versions.map(buildPreviewVersion),
      source: "api",
    };
  } catch {
    return buildMockDetail(bookmarkId);
  }
}
