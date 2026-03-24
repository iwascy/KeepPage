import type {
  AuthUser,
  Bookmark,
  BookmarkDetailVersion,
  Folder,
  QualityGrade,
  QualityReport,
  Tag,
} from "@keeppage/domain";
import type {
  BookmarkDetailResult,
  BookmarkQuery,
  ImportMode,
  ImportPreviewRequest,
  ImportPreviewResult,
  ImportTaskDetailResult,
  ImportTaskItem,
  ImportTaskSummary,
} from "./api";

export type DemoWorkspace = {
  user: AuthUser;
  folders: Folder[];
  tags: Tag[];
  bookmarks: Bookmark[];
  versionsByBookmarkId: Record<string, BookmarkDetailVersion[]>;
  archiveHtmlByVersionId: Record<string, string>;
  importTasks: ImportTaskDetailResult[];
  nextId: number;
};

type ParsedImportItem = {
  raw: string;
  title: string;
  url?: string;
  domain?: string;
  folderPath?: string;
  sourceTags?: string[];
  reason?: string;
};

const DEMO_CREATED_AT = "2026-03-10T09:00:00.000Z";

function parseUrl(input: string) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, "");
}

function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)));
}

function readHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"([\\s\\S]*?)"`, "i"));
  return match ? decodeHtml(match[1]) : undefined;
}

function splitTags(rawValue?: string) {
  if (!rawValue?.trim()) {
    return [];
  }
  return [...new Set(
    rawValue
      .split(/[;,]/g)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function createQuality(
  score: number,
  grade: QualityGrade,
  overrides: Partial<QualityReport> = {},
): QualityReport {
  return {
    score,
    grade,
    reasons: overrides.reasons ?? [],
    liveSignals: overrides.liveSignals ?? {
      textLength: 9800,
      imageCount: 10,
      iframeCount: 1,
      scrollHeight: 8600,
      renderHeight: 8580,
      fileSize: 512000,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: false,
    },
    archiveSignals: overrides.archiveSignals ?? {
      textLength: 9100,
      imageCount: 10,
      iframeCount: 1,
      scrollHeight: 8560,
      renderHeight: 8540,
      fileSize: 498000,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: false,
    },
  };
}

function buildArchiveHtml(title: string, sourceUrl: string, summary: string, accent: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="${sourceUrl}" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f1e6;
        --surface: rgba(255, 255, 255, 0.82);
        --line: rgba(40, 31, 18, 0.12);
        --text: #201b14;
        --muted: #655d51;
        --accent: ${accent};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 10% 0%, rgba(255, 216, 154, 0.85), transparent 36%),
          radial-gradient(circle at 100% 20%, rgba(182, 223, 255, 0.8), transparent 32%),
          linear-gradient(180deg, var(--bg) 0%, #e8dfd0 100%);
        min-height: 100vh;
        padding: 48px 20px 72px;
      }
      .frame {
        width: min(920px, 100%);
        margin: 0 auto;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--surface);
        backdrop-filter: blur(12px);
        box-shadow: 0 28px 60px rgba(39, 29, 16, 0.12);
        overflow: hidden;
      }
      .hero {
        padding: 36px 40px 26px;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.74), rgba(255,255,255,0.28)),
          linear-gradient(135deg, ${accent}22, transparent 64%);
        border-bottom: 1px solid var(--line);
      }
      .badge {
        display: inline-flex;
        border-radius: 999px;
        padding: 7px 12px;
        background: rgba(255,255,255,0.7);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(28px, 5vw, 44px);
        line-height: 1.05;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.75;
        font-size: 15px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        padding: 26px 40px 36px;
      }
      .card {
        border-radius: 22px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.72);
        padding: 18px;
      }
      .card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 15px;
      }
      .card span {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <section class="hero">
        <span class="badge">KeepPage Mock Archive</span>
        <h1>${title}</h1>
        <p>${summary}</p>
      </section>
      <section class="grid">
        <article class="card">
          <strong>Captured Source</strong>
          <span>${sourceUrl}</span>
        </article>
        <article class="card">
          <strong>Workspace Note</strong>
          <span>这个归档预览由本地 Mock 数据动态生成，用来承载当前前端界面的真实 iframe 区域。</span>
        </article>
        <article class="card">
          <strong>Editing Flow</strong>
          <span>你可以直接在当前主界面里改样式、卡片布局、信息密度和交互文案，然后马上看整体效果。</span>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

function cloneWorkspace(workspace: DemoWorkspace): DemoWorkspace {
  return {
    ...workspace,
    user: { ...workspace.user },
    folders: workspace.folders.map((folder) => ({ ...folder })),
    tags: workspace.tags.map((tag) => ({ ...tag })),
    bookmarks: workspace.bookmarks.map((bookmark) => ({
      ...bookmark,
      tags: bookmark.tags.map((tag) => ({ ...tag })),
      folder: bookmark.folder ? { ...bookmark.folder } : undefined,
      latestQuality: bookmark.latestQuality
        ? {
            ...bookmark.latestQuality,
            reasons: bookmark.latestQuality.reasons.map((reason) => ({ ...reason })),
            liveSignals: { ...bookmark.latestQuality.liveSignals },
            archiveSignals: { ...bookmark.latestQuality.archiveSignals },
          }
        : undefined,
    })),
    versionsByBookmarkId: Object.fromEntries(
      Object.entries(workspace.versionsByBookmarkId).map(([bookmarkId, versions]) => [
        bookmarkId,
        versions.map((version) => ({
          ...version,
          quality: {
            ...version.quality,
            reasons: version.quality.reasons.map((reason) => ({ ...reason })),
            liveSignals: { ...version.quality.liveSignals },
            archiveSignals: { ...version.quality.archiveSignals },
          },
        })),
      ]),
    ),
    archiveHtmlByVersionId: { ...workspace.archiveHtmlByVersionId },
    importTasks: workspace.importTasks.map((task) => ({
      source: task.source,
      task: { ...task.task },
      items: task.items.map((item) => ({ ...item })),
    })),
  };
}

function sortFolders(folders: Folder[]) {
  return [...folders].sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
}

function normalizeFolders(folders: Folder[]) {
  const childrenByParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const rows = childrenByParent.get(key) ?? [];
    rows.push({ ...folder });
    childrenByParent.set(key, rows);
  }

  const normalized: Folder[] = [];
  function visit(folder: Folder, parentPath?: string) {
    const path = parentPath ? `${parentPath}/${folder.name}` : folder.name;
    const nextFolder = {
      ...folder,
      path,
    };
    normalized.push(nextFolder);
    const children = [...(childrenByParent.get(folder.id) ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    );
    for (const child of children) {
      visit(child, path);
    }
  }

  const roots = [...(childrenByParent.get(null) ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  );
  for (const root of roots) {
    visit(root);
  }
  return normalized;
}

function refreshBookmarkReferences(bookmarks: Bookmark[], folders: Folder[], tags: Tag[]) {
  const folderById = new Map(folders.map((folder) => [folder.id, folder] as const));
  const tagById = new Map(tags.map((tag) => [tag.id, tag] as const));
  return bookmarks.map((bookmark) => ({
    ...bookmark,
    folder: bookmark.folder?.id ? folderById.get(bookmark.folder.id) : undefined,
    tags: bookmark.tags
      .map((tag) => tagById.get(tag.id))
      .filter((tag): tag is Tag => Boolean(tag))
      .map((tag) => ({ ...tag })),
  }));
}

function nextId(workspace: DemoWorkspace, prefix: string) {
  const id = `${prefix}_${workspace.nextId.toString().padStart(4, "0")}`;
  return {
    id,
    nextCounter: workspace.nextId + 1,
  };
}

function findFolderByPath(folders: Folder[], path: string) {
  return folders.find((folder) => folder.path === path);
}

function parseImportEntries(rawInput: string): ParsedImportItem[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  const entries: ParsedImportItem[] = [];
  for (const line of lines) {
    const matches = line.match(urlRegex);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        const parsed = parseUrl(match);
        entries.push({
          raw: line,
          title: parsed ? parsed.hostname.replace(/^www\./, "") : match,
          url: match,
          domain: parsed?.hostname,
        });
      }
      continue;
    }

    entries.push({
      raw: line,
      title: line.slice(0, 48),
      reason: "未识别出合法 URL",
    });
  }
  return entries;
}

function parseBookmarkHtmlEntries(rawInput: string): ParsedImportItem[] {
  const entries: ParsedImportItem[] = [];
  const folderStack: string[] = [];
  let pendingFolder: string | null = null;
  const tokenPattern = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<DT><A([^>]*)>([\s\S]*?)<\/A>/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(rawInput)) !== null) {
    if (match[1] !== undefined) {
      pendingFolder = decodeHtml(stripTags(match[1])).trim();
      continue;
    }

    const token = match[0].toLowerCase();
    if (token.startsWith("<dl")) {
      if (pendingFolder) {
        folderStack.push(pendingFolder);
        pendingFolder = null;
      }
      continue;
    }

    if (token.startsWith("</dl")) {
      folderStack.pop();
      pendingFolder = null;
      continue;
    }

    const attrs = match[2] ?? "";
    const url = readHtmlAttribute(attrs, "href");
    const parsed = url ? parseUrl(url) : null;
    entries.push({
      raw: url ?? "",
      title: decodeHtml(stripTags(match[3] ?? "")).trim() || parsed?.hostname || url || "无标题",
      url: url ?? undefined,
      domain: parsed?.hostname,
      folderPath: folderStack.join("/") || undefined,
      sourceTags: splitTags(readHtmlAttribute(attrs, "tags")),
      reason: url ? undefined : "未识别出合法 URL",
    });
  }

  return entries;
}

function parseImportEntriesBySourceType(sourceType: ImportPreviewRequest["sourceType"], rawInput: string) {
  if (sourceType === "browser_html") {
    return parseBookmarkHtmlEntries(rawInput);
  }
  return parseImportEntries(rawInput);
}

function matchesQuery(bookmark: Bookmark, query: BookmarkQuery) {
  if (query.quality !== "all" && bookmark.latestQuality?.grade !== query.quality) {
    return false;
  }
  if (query.folderId && bookmark.folder?.id !== query.folderId) {
    return false;
  }
  if (query.tagId && !bookmark.tags.some((tag) => tag.id === query.tagId)) {
    return false;
  }
  const keyword = query.search.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  const haystack = [
    bookmark.title,
    bookmark.domain,
    bookmark.note,
    bookmark.folder?.path ?? "",
    ...bookmark.tags.map((tag) => tag.name),
  ].join(" ").toLowerCase();
  return haystack.includes(keyword);
}

function createImportPreviewFromEntries(
  entries: ParsedImportItem[],
  workspace: DemoWorkspace,
  request: ImportPreviewRequest,
): ImportPreviewResult {
  const seenUrls = new Set<string>();
  const existingUrls = new Map(
    workspace.bookmarks.map((bookmark) => [
      bookmark.canonicalUrl ?? bookmark.sourceUrl,
      bookmark,
    ] as const),
  );
  const domains = new Map<string, number>();
  let validCount = 0;
  let invalidCount = 0;
  let duplicateInFileCount = 0;
  let duplicateInLibraryCount = 0;
  let willCreateCount = 0;
  let willMergeCount = 0;
  let willSkipCount = 0;
  const folders = new Map<string, number>();

  const samples = entries.slice(0, 12).map((entry, index) => {
    if (!entry.url || !entry.domain) {
      invalidCount += 1;
      return {
        id: `sample_${index}`,
        title: entry.title || "无效条目",
        url: entry.raw,
        domain: "invalid",
        folderPath: entry.folderPath,
        sourceTags: entry.sourceTags,
        status: "invalid" as const,
        reason: entry.reason ?? "缺少有效 URL",
      };
    }

    domains.set(entry.domain, (domains.get(entry.domain) ?? 0) + 1);
    if (entry.folderPath) {
      folders.set(entry.folderPath, (folders.get(entry.folderPath) ?? 0) + 1);
    }

    if (seenUrls.has(entry.url)) {
      duplicateInFileCount += 1;
      return {
        id: `sample_${index}`,
        title: entry.title,
        url: entry.url,
        domain: entry.domain,
        folderPath: entry.folderPath,
        sourceTags: entry.sourceTags,
        status: "duplicate_in_file" as const,
        reason: "与当前导入文件中的其他链接重复",
      };
    }
    seenUrls.add(entry.url);

    const existing = existingUrls.get(entry.url);
    if (existing) {
      duplicateInLibraryCount += 1;
      if (request.dedupeStrategy === "skip") {
        willSkipCount += 1;
      } else {
        willMergeCount += 1;
      }
      return {
        id: `sample_${index}`,
        title: existing.title,
        url: entry.url,
        domain: entry.domain,
        folderPath: entry.folderPath,
        sourceTags: entry.sourceTags,
        status: "duplicate_in_library" as const,
        reason: `已命中现有书签：${existing.title}`,
        existingBookmarkId: existing.id,
        existingHasArchive: existing.versionCount > 0,
      };
    }

    validCount += 1;
    willCreateCount += 1;
    return {
      id: `sample_${index}`,
      title: entry.title,
      url: entry.url,
      domain: entry.domain,
      folderPath: entry.folderPath,
      sourceTags: entry.sourceTags,
      status: "valid" as const,
      reason: request.mode === "links_only" ? "将导入为轻量书签" : "将生成书签并进入归档流程",
    };
  });

  for (const entry of entries.slice(12)) {
    if (!entry.url || !entry.domain) {
      invalidCount += 1;
      continue;
    }
    if (seenUrls.has(entry.url)) {
      duplicateInFileCount += 1;
      continue;
    }
    seenUrls.add(entry.url);
    domains.set(entry.domain, (domains.get(entry.domain) ?? 0) + 1);
    if (entry.folderPath) {
      folders.set(entry.folderPath, (folders.get(entry.folderPath) ?? 0) + 1);
    }
    const existing = existingUrls.get(entry.url);
    if (existing) {
      duplicateInLibraryCount += 1;
      if (request.dedupeStrategy === "skip") {
        willSkipCount += 1;
      } else {
        willMergeCount += 1;
      }
      continue;
    }
    validCount += 1;
    willCreateCount += 1;
  }

  return {
    source: "api",
    sourceType: request.sourceType,
    stats: {
      rawTotal: entries.length,
      validCount,
      invalidCount,
      duplicateInFileCount,
      duplicateInLibraryCount,
      willCreateCount,
      willMergeCount,
      willSkipCount,
    },
    samples,
    folders: [...folders.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 20),
    domains: [...domains.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
  };
}

function ensureFolderPath(workspace: DemoWorkspace, path?: string) {
  if (!path?.trim()) {
    return {
      workspace,
      folder: undefined as Folder | undefined,
    };
  }

  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return {
      workspace,
      folder: undefined as Folder | undefined,
    };
  }

  let currentWorkspace = cloneWorkspace(workspace);
  let parentId: string | null = null;
  let currentPath = "";
  let currentFolder: Folder | undefined;

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = findFolderByPath(currentWorkspace.folders, currentPath);
    if (existing) {
      currentFolder = existing;
      parentId = existing.id;
      continue;
    }

    const idInfo = nextId(currentWorkspace, "folder");
    currentWorkspace.nextId = idInfo.nextCounter;
    currentWorkspace.folders = normalizeFolders([
      ...currentWorkspace.folders,
      {
        id: idInfo.id,
        name: segment,
        path: currentPath,
        parentId,
      },
    ]);
    currentFolder = findFolderByPath(currentWorkspace.folders, currentPath);
    parentId = currentFolder?.id ?? null;
  }

  currentWorkspace.bookmarks = refreshBookmarkReferences(
    currentWorkspace.bookmarks,
    currentWorkspace.folders,
    currentWorkspace.tags,
  );

  return {
    workspace: currentWorkspace,
    folder: currentFolder,
  };
}

export function createDemoWorkspace(): DemoWorkspace {
  const user: AuthUser = {
    id: "user_demo",
    email: "mock@keeppage.local",
    name: "Mock Curator",
    createdAt: DEMO_CREATED_AT,
  };

  const tags: Tag[] = [
    { id: "tag_browser", name: "browser" },
    { id: "tag_extension", name: "extension" },
    { id: "tag_web", name: "web-platform" },
    { id: "tag_research", name: "research" },
    { id: "tag_release", name: "release-note" },
    { id: "tag_design", name: "design-system" },
  ];

  const folders: Folder[] = sortFolders([
    { id: "folder_eng", name: "Engineering", path: "Engineering", parentId: null },
    { id: "folder_eng_ext", name: "Extensions", path: "Engineering/Extensions", parentId: "folder_eng" },
    { id: "folder_reading", name: "Reading Queue", path: "Reading Queue", parentId: null },
    { id: "folder_browser_notes", name: "Browser Notes", path: "Reading Queue/Browser Notes", parentId: "folder_reading" },
    { id: "folder_product", name: "Product", path: "Product", parentId: null },
    { id: "folder_releases", name: "Releases", path: "Product/Releases", parentId: "folder_product" },
    { id: "folder_design", name: "Design", path: "Design", parentId: null },
  ]);

  const qualityHigh = createQuality(92, "high", {
    liveSignals: {
      textLength: 18420,
      imageCount: 18,
      iframeCount: 2,
      scrollHeight: 12340,
      renderHeight: 12310,
      fileSize: 1512000,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: false,
    },
    archiveSignals: {
      textLength: 18110,
      imageCount: 18,
      iframeCount: 2,
      scrollHeight: 12300,
      renderHeight: 12292,
      fileSize: 1498100,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: false,
    },
  });
  const qualityMedium = createQuality(77, "medium", {
    reasons: [
      {
        code: "iframe-loss",
        message: "嵌入内容保留不完整，预览里可能缺少视频或交互组件。",
        impact: 16,
      },
    ],
    liveSignals: {
      textLength: 8120,
      imageCount: 7,
      iframeCount: 1,
      scrollHeight: 6320,
      renderHeight: 6310,
      fileSize: 560000,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: true,
    },
    archiveSignals: {
      textLength: 7010,
      imageCount: 6,
      iframeCount: 0,
      scrollHeight: 6150,
      renderHeight: 6140,
      fileSize: 498300,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: false,
      hasVideo: true,
    },
  });
  const qualityLow = createQuality(61, "low", {
    reasons: [
      {
        code: "text-loss",
        message: "正文保留偏少，归档内容显著短于原页面。",
        impact: 23,
      },
      {
        code: "screenshot-missing",
        message: "最近一次抓取没有可用截图。",
        impact: 6,
      },
    ],
    liveSignals: {
      textLength: 12600,
      imageCount: 11,
      iframeCount: 0,
      scrollHeight: 9210,
      renderHeight: 9190,
      fileSize: 820300,
      previewable: true,
      screenshotGenerated: true,
      hasCanvas: true,
      hasVideo: false,
    },
    archiveSignals: {
      textLength: 7540,
      imageCount: 7,
      iframeCount: 0,
      scrollHeight: 8840,
      renderHeight: 8820,
      fileSize: 302120,
      previewable: true,
      screenshotGenerated: false,
      hasCanvas: true,
      hasVideo: false,
    },
  });

  const bookmarks: Bookmark[] = [
    {
      id: "bm_guide_001",
      sourceUrl: "https://developer.chrome.com/docs/extensions/mv3/intro",
      canonicalUrl: "https://developer.chrome.com/docs/extensions/mv3/intro",
      title: "Chrome Extensions MV3 Overview",
      domain: "developer.chrome.com",
      note: "Capture profile switched to complete for code examples and iframe docs.",
      isFavorite: true,
      tags: tags.filter((tag) => ["tag_browser", "tag_extension"].includes(tag.id)),
      folder: folders.find((folder) => folder.id === "folder_eng_ext"),
      latestVersionId: "ver_guide_003",
      versionCount: 3,
      latestQuality: qualityHigh,
      createdAt: "2026-03-17T10:35:00.000Z",
      updatedAt: "2026-03-18T11:20:00.000Z",
    },
    {
      id: "bm_article_002",
      sourceUrl: "https://webkit.org/blog/13895/auto-fill-updates/",
      title: "AutoFill Updates in Safari",
      domain: "webkit.org",
      note: "Possible iframe drop on embedded media section.",
      isFavorite: false,
      tags: tags.filter((tag) => ["tag_web", "tag_research"].includes(tag.id)),
      folder: folders.find((folder) => folder.id === "folder_browser_notes"),
      latestVersionId: "ver_article_002",
      versionCount: 2,
      latestQuality: qualityMedium,
      createdAt: "2026-03-16T09:11:00.000Z",
      updatedAt: "2026-03-18T02:14:00.000Z",
    },
    {
      id: "bm_release_003",
      sourceUrl: "https://example.com/release-notes/alpha",
      title: "Alpha Release Notes (Internal Mirror)",
      domain: "example.com",
      note: "",
      isFavorite: false,
      tags: tags.filter((tag) => tag.id === "tag_release"),
      folder: folders.find((folder) => folder.id === "folder_releases"),
      latestVersionId: "ver_release_002",
      versionCount: 2,
      latestQuality: qualityLow,
      createdAt: "2026-03-15T14:20:00.000Z",
      updatedAt: "2026-03-18T05:20:00.000Z",
    },
    {
      id: "bm_design_004",
      sourceUrl: "https://m3.material.io/styles/color/system/how-the-system-works",
      title: "Material 3 Color System",
      domain: "m3.material.io",
      note: "参考这一页的层级和密度，后续可以继续在 mock 模式里调整。",
      isFavorite: true,
      tags: tags.filter((tag) => ["tag_design", "tag_research"].includes(tag.id)),
      folder: folders.find((folder) => folder.id === "folder_design"),
      latestVersionId: "ver_design_001",
      versionCount: 1,
      latestQuality: createQuality(88, "high"),
      createdAt: "2026-03-14T08:22:00.000Z",
      updatedAt: "2026-03-18T08:10:00.000Z",
    },
  ];

  const versionsByBookmarkId: Record<string, BookmarkDetailVersion[]> = {
    bm_guide_001: [
      {
        id: "ver_guide_003",
        bookmarkId: "bm_guide_001",
        versionNo: 3,
        htmlObjectKey: "demo/ver_guide_003/archive.html",
        htmlSha256: "demo-guide-003",
        textSha256: "demo-guide-003-text",
        textSimhash: "demo-guide-003-sim",
        captureProfile: "complete",
        quality: qualityHigh,
        createdAt: "2026-03-18T11:20:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 1498100,
      },
      {
        id: "ver_guide_002",
        bookmarkId: "bm_guide_001",
        versionNo: 2,
        htmlObjectKey: "demo/ver_guide_002/archive.html",
        htmlSha256: "demo-guide-002",
        textSha256: "demo-guide-002-text",
        textSimhash: "demo-guide-002-sim",
        captureProfile: "standard",
        quality: createQuality(86, "high"),
        createdAt: "2026-03-17T13:20:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 1312044,
      },
      {
        id: "ver_guide_001",
        bookmarkId: "bm_guide_001",
        versionNo: 1,
        htmlObjectKey: "demo/ver_guide_001/archive.html",
        htmlSha256: "demo-guide-001",
        textSha256: "demo-guide-001-text",
        textSimhash: "demo-guide-001-sim",
        captureProfile: "standard",
        quality: createQuality(79, "medium"),
        createdAt: "2026-03-16T10:12:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 1012044,
      },
    ],
    bm_article_002: [
      {
        id: "ver_article_002",
        bookmarkId: "bm_article_002",
        versionNo: 2,
        htmlObjectKey: "demo/ver_article_002/archive.html",
        htmlSha256: "demo-article-002",
        textSha256: "demo-article-002-text",
        textSimhash: "demo-article-002-sim",
        captureProfile: "complete",
        quality: qualityMedium,
        createdAt: "2026-03-18T02:14:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 498300,
      },
      {
        id: "ver_article_001",
        bookmarkId: "bm_article_002",
        versionNo: 1,
        htmlObjectKey: "demo/ver_article_001/archive.html",
        htmlSha256: "demo-article-001",
        textSha256: "demo-article-001-text",
        textSimhash: "demo-article-001-sim",
        captureProfile: "standard",
        quality: createQuality(83, "high"),
        createdAt: "2026-03-17T07:14:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 532110,
      },
    ],
    bm_release_003: [
      {
        id: "ver_release_002",
        bookmarkId: "bm_release_003",
        versionNo: 2,
        htmlObjectKey: "demo/ver_release_002/archive.html",
        htmlSha256: "demo-release-002",
        textSha256: "demo-release-002-text",
        textSimhash: "demo-release-002-sim",
        captureProfile: "lightweight",
        quality: qualityLow,
        createdAt: "2026-03-18T05:20:00.000Z",
        archiveAvailable: false,
        readerArchiveAvailable: false,
        archiveSizeBytes: 0,
      },
      {
        id: "ver_release_001",
        bookmarkId: "bm_release_003",
        versionNo: 1,
        htmlObjectKey: "demo/ver_release_001/archive.html",
        htmlSha256: "demo-release-001",
        textSha256: "demo-release-001-text",
        textSimhash: "demo-release-001-sim",
        captureProfile: "standard",
        quality: createQuality(72, "medium"),
        createdAt: "2026-03-16T05:20:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 412204,
      },
    ],
    bm_design_004: [
      {
        id: "ver_design_001",
        bookmarkId: "bm_design_004",
        versionNo: 1,
        htmlObjectKey: "demo/ver_design_001/archive.html",
        htmlSha256: "demo-design-001",
        textSha256: "demo-design-001-text",
        textSimhash: "demo-design-001-sim",
        captureProfile: "complete",
        quality: createQuality(88, "high"),
        createdAt: "2026-03-18T08:10:00.000Z",
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 688440,
      },
    ],
  };

  const archiveHtmlByVersionId: Record<string, string> = {
    ver_guide_003: buildArchiveHtml(
      "Chrome Extensions MV3 Overview",
      "https://developer.chrome.com/docs/extensions/mv3/intro",
      "面向扩展体系的演进说明，展示 service worker、权限模型和消息桥接策略。",
      "#0956a4",
    ),
    ver_guide_002: buildArchiveHtml(
      "Chrome Extensions MV3 Overview · v2",
      "https://developer.chrome.com/docs/extensions/mv3/intro",
      "第二版 mock 归档，保留了核心代码块和策略说明。",
      "#1e6f56",
    ),
    ver_guide_001: buildArchiveHtml(
      "Chrome Extensions MV3 Overview · v1",
      "https://developer.chrome.com/docs/extensions/mv3/intro",
      "首个归档版本，内容结构完整但视觉层次稍弱。",
      "#8a5d16",
    ),
    ver_article_002: buildArchiveHtml(
      "AutoFill Updates in Safari",
      "https://webkit.org/blog/13895/auto-fill-updates/",
      "聚焦 Safari 中自动填充策略和凭据体验升级的一篇说明。",
      "#245b94",
    ),
    ver_article_001: buildArchiveHtml(
      "AutoFill Updates in Safari · v1",
      "https://webkit.org/blog/13895/auto-fill-updates/",
      "旧版本保留了主体内容，但媒体嵌入还不够稳定。",
      "#6a7b22",
    ),
    ver_release_001: buildArchiveHtml(
      "Alpha Release Notes",
      "https://example.com/release-notes/alpha",
      "用来展示低质量归档在详情页中的版本切换和质量诊断区。",
      "#8d3d2f",
    ),
    ver_design_001: buildArchiveHtml(
      "Material 3 Color System",
      "https://m3.material.io/styles/color/system/how-the-system-works",
      "用于演示设计参考页在当前工作台中的详情、标签和预览联动。",
      "#6f5aa6",
    ),
  };

  const importTasks: ImportTaskDetailResult[] = [
    {
      source: "api",
      task: {
        id: "task_20260318_01",
        name: "Chrome 旧书签迁移",
        status: "completed",
        sourceType: "browser_html",
        mode: "queue_archive",
        totalCount: 18,
        successCount: 12,
        mergedCount: 3,
        skippedCount: 1,
        failedCount: 2,
        archiveSuccessCount: 9,
        archiveFailedCount: 1,
        createdAt: "2026-03-18T09:10:00.000Z",
        updatedAt: "2026-03-18T09:35:00.000Z",
      },
      items: [
        {
          id: "task_20260318_01_item_01",
          title: "Chrome Extensions MV3 Overview",
          url: "https://developer.chrome.com/docs/extensions/mv3/intro",
          domain: "developer.chrome.com",
          sourceFolderPath: "Engineering/Extensions",
          status: "deduplicated",
          dedupeResult: "merged",
          bookmarkId: "bm_guide_001",
          hasArchive: true,
        },
        {
          id: "task_20260318_01_item_02",
          title: "Material 3 Color System",
          url: "https://m3.material.io/styles/color/system/how-the-system-works",
          domain: "m3.material.io",
          sourceFolderPath: "Design",
          status: "archived",
          dedupeResult: "created",
          bookmarkId: "bm_design_004",
          hasArchive: true,
        },
        {
          id: "task_20260318_01_item_03",
          title: "Broken mock URL",
          url: "https://invalid.example/404",
          domain: "invalid.example",
          status: "failed",
          errorReason: "抓取目标返回 404，归档未建立。",
        },
      ],
    },
    {
      source: "api",
      task: {
        id: "task_20260317_02",
        name: "研究链接清单导入",
        status: "partial_failed",
        sourceType: "url_list",
        mode: "links_only",
        totalCount: 9,
        successCount: 5,
        mergedCount: 2,
        skippedCount: 1,
        failedCount: 1,
        archiveSuccessCount: 0,
        archiveFailedCount: 0,
        createdAt: "2026-03-17T19:00:00.000Z",
        updatedAt: "2026-03-17T19:18:00.000Z",
      },
      items: [
        {
          id: "task_20260317_02_item_01",
          title: "AutoFill Updates in Safari",
          url: "https://webkit.org/blog/13895/auto-fill-updates/",
          domain: "webkit.org",
          status: "deduplicated",
          dedupeResult: "merged",
          bookmarkId: "bm_article_002",
          hasArchive: true,
        },
        {
          id: "task_20260317_02_item_02",
          title: "Alpha Release Notes (Internal Mirror)",
          url: "https://example.com/release-notes/alpha",
          domain: "example.com",
          status: "created_bookmark",
          dedupeResult: "created",
          bookmarkId: "bm_release_003",
          hasArchive: true,
        },
      ],
    },
  ];

  return {
    user,
    folders,
    tags,
    bookmarks,
    versionsByBookmarkId,
    archiveHtmlByVersionId,
    importTasks,
    nextId: 100,
  };
}

export function filterDemoBookmarks(workspace: DemoWorkspace, query: BookmarkQuery) {
  return workspace.bookmarks.filter((bookmark) => matchesQuery(bookmark, query));
}

export function getDemoBookmarkDetail(workspace: DemoWorkspace, bookmarkId: string): BookmarkDetailResult | null {
  const bookmark = workspace.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    return null;
  }
  return {
    source: "api",
    bookmark,
    versions: workspace.versionsByBookmarkId[bookmarkId] ?? [],
  };
}

export function getDemoArchiveHtml(workspace: DemoWorkspace, versionId: string) {
  return workspace.archiveHtmlByVersionId[versionId] ?? null;
}

export function createDemoFolder(workspace: DemoWorkspace, input: { name: string; parentId: string | null }) {
  const current = cloneWorkspace(workspace);
  const parent = input.parentId ? current.folders.find((folder) => folder.id === input.parentId) : undefined;
  const idInfo = nextId(current, "folder");
  current.nextId = idInfo.nextCounter;
  current.folders = normalizeFolders([
    ...current.folders,
    {
      id: idInfo.id,
      name: input.name,
      path: parent ? `${parent.path}/${input.name}` : input.name,
      parentId: input.parentId,
    },
  ]);
  current.bookmarks = refreshBookmarkReferences(current.bookmarks, current.folders, current.tags);
  const folder = current.folders.find((item) => item.id === idInfo.id);
  return {
    workspace: current,
    folder: folder!,
  };
}

export function updateDemoFolder(
  workspace: DemoWorkspace,
  folderId: string,
  input: { name?: string; parentId?: string | null },
) {
  const current = cloneWorkspace(workspace);
  const target = current.folders.find((folder) => folder.id === folderId);
  if (!target) {
    throw new Error("未找到要编辑的收藏夹。");
  }

  if (input.parentId === folderId) {
    throw new Error("收藏夹不能移动到自己下面。");
  }

  const descendantIds = new Set<string>();
  const childrenByParent = new Map<string | null, Folder[]>();
  for (const folder of current.folders) {
    const key = folder.parentId ?? null;
    const rows = childrenByParent.get(key) ?? [];
    rows.push(folder);
    childrenByParent.set(key, rows);
  }
  function collect(id: string) {
    descendantIds.add(id);
    for (const child of childrenByParent.get(id) ?? []) {
      collect(child.id);
    }
  }
  collect(folderId);
  if (input.parentId && descendantIds.has(input.parentId)) {
    throw new Error("不能把收藏夹移动到自己的子层级中。");
  }

  current.folders = normalizeFolders(
    current.folders.map((folder) => {
      if (folder.id !== folderId) {
        return folder;
      }
      return {
        ...folder,
        name: input.name ?? folder.name,
        parentId: input.parentId !== undefined ? input.parentId : folder.parentId,
      };
    }),
  );
  current.bookmarks = refreshBookmarkReferences(current.bookmarks, current.folders, current.tags);

  const updated = current.folders.find((folder) => folder.id === folderId);
  return {
    workspace: current,
    folder: updated!,
  };
}

export function deleteDemoFolder(workspace: DemoWorkspace, folderId: string) {
  const current = cloneWorkspace(workspace);
  const target = current.folders.find((folder) => folder.id === folderId);
  if (!target) {
    throw new Error("未找到要删除的收藏夹。");
  }

  current.folders = normalizeFolders(
    current.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => (
        folder.parentId === folderId
          ? { ...folder, parentId: target.parentId ?? null }
          : folder
      )),
  );
  current.bookmarks = refreshBookmarkReferences(
    current.bookmarks.map((bookmark) => (
      bookmark.folder?.id === folderId
        ? { ...bookmark, folder: undefined }
        : bookmark
    )),
    current.folders,
    current.tags,
  );
  return current;
}

export function createDemoTag(workspace: DemoWorkspace, input: { name: string; color?: string }) {
  const current = cloneWorkspace(workspace);
  const idInfo = nextId(current, "tag");
  current.nextId = idInfo.nextCounter;
  const tag: Tag = {
    id: idInfo.id,
    name: input.name,
    color: input.color,
  };
  current.tags = [...current.tags, tag];
  return {
    workspace: current,
    tag,
  };
}

export function updateDemoTag(
  workspace: DemoWorkspace,
  tagId: string,
  input: { name?: string; color?: string | null },
) {
  const current = cloneWorkspace(workspace);
  current.tags = current.tags.map((tag) => (
    tag.id === tagId
      ? {
          ...tag,
          name: input.name ?? tag.name,
          color: input.color === null ? undefined : input.color ?? tag.color,
        }
      : tag
  ));
  current.bookmarks = refreshBookmarkReferences(current.bookmarks, current.folders, current.tags);
  const updated = current.tags.find((tag) => tag.id === tagId);
  return {
    workspace: current,
    tag: updated!,
  };
}

export function deleteDemoTag(workspace: DemoWorkspace, tagId: string) {
  const current = cloneWorkspace(workspace);
  current.tags = current.tags.filter((tag) => tag.id !== tagId);
  current.bookmarks = refreshBookmarkReferences(
    current.bookmarks.map((bookmark) => ({
      ...bookmark,
      tags: bookmark.tags.filter((tag) => tag.id !== tagId),
    })),
    current.folders,
    current.tags,
  );
  return current;
}

export function updateDemoBookmarkMetadata(
  workspace: DemoWorkspace,
  bookmarkId: string,
  input: {
    note?: string;
    folderId?: string | null;
    tagIds?: string[];
  },
) {
  const current = cloneWorkspace(workspace);
  const folder = input.folderId
    ? current.folders.find((item) => item.id === input.folderId)
    : undefined;
  const nextTags = input.tagIds
    ? current.tags.filter((tag) => input.tagIds?.includes(tag.id))
    : undefined;

  current.bookmarks = current.bookmarks.map((bookmark) => (
    bookmark.id === bookmarkId
      ? {
          ...bookmark,
          note: input.note ?? bookmark.note,
          folder: input.folderId !== undefined ? folder : bookmark.folder,
          tags: nextTags ?? bookmark.tags,
          updatedAt: new Date().toISOString(),
        }
      : bookmark
  ));
  const updated = current.bookmarks.find((bookmark) => bookmark.id === bookmarkId);
  if (!updated) {
    throw new Error("未找到要更新的书签。");
  }
  return {
    workspace: current,
    bookmark: updated,
  };
}

export function previewDemoImport(workspace: DemoWorkspace, request: ImportPreviewRequest) {
  const entries = parseImportEntriesBySourceType(request.sourceType, request.rawInput);
  return createImportPreviewFromEntries(entries, workspace, request);
}

function createGeneratedBookmark(
  workspace: DemoWorkspace,
  entry: ParsedImportItem,
  request: ImportPreviewRequest,
  folder?: Folder,
) {
  const idInfo = nextId(workspace, "bm");
  workspace.nextId = idInfo.nextCounter;

  const bookmarkId = idInfo.id;
  const versionInfo = nextId(workspace, "ver");
  workspace.nextId = versionInfo.nextCounter;

  const hasArchive = request.mode !== "links_only";
  const quality = hasArchive ? createQuality(81, "high") : undefined;
  const bookmark: Bookmark = {
    id: bookmarkId,
    sourceUrl: entry.url!,
    canonicalUrl: entry.url!,
    title: entry.title || entry.domain || entry.url!,
    domain: entry.domain!,
    note: request.mode === "links_only" ? "由 Mock 导入工作台生成的轻量书签。" : "由 Mock 导入工作台生成，并附带预览归档。",
    isFavorite: false,
    tags: [],
    folder,
    latestVersionId: hasArchive ? versionInfo.id : undefined,
    versionCount: hasArchive ? 1 : 0,
    latestQuality: quality,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workspace.bookmarks = [bookmark, ...workspace.bookmarks];

  if (hasArchive) {
    workspace.versionsByBookmarkId[bookmarkId] = [
      {
        id: versionInfo.id,
        bookmarkId,
        versionNo: 1,
        htmlObjectKey: `demo/${versionInfo.id}/archive.html`,
        htmlSha256: `${versionInfo.id}-sha`,
        textSha256: `${versionInfo.id}-text`,
        textSimhash: `${versionInfo.id}-sim`,
        captureProfile: request.mode === "archive_now" ? "complete" : "standard",
        quality: quality!,
        createdAt: new Date().toISOString(),
        archiveAvailable: true,
        readerArchiveAvailable: false,
        archiveSizeBytes: 420000,
      },
    ];
    workspace.archiveHtmlByVersionId[versionInfo.id] = buildArchiveHtml(
      bookmark.title,
      bookmark.sourceUrl,
      "这个归档来自 Mock 导入工作台，方便你直接查看导入后在详情页和 iframe 区域里的表现。",
      "#0956a4",
    );
  } else {
    workspace.versionsByBookmarkId[bookmarkId] = [];
  }

  return bookmark;
}

export function createDemoImportTask(
  workspace: DemoWorkspace,
  request: ImportPreviewRequest & { name: string },
) {
  let current = cloneWorkspace(workspace);
  const entries = parseImportEntriesBySourceType(request.sourceType, request.rawInput);
  const preview = createImportPreviewFromEntries(entries, current, request);
  const taskInfo = nextId(current, "task");
  current.nextId = taskInfo.nextCounter;

  const folderResult = request.targetFolderMode === "specific_folder"
    ? ensureFolderPath(current, request.targetFolderPath)
    : { workspace: current, folder: undefined as Folder | undefined };
  current = folderResult.workspace;

  const items: ImportTaskItem[] = [];
  const existingByUrl = new Map(
    current.bookmarks.map((bookmark) => [
      bookmark.canonicalUrl ?? bookmark.sourceUrl,
      bookmark,
    ] as const),
  );

  let successCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let archiveSuccessCount = 0;
  let archiveFailedCount = 0;

  const seenUrls = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const itemId = `${taskInfo.id}_item_${String(index + 1).padStart(2, "0")}`;
    if (!entry.url || !entry.domain) {
      failedCount += 1;
      items.push({
        id: itemId,
        title: entry.title || "无效条目",
        url: entry.raw,
        domain: "invalid",
        status: "failed",
        errorReason: entry.reason ?? "未识别出合法 URL",
      });
      continue;
    }

    if (seenUrls.has(entry.url)) {
      skippedCount += 1;
      items.push({
        id: itemId,
        title: entry.title,
        url: entry.url,
        domain: entry.domain,
        status: "skipped",
        dedupeResult: "duplicate_in_file",
        errorReason: "和同一批导入中的其他链接重复",
      });
      continue;
    }
    seenUrls.add(entry.url);

    const existing = existingByUrl.get(entry.url);
    if (existing) {
      if (request.dedupeStrategy === "skip") {
        skippedCount += 1;
        items.push({
          id: itemId,
          title: existing.title,
          url: entry.url,
          domain: entry.domain,
          status: "skipped",
          dedupeResult: "skipped",
          bookmarkId: existing.id,
          hasArchive: existing.versionCount > 0,
        });
      } else {
        mergedCount += 1;
        items.push({
          id: itemId,
          title: existing.title,
          url: entry.url,
          domain: entry.domain,
          status: "deduplicated",
          dedupeResult: "merged",
          bookmarkId: existing.id,
          hasArchive: existing.versionCount > 0,
        });
      }
      continue;
    }

    const bookmark = createGeneratedBookmark(current, entry, request, folderResult.folder);
    existingByUrl.set(bookmark.sourceUrl, bookmark);
    successCount += 1;
    if (request.mode !== "links_only") {
      archiveSuccessCount += 1;
    }
    items.push({
      id: itemId,
      title: bookmark.title,
      url: bookmark.sourceUrl,
      domain: bookmark.domain,
      sourceFolderPath: folderResult.folder?.path,
      status: request.mode === "links_only" ? "created_bookmark" : "archived",
      dedupeResult: "created",
      bookmarkId: bookmark.id,
      hasArchive: request.mode !== "links_only",
    });
  }

  const detail: ImportTaskDetailResult = {
    source: "api",
    task: {
      id: taskInfo.id,
      name: request.name,
      status: failedCount > 0 ? "partial_failed" : "completed",
      sourceType: request.sourceType,
      mode: request.mode,
      totalCount: entries.length,
      successCount,
      mergedCount,
      skippedCount,
      failedCount,
      archiveSuccessCount,
      archiveFailedCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    items,
  };

  current.importTasks = [detail, ...current.importTasks];
  current.bookmarks = refreshBookmarkReferences(current.bookmarks, current.folders, current.tags);

  return {
    workspace: current,
    taskId: detail.task.id,
    preview,
  };
}

export function listDemoImportTasks(workspace: DemoWorkspace): ImportTaskSummary[] {
  return [...workspace.importTasks]
    .map((task) => task.task)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getDemoImportTaskDetail(workspace: DemoWorkspace, taskId: string): ImportTaskDetailResult | null {
  return workspace.importTasks.find((task) => task.task.id === taskId) ?? null;
}
