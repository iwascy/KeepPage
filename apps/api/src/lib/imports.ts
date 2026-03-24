import {
  importExecutionOptionsSchema,
  importPreviewResponseSchema,
  type ImportExecutionOptions,
  type ImportPreviewResponse,
  type ImportSource,
} from "@keeppage/domain";
import { hashNormalizedUrl, normalizeSourceUrl } from "./url";
import type {
  ImportBookmarkMatch,
  PreparedImportItem,
} from "../repositories/bookmark-repository";

const URL_PROTOCOL_ALLOWLIST = new Set(["http:", "https:"]);

export function resolveImportOptions(input?: Partial<ImportExecutionOptions>): ImportExecutionOptions {
  return importExecutionOptionsSchema.parse(input ?? {});
}

export function createImportTaskName(sourceType: ImportSource, fileName?: string) {
  if (fileName?.trim()) {
    return `导入 ${fileName.trim()}`;
  }

  switch (sourceType) {
    case "bookmark_html":
      return "导入书签 HTML";
    case "csv_file":
      return "导入 CSV 链接";
    case "text_file":
      return "导入 TXT 链接";
    case "markdown_file":
      return "导入 Markdown 链接";
    case "url_list":
      return "导入 URL 列表";
    case "browser_bookmarks":
      return "导入浏览器书签";
  }
}

export function parseImportContent(sourceType: ImportSource, content: string): PreparedImportItem[] {
  switch (sourceType) {
    case "bookmark_html":
      return parseBookmarkHtml(content);
    case "csv_file":
      return parseCsvContent(content);
    case "text_file":
    case "markdown_file":
    case "url_list":
      return parseTextLikeContent(content);
    case "browser_bookmarks":
      throw new Error("当前版本暂不支持直接读取浏览器书签树，请先导出书签 HTML 文件。");
  }
}

export function buildImportPreview(input: {
  sourceType: ImportSource;
  fileName?: string;
  options: ImportExecutionOptions;
  items: PreparedImportItem[];
  existingMatches: ImportBookmarkMatch[];
}): ImportPreviewResponse {
  const matchMap = new Map(
    input.existingMatches.map((match) => [match.normalizedUrlHash, match]),
  );

  let validCount = 0;
  let invalidCount = 0;
  let duplicateInFileCount = 0;
  let duplicateExistingCount = 0;
  let estimatedCreateCount = 0;
  let estimatedMergeCount = 0;
  let estimatedSkipCount = 0;

  const folderCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();

  for (const item of input.items) {
    if (!item.valid) {
      invalidCount += 1;
      estimatedSkipCount += 1;
      continue;
    }

    validCount += 1;

    if (item.folderPath) {
      folderCounts.set(item.folderPath, (folderCounts.get(item.folderPath) ?? 0) + 1);
    }

    if (item.domain) {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    }

    if (item.duplicateInFile) {
      duplicateInFileCount += 1;
      estimatedSkipCount += 1;
      continue;
    }

    const match = item.normalizedUrlHash ? matchMap.get(item.normalizedUrlHash) : undefined;
    if (match) {
      duplicateExistingCount += 1;
      if (input.options.dedupeStrategy === "skip") {
        estimatedSkipCount += 1;
      } else {
        estimatedMergeCount += 1;
      }
      continue;
    }

    estimatedCreateCount += 1;
  }

  const samples = input.items.slice(0, 12).map((item) => {
    const match = item.normalizedUrlHash ? matchMap.get(item.normalizedUrlHash) : undefined;
    return {
      index: item.index,
      title: item.title,
      url: item.url,
      domain: item.domain,
      folderPath: item.folderPath,
      sourceTags: item.sourceTags,
      valid: item.valid,
      duplicateInFile: item.duplicateInFile,
      existingBookmarkId: match?.bookmarkId,
      existingHasArchive: match?.hasArchive ?? false,
      reason: item.reason,
    };
  });

  return importPreviewResponseSchema.parse({
    sourceType: input.sourceType,
    fileName: input.fileName,
    summary: {
      totalCount: input.items.length,
      validCount,
      invalidCount,
      duplicateInFileCount,
      duplicateExistingCount,
      estimatedCreateCount,
      estimatedMergeCount,
      estimatedSkipCount,
    },
    folders: toDistribution(folderCounts),
    domains: toDistribution(domainCounts),
    samples,
  });
}

function parseTextLikeContent(content: string) {
  const items: PreparedImportItem[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parsedMarkdown = parseMarkdownLink(line);
    const extractedUrl = parsedMarkdown?.url ?? extractFirstUrl(line) ?? line;
    const title = parsedMarkdown?.title ?? deriveInlineTitle(line, extractedUrl);
    const item = createPreparedItem({
      index,
      title,
      rawUrl: extractedUrl,
      sourceTags: [],
    });
    markDuplicate(item, seen);
    items.push(item);
    index += 1;
  }

  return items;
}

function parseCsvContent(content: string) {
  const rows = parseCsvRows(content).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = firstRow.some((cell) => ["url", "link", "href", "title", "name", "folder", "path", "tags"].includes(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const urlIndex = hasHeader
    ? firstRow.findIndex((cell) => ["url", "link", "href"].includes(cell))
    : 0;
  const titleIndex = hasHeader
    ? firstRow.findIndex((cell) => ["title", "name"].includes(cell))
    : 1;
  const folderIndex = hasHeader
    ? firstRow.findIndex((cell) => ["folder", "path"].includes(cell))
    : 2;
  const tagsIndex = hasHeader
    ? firstRow.findIndex((cell) => ["tags", "labels"].includes(cell))
    : 3;

  const items: PreparedImportItem[] = [];
  const seen = new Set<string>();

  dataRows.forEach((row, index) => {
    const rawUrl = safeGet(row, urlIndex) ?? row[0] ?? "";
    const rawTitle = safeGet(row, titleIndex);
    const folderPath = safeGet(row, folderIndex);
    const sourceTags = splitTags(safeGet(row, tagsIndex));
    const item = createPreparedItem({
      index,
      title: rawTitle?.trim() || rawUrl.trim() || `链接 ${index + 1}`,
      rawUrl,
      folderPath: folderPath?.trim() || undefined,
      sourceTags,
    });
    markDuplicate(item, seen);
    items.push(item);
  });

  return items;
}

function parseBookmarkHtml(content: string) {
  const items: PreparedImportItem[] = [];
  const seen = new Set<string>();
  const folderStack: string[] = [];
  let pendingFolder: string | null = null;
  let index = 0;

  const tokenPattern = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<DT><A([^>]*)>([\s\S]*?)<\/A>/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(content)) !== null) {
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
    const rawUrl = readHtmlAttribute(attrs, "href") ?? "";
    const rawTitle = decodeHtml(stripTags(match[3] ?? "")).trim() || rawUrl;
    const folderPath = folderStack.join("/") || undefined;
    const sourceTags = splitTags(readHtmlAttribute(attrs, "tags"));
    const item = createPreparedItem({
      index,
      title: rawTitle,
      rawUrl,
      folderPath,
      sourceTags,
    });
    markDuplicate(item, seen);
    items.push(item);
    index += 1;
  }

  return items;
}

function createPreparedItem(input: {
  index: number;
  title: string;
  rawUrl: string;
  folderPath?: string;
  sourceTags: string[];
}): PreparedImportItem {
  const coercedUrl = coerceUrlCandidate(input.rawUrl);
  if (!coercedUrl) {
    return {
      index: input.index,
      title: input.title.trim() || `条目 ${input.index + 1}`,
      url: undefined,
      normalizedUrl: undefined,
      normalizedUrlHash: undefined,
      domain: undefined,
      folderPath: input.folderPath,
      sourceTags: input.sourceTags,
      valid: false,
      duplicateInFile: false,
      reason: "无法识别为可导入的 HTTP/HTTPS 链接。",
    };
  }

  try {
    const normalizedUrl = normalizeSourceUrl(coercedUrl);
    const url = new URL(normalizedUrl);
    if (!URL_PROTOCOL_ALLOWLIST.has(url.protocol)) {
      throw new Error("unsupported");
    }

    return {
      index: input.index,
      title: input.title.trim() || deriveTitleFromUrl(normalizedUrl),
      url: normalizedUrl,
      normalizedUrl,
      normalizedUrlHash: hashNormalizedUrl(normalizedUrl),
      domain: url.hostname,
      folderPath: input.folderPath,
      sourceTags: input.sourceTags,
      valid: true,
      duplicateInFile: false,
    };
  } catch {
    return {
      index: input.index,
      title: input.title.trim() || `条目 ${input.index + 1}`,
      url: undefined,
      normalizedUrl: undefined,
      normalizedUrlHash: undefined,
      domain: undefined,
      folderPath: input.folderPath,
      sourceTags: input.sourceTags,
      valid: false,
      duplicateInFile: false,
      reason: "链接协议不受支持或格式无效。",
    };
  }
}

function markDuplicate(item: PreparedImportItem, seen: Set<string>) {
  if (!item.valid || !item.normalizedUrlHash) {
    return;
  }

  if (seen.has(item.normalizedUrlHash)) {
    item.duplicateInFile = true;
    item.reason = "与本次导入中的更早条目重复。";
    return;
  }

  seen.add(item.normalizedUrlHash);
}

function parseMarkdownLink(line: string) {
  const match = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i);
  if (!match) {
    return null;
  }
  return {
    title: match[1]?.trim() || undefined,
    url: match[2]?.trim() || undefined,
  };
}

function deriveInlineTitle(line: string, extractedUrl: string) {
  const cleaned = line.replace(extractedUrl, "").replace(/^[-*+\d.\s]+/, "").trim();
  if (!cleaned) {
    return deriveTitleFromUrl(extractedUrl);
  }
  return cleaned.slice(0, 160);
}

function extractFirstUrl(line: string) {
  const match = line.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0];
}

function coerceUrlCandidate(rawValue: string) {
  const trimmed = rawValue
    .trim()
    .replace(/^["'<(\[]+/, "")
    .replace(/[>"')\].,;]+$/, "");

  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith("javascript:") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("chrome://") ||
    lowered.startsWith("about:") ||
    lowered.startsWith("file:")
  ) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^www\./i.test(trimmed) || /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

function deriveTitleFromUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./i, "") + (url.pathname !== "/" ? url.pathname : "");
  } catch {
    return rawUrl;
  }
}

function toDistribution(source: Map<string, number>) {
  return [...source.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([value, count]) => ({ value, count }));
}

function splitTags(input?: string | null) {
  if (!input) {
    return [];
  }
  return input
    .split(/[;,]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function safeGet(row: string[], index: number) {
  if (index < 0 || index >= row.length) {
    return undefined;
  }
  return row[index];
}

function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function readHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  if (match?.[1]) {
    return decodeHtml(match[1]);
  }
  return undefined;
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
    .replace(/&#39;/g, "'");
}
