import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  ApiToken,
  AuthUser,
  Bookmark,
  BookmarkListView,
  CloudArchiveRequest,
  CloudArchiveStatus,
  Folder,
  QualityGrade,
  QualityReport,
  Tag,
} from "@keeppage/domain";
import {
  ApiError,
  createApiToken,
  type BookmarkDetailResult,
  type BookmarkViewerVersion,
  createFolder,
  createTag,
  createArchiveObjectUrl,
  fetchApiTokens,
  fetchCloudArchiveTask,
  deleteBookmark,
  deleteFolder,
  deleteTag,
  fetchBookmarkDetail,
  fetchBookmarks,
  fetchCurrentUser,
  fetchFolders,
  fetchTags,
  loginAccount,
  revokeApiToken,
  registerAccount,
  submitCloudArchive,
  updateBookmarkMetadata,
  updateFolder,
  updateTag,
} from "./api";
import {
  ImportDetailPanel,
  ImportHistoryPanel,
  ImportNewPanel,
  type ImportPanelAdapter,
} from "./imports";
import {
  createDemoFolder,
  createDemoImportTask,
  createDemoTag,
  createDemoWorkspace,
  deleteDemoBookmark,
  deleteDemoFolder,
  deleteDemoTag,
  filterDemoBookmarks,
  getDemoArchiveHtml,
  getDemoBookmarkDetail,
  getDemoImportTaskDetail,
  listDemoImportTasks,
  previewDemoImport,
  updateDemoBookmarkMetadata,
  updateDemoFolder,
  updateDemoTag,
  type DemoWorkspace,
} from "./demoData";
import { enqueueBookmarksToLocalExtension } from "./local-archive-bridge";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready" | "error";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type AuthMode = "login" | "register";
type ArchiveViewMode = "reader" | "original";
type ViewRoute =
  | { page: "list" }
  | { page: "detail"; bookmarkId: string; versionId?: string }
  | { page: "imports-new" }
  | { page: "imports-list" }
  | { page: "imports-detail"; taskId: string }
  | { page: "settings-api-tokens" };

type SessionState =
  | { status: "booting"; token: null; user: null; error: string | null }
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

type ArchivePreviewState =
  | { status: "idle"; url?: undefined; error?: undefined }
  | { status: "loading"; url?: undefined; error?: undefined }
  | { status: "ready"; url: string; error?: undefined }
  | { status: "error"; url?: undefined; error: string };

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

type ManagerDialogState =
  | { kind: "closed" }
  | { kind: "delete-bookmark"; bookmark: Bookmark }
  | { kind: "delete-bookmarks-batch"; bookmarkIds: string[]; count: number }
  | { kind: "create-folder"; parent?: Folder }
  | { kind: "edit-folder"; folder: Folder }
  | { kind: "delete-folder"; folder: Folder }
  | { kind: "create-tag" }
  | { kind: "edit-tag"; tag: Tag }
  | { kind: "delete-tag"; tag: Tag };

type ContextMenuState =
  | { kind: "closed" }
  | { kind: "bookmark"; bookmark: Bookmark; x: number; y: number }
  | { kind: "folder"; folder: Folder; x: number; y: number }
  | { kind: "tag"; tag: Tag; x: number; y: number };

type ContextMenuItem = {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type ContextMenuGroup = {
  label?: string;
  items: ContextMenuItem[];
};

const AUTH_TOKEN_STORAGE_KEY = "keeppage.auth-token";
const API_TOKEN_SECRET_STORAGE_PREFIX = "keeppage.api-token-secrets";
const SIDEBAR_COUNT_PAGE_SIZE = 100;

type ApiTokenSecretRecord = {
  value: string;
  savedAt: string;
};

function qualityLabel(grade?: QualityGrade) {
  if (!grade) {
    return "未知";
  }
  if (grade === "high") {
    return "高";
  }
  if (grade === "medium") {
    return "中";
  }
  return "低";
}

function qualityClass(grade?: QualityGrade) {
  if (grade === "high") {
    return "quality quality-high";
  }
  if (grade === "medium") {
    return "quality quality-medium";
  }
  if (grade === "low") {
    return "quality quality-low";
  }
  return "quality quality-unknown";
}

function previewModeLabel(mode: ArchiveViewMode) {
  return mode === "reader" ? "阅读视图" : "原始归档";
}

function resolvePreviewSelection(
  version: BookmarkViewerVersion | null,
  preferredMode: ArchiveViewMode,
): {
  mode: ArchiveViewMode;
  objectKey: string;
  sizeBytes?: number;
} | null {
  if (!version) {
    return null;
  }

  const candidates: ArchiveViewMode[] = preferredMode === "reader"
    ? ["reader", "original"]
    : ["original", "reader"];

  for (const mode of candidates) {
    if (mode === "reader" && version.readerHtmlObjectKey && version.readerArchiveAvailable) {
      return {
        mode,
        objectKey: version.readerHtmlObjectKey,
        sizeBytes: version.readerArchiveSizeBytes,
      };
    }
    if (mode === "original" && version.archiveAvailable) {
      return {
        mode,
        objectKey: version.htmlObjectKey,
        sizeBytes: version.archiveSizeBytes,
      };
    }
  }

  return null;
}

function formatWhen(input: string) {
  const date = new Date(input);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeWhen(input: string) {
  const target = new Date(input);
  const diffMs = target.getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return formatWhen(input);
  }

  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) {
    return "刚刚";
  }

  const formatter = new Intl.RelativeTimeFormat("zh-CN", {
    numeric: "auto",
  });
  const units = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ] as const;

  for (const { unit, ms } of units) {
    if (absMs >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }

  return formatWhen(input);
}

function formatFileSize(input?: number) {
  if (!input || input <= 0) {
    return "未知";
  }
  if (input >= 1024 * 1024) {
    return `${(input / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (input >= 1024) {
    return `${(input / 1024).toFixed(1)} KB`;
  }
  return `${input} B`;
}

function formatDateTimeInputValue(input?: string) {
  if (!input) {
    return "";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createDemoApiTokens(): ApiToken[] {
  const now = Date.now();
  return [
    {
      id: "demo-token-active",
      name: "Raycast Inbox",
      tokenPreview: "kp_demo-rayc.3f28ab",
      scopes: ["bookmark:create"],
      lastUsedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      expiresAt: undefined,
      revokedAt: undefined,
      createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "demo-token-revoked",
      name: "Zapier Legacy",
      tokenPreview: "kp_demo-zapi.8b91c4",
      scopes: ["bookmark:create"],
      lastUsedAt: new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: undefined,
      revokedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now - 24 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

function isApiTokenExpired(token: ApiToken) {
  return Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
}

function isApiTokenActive(token: ApiToken) {
  return !token.revokedAt && !isApiTokenExpired(token);
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const successful = document.execCommand("copy");
  textarea.remove();
  if (!successful) {
    throw new Error("当前环境不支持复制到剪贴板。");
  }
}

function buildAppUrl(hash: string) {
  return new URL(hash, window.location.href).toString();
}

function getApiTokenSecretStorageKey(userId: string) {
  return `${API_TOKEN_SECRET_STORAGE_PREFIX}:${userId}`;
}

function readApiTokenSecrets(userId: string): Record<string, ApiTokenSecretRecord> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(getApiTokenSecretStorageKey(userId));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, ApiTokenSecretRecord>>((accumulator, [tokenId, value]) => {
      if (typeof value !== "object" || value === null) {
        return accumulator;
      }

      const record = value as {
        value?: unknown;
        savedAt?: unknown;
      };
      if (typeof record.value !== "string" || !record.value.trim()) {
        return accumulator;
      }

      accumulator[tokenId] = {
        value: record.value.trim(),
        savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
      };
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function writeApiTokenSecrets(userId: string, secrets: Record<string, ApiTokenSecretRecord>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (Object.keys(secrets).length === 0) {
      window.localStorage.removeItem(getApiTokenSecretStorageKey(userId));
      return;
    }
    window.localStorage.setItem(getApiTokenSecretStorageKey(userId), JSON.stringify(secrets));
  } catch {
    // Ignore storage write failures and keep the UI usable.
  }
}

function resolveApiBaseForCurl() {
  const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim() || "/api";
  const normalizedBase = configuredBase.replace(/\/$/, "");
  if (/^https?:\/\//i.test(normalizedBase)) {
    return normalizedBase;
  }
  return new URL(normalizedBase, window.location.origin).toString().replace(/\/$/, "");
}

function buildBookmarkIngestCurl(
  apiBaseUrl: string,
  tokenValue: string,
  authMode: "authorization" | "x-api-key" = "authorization",
) {
  const authHeader = authMode === "authorization"
    ? `  -H 'Authorization: Bearer ${tokenValue}' \\`
    : `  -H 'X-KeepPage-Api-Key: ${tokenValue}' \\`;

  return [
    `curl -X POST '${apiBaseUrl}/ingest/bookmarks' \\`,
    authHeader,
    "  -H 'Content-Type: application/json' \\",
    "  -d '{",
    '    "url": "https://example.com/article",',
    '    "title": "KeepPage API 密钥测试",',
    '    "note": "来自 API 密钥页面",',
    '    "tags": ["api-key", "curl"],',
    '    "folderPath": "Inbox/API",',
    '    "dedupeStrategy": "merge"',
    "  }'",
  ].join("\n");
}

function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const horizontalGap = 20;
  const verticalGap = 20;
  const left = Math.min(
    Math.max(horizontalGap, x),
    Math.max(horizontalGap, window.innerWidth - width - horizontalGap),
  );
  const top = Math.min(
    Math.max(verticalGap, y),
    Math.max(verticalGap, window.innerHeight - height - verticalGap),
  );
  return { left, top };
}

function retentionLabel(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "—";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function parseRoute(hash: string): ViewRoute {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return { page: "list" };
  }

  const [pathPart, queryString = ""] = normalized.split("?");
  const path = pathPart.replace(/\/+$/, "");
  if (path === "/imports/new") {
    return { page: "imports-new" };
  }
  if (path === "/imports") {
    return { page: "imports-list" };
  }
  if (path === "/settings/api-tokens") {
    return { page: "settings-api-tokens" };
  }
  if (path.startsWith("/imports/")) {
    const taskId = decodeURIComponent(path.slice("/imports/".length));
    if (!taskId) {
      return { page: "imports-list" };
    }
    return {
      page: "imports-detail",
      taskId,
    };
  }
  if (!path.startsWith("/bookmarks/")) {
    return { page: "list" };
  }

  const bookmarkId = decodeURIComponent(path.slice("/bookmarks/".length));
  if (!bookmarkId) {
    return { page: "list" };
  }

  const versionId = new URLSearchParams(queryString).get("version") ?? undefined;
  return {
    page: "detail",
    bookmarkId,
    versionId,
  };
}

function buildDetailHash(bookmarkId: string, versionId?: string) {
  const params = new URLSearchParams();
  if (versionId) {
    params.set("version", versionId);
  }
  return `#/bookmarks/${encodeURIComponent(bookmarkId)}${params.toString() ? `?${params.toString()}` : ""}`;
}

function goToList() {
  window.location.hash = "#/";
}

function goToImportNew() {
  window.location.hash = "#/imports/new";
}

function goToImportList() {
  window.location.hash = "#/imports";
}

function goToApiTokens() {
  window.location.hash = "#/settings/api-tokens";
}

function openImportTask(taskId: string) {
  window.location.hash = `#/imports/${encodeURIComponent(taskId)}`;
}

function openBookmark(bookmarkId: string, versionId?: string) {
  window.location.hash = buildDetailHash(bookmarkId, versionId);
}

function summarizeBookmark(bookmark: Bookmark) {
  const note = bookmark.note.trim();
  if (note) {
    return note;
  }

  const firstReason = bookmark.latestQuality?.reasons[0]?.message?.trim();
  if (firstReason) {
    return firstReason;
  }

  if (bookmark.folder?.path) {
    return `已归档到 ${bookmark.folder.path}，当前共保留 ${bookmark.versionCount} 个版本，可随时打开查看。`;
  }

  if (bookmark.tags.length > 0) {
    const tagNames = bookmark.tags.slice(0, 3).map((tag) => `#${tag.name}`).join("、");
    return `标签：${tagNames}。当前共保留 ${bookmark.versionCount} 个版本。`;
  }

  return `已保存来自 ${bookmark.domain} 的网页归档，当前共保留 ${bookmark.versionCount} 个版本。`;
}

function getDomainMonogram(domain: string) {
  const letters = domain
    .replace(/^www\./i, "")
    .split(".")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || domain.slice(0, 2).toUpperCase();
}

function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, onOpen: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onOpen();
}

function isManagerDialogOpen(state: ManagerDialogState) {
  return state.kind !== "closed";
}

function DialogCloseIcon() {
  return (
    <span className="material-symbols-outlined" aria-hidden="true">
      close
    </span>
  );
}

function getStoredToken() {
  const stored = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
  return stored || null;
}

function setStoredToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function clearStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function displayUserName(user: AuthUser) {
  return user.name?.trim() || user.email;
}

function userInitials(user: AuthUser) {
  const source = user.name?.trim() || user.email.split("@")[0] || user.email;
  const segments = source
    .split(/[\s._-]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function homeCoverTone(domain: string) {
  const tones = ["peach", "mist", "sand", "sky"] as const;
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return tones[hash % tones.length];
}

function HomeBookmarkCard({
  bookmark,
  onOpen,
  onContextMenu,
  isContextOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  bookmark: Bookmark;
  onOpen: (bookmarkId: string) => void;
  onContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  isContextOpen: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  const [coverImageFailed, setCoverImageFailed] = useState(false);

  useEffect(() => {
    setCoverImageFailed(false);
  }, [bookmark.id, bookmark.coverImageUrl]);

  const summary = summarizeBookmark(bookmark);
  const hasCoverImage = Boolean(bookmark.coverImageUrl) && !coverImageFailed;
  const folderLabel = bookmark.folder?.name ?? "未归类";
  const coverTone = homeCoverTone(bookmark.domain);
  const coverInitial = (bookmark.title.trim()[0] ?? bookmark.domain.trim()[0] ?? "K").toUpperCase();

  const cardClasses = [
    "home-bookmark-card",
    isContextOpen ? "is-context-open" : "",
    selectionMode ? "is-selection-mode" : "",
    isSelected ? "is-selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <article
      className={cardClasses}
      onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
      onContextMenu={(event) => onContextMenu(bookmark, event)}
    >
      {selectionMode ? (
        <span
          className={`home-bookmark-checkbox${isSelected ? " is-checked" : ""}`}
          aria-hidden="true"
        >
          {isSelected ? "✓" : ""}
        </span>
      ) : null}
      <button
        className="home-bookmark-hitarea"
        type="button"
        onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
        onClick={() => selectionMode ? onToggleSelect(bookmark.id) : onOpen(bookmark.id)}
        aria-label={selectionMode ? `选择书签：${bookmark.title}` : `打开归档：${bookmark.title}`}
      >
        <div
          className={`home-bookmark-cover is-${coverTone}${hasCoverImage ? " has-image" : " is-placeholder"}`}
          aria-hidden="true"
        >
          {hasCoverImage ? (
            <>
              <img
                className="home-bookmark-cover-media"
                src={bookmark.coverImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setCoverImageFailed(true)}
              />
              <div className="home-bookmark-cover-shade" aria-hidden="true" />
            </>
          ) : (
            <div className="home-bookmark-paper" aria-hidden="true">
              <div className="home-bookmark-paper-eyebrow">
                <span>{bookmark.domain}</span>
                <strong>{coverInitial}</strong>
              </div>
              <div className="home-bookmark-paper-title">
                <span>{bookmark.title}</span>
              </div>
              <div className="home-bookmark-paper-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          {hasCoverImage ? (
            <div className="home-bookmark-cover-overlay">
              <div className="home-bookmark-cover-overlay-meta">
                <span className="home-bookmark-overlay-badge">{folderLabel}</span>
                <span className="home-bookmark-overlay-time">{formatRelativeWhen(bookmark.updatedAt)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="home-bookmark-body">
          <div className="home-bookmark-title-row">
            <h2>{bookmark.title}</h2>
            {bookmark.isFavorite ? (
              <span className="home-bookmark-favorite material-symbols-outlined" aria-hidden="true">
                star
              </span>
            ) : null}
          </div>
          <p>{summary}</p>
          <footer className="home-bookmark-meta">
            <span className="home-bookmark-domain">{bookmark.domain}</span>
            <span className="home-bookmark-time">{formatRelativeWhen(bookmark.updatedAt)}</span>
          </footer>
        </div>
      </button>
    </article>
  );
}

function HomeBookmarkSkeleton() {
  return (
    <article className="home-bookmark-card home-bookmark-card-skeleton">
      <div className="home-bookmark-hitarea is-skeleton">
        <div className="home-skeleton-cover" />
        <div className="home-bookmark-body">
          <span className="home-skeleton-line is-title" />
          <span className="home-skeleton-line" />
          <span className="home-skeleton-line is-short" />
          <footer className="home-bookmark-meta">
            <span className="home-skeleton-line is-meta" />
            <span className="home-skeleton-line is-meta-short" />
          </footer>
        </div>
      </div>
    </article>
  );
}

function AppShell({
  user,
  items,
  countItems,
  folders,
  tags,
  routePage,
  bookmarkView,
  selectedFolderId,
  selectedTagId,
  searchInput,
  onSearchChange,
  managerBusy,
  onSelectBookmarkView,
  onSelectFolder,
  onSelectTag,
  onGoHome,
  onCreateRootFolder,
  onCreateTag,
  onOpenApiTokens,
  onOpenImportNew,
  onOpenImportHistory,
  onOpenCloudArchive,
  onLogout,
  contextMenuFolderId,
  onFolderContextMenu,
  contextMenuTagId,
  onTagContextMenu,
  children,
  logoutLabel = "退出登录",
}: {
  user: AuthUser;
  items: Bookmark[];
  countItems: Bookmark[];
  folders: Folder[];
  tags: Tag[];
  routePage: ViewRoute["page"];
  bookmarkView: BookmarkListView;
  selectedFolderId: string;
  selectedTagId: string;
  searchInput: string;
  onSearchChange: (value: string) => void;
  managerBusy: boolean;
  onSelectBookmarkView: (view: BookmarkListView) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tagId: string) => void;
  onGoHome: () => void;
  onCreateRootFolder: () => void;
  onCreateTag: () => void;
  onOpenApiTokens: () => void;
  onOpenImportNew: () => void;
  onOpenImportHistory: () => void;
  onOpenCloudArchive: () => void;
  onLogout: () => void;
  contextMenuFolderId: string | null;
  onFolderContextMenu: (folder: Folder, event: ReactMouseEvent<HTMLElement>) => void;
  contextMenuTagId: string | null;
  onTagContextMenu: (tag: Tag, event: ReactMouseEvent<HTMLElement>) => void;
  children: ReactNode;
  logoutLabel?: string;
}) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [sidebarView, setSidebarView] = useState<"main" | "settings">("main");
  const activeNav = selectedFolderId || selectedTagId ? null : bookmarkView;

  const sortedFolders = useMemo(
    () => [...folders].sort((left, right) => left.path.localeCompare(right.path, "zh-CN")),
    [folders],
  );

  const childrenByParent = useMemo(() => {
    const mapping = new Map<string | null, Folder[]>();
    for (const folder of sortedFolders) {
      const key = folder.parentId ?? null;
      const current = mapping.get(key) ?? [];
      current.push(folder);
      mapping.set(key, current);
    }
    return mapping;
  }, [sortedFolders]);

  const descendantIdsByFolder = useMemo(() => {
    const mapping = new Map<string, string[]>();

    function visit(folder: Folder): string[] {
      const childIds = (childrenByParent.get(folder.id) ?? []).flatMap(visit);
      const ids = [folder.id, ...childIds];
      mapping.set(folder.id, ids);
      return ids;
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      visit(folder);
    }

    return mapping;
  }, [childrenByParent]);

  const visibleFolderRows = useMemo(() => {
    const rows: Array<{ folder: Folder; depth: number; hasChildren: boolean }> = [];

    function append(folder: Folder, depth: number) {
      const folderChildren = childrenByParent.get(folder.id) ?? [];
      rows.push({
        folder,
        depth,
        hasChildren: folderChildren.length > 0,
      });
      if (collapsedFolderIds.has(folder.id)) {
        return;
      }
      for (const child of folderChildren) {
        append(child, depth + 1);
      }
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      append(folder, 0);
    }

    return rows;
  }, [childrenByParent, collapsedFolderIds]);

  const folderCounts = useMemo(() => {
    const mapping = new Map<string, number>();
    for (const folder of sortedFolders) {
      const descendantIds = new Set(descendantIdsByFolder.get(folder.id) ?? [folder.id]);
      let count = 0;
      for (const item of countItems) {
        const folderId = item.folder?.id;
        if (folderId && descendantIds.has(folderId)) {
          count += 1;
        }
      }
      mapping.set(folder.id, count);
    }
    return mapping;
  }, [countItems, descendantIdsByFolder, sortedFolders]);

  useEffect(() => {
    setCollapsedFolderIds((current) => {
      const next = new Set(
        [...current].filter((folderId) => sortedFolders.some((folder) => folder.id === folderId)),
      );
      if (next.size === current.size) {
        let changed = false;
        for (const folderId of next) {
          if (!current.has(folderId)) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return current;
        }
      }
      return next;
    });
  }, [sortedFolders]);

  const displayName = displayUserName(user);

  function handleSelectQuickNav(nextNav: BookmarkListView) {
    setSidebarView("main");
    onSelectBookmarkView(nextNav);
    onSelectFolder("");
    onSelectTag("");
  }

  function handleSelectFolderFilter(nextFolderId: string) {
    setSidebarView("main");
    onSelectBookmarkView("all");
    onSelectTag("");
    onSelectFolder(nextFolderId);
  }

  function handleSelectTagFilter(nextTagId: string) {
    setSidebarView("main");
    onSelectBookmarkView("all");
    onSelectFolder("");
    onSelectTag(nextTagId);
  }

  function handleToggleFolder(folder: Folder) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folder.id)) {
        next.delete(folder.id);
        return next;
      }

      const descendantIds = descendantIdsByFolder.get(folder.id) ?? [folder.id];
      if (selectedFolderId && selectedFolderId !== folder.id && descendantIds.includes(selectedFolderId)) {
        onSelectFolder(folder.id);
      }
      next.add(folder.id);
      return next;
    });
  }

  return (
    <main className="home-page">
      <aside className="home-sidebar">
        {sidebarView === "settings" ? (
          <div className="home-settings-panel">
            <button
              className="home-settings-back"
              type="button"
              onClick={() => setSidebarView("main")}
              aria-label="返回侧边栏"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                arrow_back
              </span>
              <span>设置</span>
            </button>

            <div className="home-settings-list">
              <button
                className={routePage === "settings-api-tokens" ? "home-settings-item is-active" : "home-settings-item"}
                type="button"
                onClick={onOpenApiTokens}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  vpn_key
                </span>
                <span>API 密钥</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => { setSidebarView("main"); onOpenCloudArchive(); }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  cloud_download
                </span>
                <span>云端存档</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => { setSidebarView("main"); onOpenImportNew(); }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                <span>新建导入</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => { setSidebarView("main"); onOpenImportHistory(); }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  history
                </span>
                <span>导入历史</span>
              </button>
              <div className="home-settings-divider" aria-hidden="true" />
              <button
                className="home-settings-item is-danger"
                type="button"
                onClick={() => { setSidebarView("main"); onLogout(); }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  logout
                </span>
                <span>{logoutLabel}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="home-brand">
              <button className="home-brand-home" type="button" onClick={onGoHome} aria-label="返回主页">
                <span className="home-brand-title">KeepPage</span>
              </button>
              <button
                className="home-brand-action"
                type="button"
                onClick={() => setSidebarView("settings")}
                aria-label="打开设置"
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  more_horiz
                </span>
              </button>
            </div>

            <label className="home-search">
              <span className="home-search-icon material-symbols-outlined" aria-hidden="true">
                search
              </span>
              <input
                className="home-search-input"
                type="search"
                value={searchInput}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="搜索标题、域名、标签..."
              />
            </label>

            <nav className="home-quick-nav" aria-label="快捷导航">
              <button
                className={activeNav === "all" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("all")}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={
                    activeNav === "all"
                      ? { fontVariationSettings: "'FILL' 1, 'wght' 300, 'GRAD' 0, 'opsz' 20" }
                      : undefined
                  }
                >
                  bookmark
                </span>
                <span>全部书签</span>
              </button>
              <button
                className={activeNav === "recent" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("recent")}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  schedule
                </span>
                <span>最近更新</span>
              </button>
              <button
                className={activeNav === "favorites" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("favorites")}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  star
                </span>
                <span>星标收藏</span>
              </button>
            </nav>

            <div className="home-sidebar-scroll">
              <section className="home-sidebar-section">
                <header className="home-sidebar-section-head">
                  <span>Collections</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={onCreateRootFolder}
                    disabled={managerBusy}
                    aria-label="新建收藏夹"
                    title="新建收藏夹"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </header>
                <div className="home-folder-list">
                  {visibleFolderRows.map(({ folder, depth, hasChildren }) => (
                    <div
                      className="home-folder-row"
                      key={folder.id}
                      onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                      onContextMenu={(event) => onFolderContextMenu(folder, event)}
                    >
                      <button
                        className={[
                          "home-folder-main",
                          selectedFolderId === folder.id ? "is-active" : "",
                          depth > 0 ? "is-child" : "",
                          contextMenuFolderId === folder.id ? "is-context-open" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        style={{ paddingLeft: `${12 + depth * 14}px` }}
                        onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                        onClick={() => handleSelectFolderFilter(selectedFolderId === folder.id ? "" : folder.id)}
                      >
                        <span className="home-folder-label">
                          <span className="home-folder-icon material-symbols-outlined" aria-hidden="true">
                            folder_open
                          </span>
                          <span className="home-folder-name">{folder.name}</span>
                        </span>
                        <span className="home-folder-count">{folderCounts.get(folder.id) ?? 0}</span>
                      </button>
                      {hasChildren ? (
                        <button
                          className={[
                            "home-folder-toggle",
                            collapsedFolderIds.has(folder.id) ? "" : "is-expanded",
                            contextMenuFolderId === folder.id ? "is-context-open" : "",
                          ].filter(Boolean).join(" ")}
                          type="button"
                          onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                          onClick={() => handleToggleFolder(folder)}
                          aria-label={`${collapsedFolderIds.has(folder.id) ? "展开" : "收起"} ${folder.name}`}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">
                            keyboard_arrow_right
                          </span>
                        </button>
                      ) : (
                        <span className="home-folder-toggle-spacer" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="home-sidebar-section">
                <header className="home-sidebar-section-head">
                  <span>Tags</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={onCreateTag}
                    disabled={managerBusy}
                    aria-label="新建标签"
                    title="新建标签"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </header>
                <div className="home-tag-list">
                  {tags.map((tag) => {
                    const active = selectedTagId === tag.id;
                    const contextOpen = contextMenuTagId === tag.id;
                    return (
                      <button
                        key={tag.id}
                        className={[
                          "home-tag-chip",
                          active ? "is-active" : "",
                          contextOpen ? "is-context-open" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        onClick={() => handleSelectTagFilter(active ? "" : tag.id)}
                        onContextMenu={(event) => onTagContextMenu(tag, event)}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="home-sidebar-footer">
              <button className="home-add-new-btn" type="button" onClick={onOpenImportNew}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                <span>Add New</span>
              </button>

              <div className="home-user-profile">
                <div className="home-avatar">{userInitials(user)}</div>
                <div className="home-user-info">
                  <span className="home-user-name">{displayName}</span>
                  <span className="home-user-plan">专业版</span>
                </div>
                <button
                  className="home-settings-btn"
                  type="button"
                  onClick={() => setSidebarView("settings")}
                  aria-label="打开设置"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    settings
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      <div className="home-shell">
        <header className="home-topbar" />

        <section className="home-content">
          {children}
        </section>
      </div>
    </main>
  );
}

function HomePage({
  items,
  bookmarkView,
  loadState,
  listError,
  hasActiveFilters,
  managerFeedback,
  onOpenBookmark,
  contextMenuBookmarkId,
  onBookmarkContextMenu,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  items: Bookmark[];
  bookmarkView: BookmarkListView;
  loadState: LoadState;
  listError: string | null;
  hasActiveFilters: boolean;
  managerFeedback: InlineFeedback | null;
  onOpenBookmark: (bookmarkId: string) => void;
  contextMenuBookmarkId: string | null;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  const showLoading = loadState === "loading";
  const showError = loadState === "error";
  const showEmpty = !showLoading && !showError && items.length === 0;
  const emptyTitle = hasActiveFilters
    ? "当前筛选下没有匹配的归档"
    : bookmarkView === "favorites"
      ? "还没有收藏的归档"
      : bookmarkView === "recent"
        ? "最近 7 天还没有归档更新"
        : "还没有归档记录";
  const emptyDescription = hasActiveFilters
    ? "换个关键词，或者切换收藏夹和标签试试。"
    : bookmarkView === "favorites"
      ? "把常看的页面加入收藏后，会显示在这里。"
      : bookmarkView === "recent"
        ? "最近新归档或编辑过的页面会优先显示在这里。"
        : "扩展同步的网页归档会优先显示在这里。";

  return (
    <>
      {managerFeedback ? (
        <p className={managerFeedback.kind === "error" ? "home-feedback is-error" : "home-feedback"}>
          {managerFeedback.message}
        </p>
      ) : null}

      {showLoading && items.length > 0 ? (
        <p className="home-loading-note">正在刷新归档列表...</p>
      ) : null}

      {showLoading && items.length === 0 ? (
        <section className="home-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <HomeBookmarkSkeleton key={index} />
          ))}
        </section>
      ) : showError ? (
        <section className="home-empty-panel">
          <h2>归档列表加载失败</h2>
          <p>{listError ?? "暂时无法读取当前账号的归档列表。"}</p>
        </section>
      ) : showEmpty ? (
        <section className="home-empty-panel">
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </section>
      ) : (
        <section className="home-grid">
          {items.map((bookmark) => (
            <HomeBookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              onOpen={onOpenBookmark}
              onContextMenu={onBookmarkContextMenu}
              isContextOpen={contextMenuBookmarkId === bookmark.id}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(bookmark.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </section>
      )}

      <footer className="home-footer">
        <span>Privacy</span>
        <span>Terms</span>
        <span>Support</span>
        <span>KeepPage</span>
      </footer>
    </>
  );
}

function SelectionToolbar({
  selectedCount,
  totalCount,
  busy,
  folders,
  tags,
  batchDropdown,
  onBatchDropdownChange,
  onSelectAll,
  onDeselectAll,
  onBatchFavorite,
  onBatchLocalArchive,
  onBatchMoveTo,
  onBatchSetTags,
  onBatchDelete,
  onExit,
}: {
  selectedCount: number;
  totalCount: number;
  busy: boolean;
  folders: Folder[];
  tags: Tag[];
  batchDropdown: "closed" | "folder" | "tag";
  onBatchDropdownChange: (v: "closed" | "folder" | "tag") => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchFavorite: (isFavorite: boolean) => void;
  onBatchLocalArchive: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[]) => void;
  onBatchDelete: () => void;
  onExit: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (batchDropdown === "closed") return;
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onBatchDropdownChange("closed");
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [batchDropdown]);

  const allSelected = selectedCount === totalCount && totalCount > 0;
  const hasSelection = selectedCount > 0;

  return (
    <div className="selection-toolbar">
      <div className="selection-toolbar-left">
        <button
          type="button"
          className="selection-toolbar-check-all"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          disabled={busy}
        >
          <span className={`selection-toolbar-checkbox${allSelected ? " is-checked" : ""}`}>
            {allSelected ? "✓" : ""}
          </span>
          {allSelected ? "取消全选" : "全选"}
        </button>
        <span className="selection-toolbar-count">
          已选 {selectedCount} / {totalCount}
        </span>
      </div>
      <div className="selection-toolbar-actions" ref={dropdownRef}>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(true)}
          title="加入收藏"
        >
          收藏
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(false)}
          title="取消收藏"
        >
          取消收藏
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={onBatchLocalArchive}
          title="发送到本地插件队列"
        >
          本地存档
        </button>
        <div className="selection-toolbar-dropdown-wrapper">
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            onClick={() => onBatchDropdownChange(batchDropdown === "folder" ? "closed" : "folder")}
          >
            移动到
          </button>
          {batchDropdown === "folder" ? (
            <div className="selection-toolbar-dropdown">
              <button
                type="button"
                className="selection-toolbar-dropdown-item"
                onClick={() => { onBatchMoveTo(null); onBatchDropdownChange("closed"); }}
              >
                未归类
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="selection-toolbar-dropdown-item"
                  onClick={() => { onBatchMoveTo(folder.id); onBatchDropdownChange("closed"); }}
                >
                  {folder.path}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="selection-toolbar-dropdown-wrapper">
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            onClick={() => onBatchDropdownChange(batchDropdown === "tag" ? "closed" : "tag")}
          >
            标签
          </button>
          {batchDropdown === "tag" ? (
            <div className="selection-toolbar-dropdown">
              {tags.length === 0 ? (
                <span className="selection-toolbar-dropdown-empty">暂无标签</span>
              ) : null}
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="selection-toolbar-dropdown-item"
                  onClick={() => { onBatchSetTags([tag.id]); onBatchDropdownChange("closed"); }}
                >
                  {tag.color ? <span className="selection-toolbar-tag-dot" style={{ background: tag.color }} /> : null}
                  {tag.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="selection-toolbar-btn is-danger"
          disabled={!hasSelection || busy}
          onClick={onBatchDelete}
        >
          删除
        </button>
      </div>
      <button
        type="button"
        className="selection-toolbar-exit"
        onClick={onExit}
        disabled={busy}
      >
        退出选择
      </button>
    </div>
  );
}

function EmptyState({
  mode,
  title,
  description,
  action,
}: {
  mode: "empty" | "search-empty" | "missing-detail";
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  if (mode === "search-empty") {
    return (
      <section className="empty-state">
        <h2>{title ?? "没有匹配的归档"}</h2>
        <p>{description ?? "试试别的关键词，或者调整质量筛选条件。"}</p>
        {action}
      </section>
    );
  }
  if (mode === "missing-detail") {
    return (
      <section className="empty-state">
        <h2>{title ?? "没有找到这个归档"}</h2>
        <p>{description ?? "它可能还未同步完成，或者当前账号下不存在该书签。"}</p>
        {action}
      </section>
    );
  }
  return (
    <section className="empty-state">
      <h2>{title ?? "还没有归档记录"}</h2>
      <p>{description ?? "登录后，扩展同步过来的页面会出现在这里。"}</p>
      {action}
    </section>
  );
}

function ApiTokensPanel({
  token,
  userId,
  isDemoMode,
  onApiError,
  onBack,
}: {
  token: string;
  userId: string;
  isDemoMode: boolean;
  onApiError: (error: unknown) => boolean;
  onBack: () => void;
}) {
  const storageUserId = isDemoMode ? "demo" : userId;
  const [loadState, setLoadState] = useState<LoadState>(isDemoMode ? "ready" : "idle");
  const [items, setItems] = useState<ApiToken[]>(() => (isDemoMode ? createDemoApiTokens() : []));
  const [demoItems, setDemoItems] = useState<ApiToken[]>(() => createDemoApiTokens());
  const [storedTokenSecrets, setStoredTokenSecrets] = useState<Record<string, ApiTokenSecretRecord>>(
    () => readApiTokenSecrets(storageUserId),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ id: string; name: string; value: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createExpiresAt, setCreateExpiresAt] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const apiBaseUrl = useMemo(() => resolveApiBaseForCurl(), []);

  useEffect(() => {
    setStoredTokenSecrets(readApiTokenSecrets(storageUserId));
  }, [storageUserId]);

  useEffect(() => {
    setFeedback(null);
    if (isDemoMode) {
      setItems(demoItems);
      setLoadError(null);
      setLoadState("ready");
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    fetchApiTokens(token)
      .then((nextItems) => {
        if (cancelled) {
          return;
        }
        setItems(nextItems);
        setLoadError(null);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled || onApiError(error)) {
          return;
        }
        setLoadError(toErrorMessage(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [demoItems, isDemoMode, token]);

  const activeCount = useMemo(
    () => items.filter((item) => isApiTokenActive(item)).length,
    [items],
  );
  const revokedCount = useMemo(
    () => items.filter((item) => Boolean(item.revokedAt)).length,
    [items],
  );
  const latestUsedAt = useMemo(() => {
    const candidates = items
      .map((item) => item.lastUsedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    return candidates[0];
  }, [items]);
  const locallyStoredCount = useMemo(
    () => items.filter((item) => Boolean(storedTokenSecrets[item.id]?.value)).length,
    [items, storedTokenSecrets],
  );

  function updateStoredTokenSecrets(
    updater: (current: Record<string, ApiTokenSecretRecord>) => Record<string, ApiTokenSecretRecord>,
  ) {
    setStoredTokenSecrets((current) => {
      const next = updater(current);
      writeApiTokenSecrets(storageUserId, next);
      return next;
    });
  }

  function openCreateDialog() {
    setCreateName("");
    setCreateExpiresAt("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (createBusy) {
      return;
    }
    setCreateOpen(false);
    setCreateError(null);
  }

  async function handleCopyRevealedToken() {
    if (!revealedToken) {
      return;
    }
    try {
      await copyTextToClipboard(revealedToken.value);
      setFeedback({
        kind: "success",
        message: `已复制 ${revealedToken.name} 的完整 API 密钥。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCopyCurl(
    itemName: string,
    tokenValue: string,
    authMode: "authorization" | "x-api-key",
  ) {
    const curlCommand = buildBookmarkIngestCurl(apiBaseUrl, tokenValue, authMode);
    try {
      await copyTextToClipboard(curlCommand);
      setFeedback({
        kind: "success",
        message: authMode === "authorization"
          ? `已复制 ${itemName} 的 Bearer curl 命令。`
          : `已复制 ${itemName} 的 X-KeepPage-Api-Key curl 命令。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCopyStoredToken(itemName: string, tokenValue: string) {
    try {
      await copyTextToClipboard(tokenValue);
      setFeedback({
        kind: "success",
        message: `已复制 ${itemName} 的完整 API 密钥。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCreateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError("请填写 API 密钥名称。");
      return;
    }

    let expiresAt: string | undefined;
    if (createExpiresAt.trim()) {
      const parsed = new Date(createExpiresAt);
      if (Number.isNaN(parsed.getTime())) {
        setCreateError("请输入有效的过期时间。");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setCreateBusy(true);
    setCreateError(null);

    try {
      if (isDemoMode) {
        const now = new Date().toISOString();
        const secret = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
        const demoToken = `kp_${crypto.randomUUID()}.${secret}`;
        const preview = demoToken.slice(0, 18);
        const createdItem: ApiToken = {
          id: crypto.randomUUID(),
          name: trimmedName,
          tokenPreview: preview,
          scopes: ["bookmark:create"],
          lastUsedAt: undefined,
          expiresAt,
          revokedAt: undefined,
          createdAt: now,
        };
        setDemoItems((current) => [createdItem, ...current]);
        setItems((current) => [createdItem, ...current]);
        updateStoredTokenSecrets((current) => ({
          ...current,
          [createdItem.id]: {
            value: demoToken,
            savedAt: now,
          },
        }));
        setRevealedToken({
          id: createdItem.id,
          name: trimmedName,
          value: demoToken,
        });
      } else {
        const result = await createApiToken({
          name: trimmedName,
          scopes: ["bookmark:create"],
          expiresAt,
        }, token);
        setItems((current) => [result.item, ...current]);
        updateStoredTokenSecrets((current) => ({
          ...current,
          [result.item.id]: {
            value: result.token,
            savedAt: new Date().toISOString(),
          },
        }));
        setRevealedToken({
          id: result.item.id,
          name: result.item.name,
          value: result.token,
        });
      }

      setCreateOpen(false);
      setCreateName("");
      setCreateExpiresAt("");
      setFeedback({
        kind: "success",
        message: `已创建 API 密钥：${trimmedName}。完整明文已保存在当前浏览器，下面可以直接复制 curl 测试。`,
      });
    } catch (error) {
      if (!isDemoMode && onApiError(error)) {
        return;
      }
      setCreateError(toErrorMessage(error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleRevokeToken() {
    if (!revokeTarget) {
      return;
    }

    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const revokedAt = new Date().toISOString();
      if (isDemoMode) {
        setDemoItems((current) => current.map((item) => (
          item.id === revokeTarget.id
            ? { ...item, revokedAt }
            : item
        )));
        setItems((current) => current.map((item) => (
          item.id === revokeTarget.id
            ? { ...item, revokedAt }
            : item
        )));
      } else {
        await revokeApiToken(revokeTarget.id, token);
        setItems((current) => current.map((item) => (
          item.id === revokeTarget.id
            ? { ...item, revokedAt }
            : item
        )));
      }

      updateStoredTokenSecrets((current) => {
        if (!current[revokeTarget.id]) {
          return current;
        }
        const next = { ...current };
        delete next[revokeTarget.id];
        return next;
      });
      if (revealedToken?.id === revokeTarget.id) {
        setRevealedToken(null);
      }

      setFeedback({
        kind: "success",
        message: `已吊销 API 密钥：${revokeTarget.name}。`,
      });
      setRevokeTarget(null);
    } catch (error) {
      if (!isDemoMode && onApiError(error)) {
        return;
      }
      setRevokeError(toErrorMessage(error));
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <>
      <section className="api-token-page">
        <header className="api-token-hero">
          <div className="api-token-hero-copy">
            <p className="eyebrow">设置</p>
            <h1>API 密钥</h1>
            <p>
              给 Raycast、快捷指令、Zapier 或你自己的脚本一个受限写入口。
              目前每个密钥只授予 <code>bookmark:create</code> 权限，适合只传 URL 的自动入库场景。
            </p>
          </div>

          <div className="api-token-hero-actions">
            <button className="secondary-button" type="button" onClick={onBack}>
              返回书签
            </button>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              <span>创建 API 密钥</span>
            </button>
          </div>

          <div className="api-token-stat-grid">
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">生效密钥</span>
              <strong>{activeCount}</strong>
              <small>{items.length} 个密钥中可用的写入入口</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">最近调用</span>
              <strong>{latestUsedAt ? formatRelativeWhen(latestUsedAt) : "尚未调用"}</strong>
              <small>{latestUsedAt ? formatWhen(latestUsedAt) : "创建后等待第一次接入请求"}</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">已吊销</span>
              <strong>{revokedCount}</strong>
              <small>建议定期清理停用的集成入口</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">本地明文</span>
              <strong>{locallyStoredCount}</strong>
              <small>完整密钥仅保存在当前浏览器，方便复制和 curl 调试</small>
            </article>
          </div>
        </header>

        {revealedToken ? (
          <section className="api-token-reveal-card">
            <div className="api-token-reveal-copy">
              <p className="eyebrow">可立即测试</p>
              <h2>{revealedToken.name}</h2>
              <p>完整 API 密钥已保存在当前浏览器本地。服务端仍然只保存哈希，所以换浏览器后不会重新取回明文。</p>
            </div>
            <div className="api-token-secret-shell">
              <code>{revealedToken.value}</code>
              <div className="api-token-secret-actions">
                <button className="secondary-button compact-button" type="button" onClick={() => setRevealedToken(null)}>
                  关闭提示
                </button>
                <button className="primary-button compact-button" type="button" onClick={() => void handleCopyRevealedToken()}>
                  复制完整密钥
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => void handleCopyCurl(revealedToken.name, revealedToken.value, "authorization")}
                >
                  复制 Bearer curl
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {feedback ? (
          <p className={feedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
            {feedback.message}
          </p>
        ) : null}

        {loadState === "loading" && items.length > 0 ? (
          <p className="status-banner">正在刷新 API 密钥列表...</p>
        ) : null}

        {loadState === "loading" && items.length === 0 ? (
          <section className="api-token-list api-token-list-skeleton">
            {Array.from({ length: 3 }).map((_, index) => (
              <article className="api-token-card is-skeleton" key={index}>
                <div className="api-token-skeleton-line is-eyebrow" />
                <div className="api-token-skeleton-line is-title" />
                <div className="api-token-skeleton-line" />
                <div className="api-token-skeleton-row">
                  <span className="api-token-skeleton-pill" />
                  <span className="api-token-skeleton-pill" />
                </div>
              </article>
            ))}
          </section>
        ) : loadState === "error" ? (
          <section className="api-token-empty">
            <h2>API 密钥列表加载失败</h2>
            <p>{loadError ?? "暂时无法读取当前账号的 API 密钥。"}</p>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              继续创建
            </button>
          </section>
        ) : items.length === 0 ? (
          <section className="api-token-empty">
            <h2>还没有 API 密钥</h2>
            <p>创建一个只允许写入书签的 key，把外部网址流接进 KeepPage 的收集箱。</p>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              创建第一个 API 密钥
            </button>
          </section>
        ) : (
          <section className="api-token-list">
            {items.map((item) => {
              const expired = isApiTokenExpired(item);
              const storedTokenValue = storedTokenSecrets[item.id]?.value;
              const statusLabel = item.revokedAt
                ? "已吊销"
                : expired
                  ? "已过期"
                  : "可用";
              const statusClass = item.revokedAt
                ? "is-revoked"
                : expired
                  ? "is-expired"
                  : "is-active";

              return (
                <article className="api-token-card" key={item.id}>
                  <div className="api-token-card-head">
                    <div className="api-token-card-copy">
                      <p className="eyebrow">书签写入口</p>
                      <h2>{item.name}</h2>
                      <code className="api-token-preview">{item.tokenPreview}</code>
                    </div>
                    <span className={`api-token-status ${statusClass}`}>{statusLabel}</span>
                  </div>

                  <div className="api-token-meta-row">
                    {item.scopes.map((scope) => (
                      <span className="api-token-scope-chip" key={scope}>
                        {scope}
                      </span>
                    ))}
                    <span className="api-token-meta-pill">
                      创建于 {formatWhen(item.createdAt)}
                    </span>
                    <span className="api-token-meta-pill">
                      最近使用 {item.lastUsedAt ? formatRelativeWhen(item.lastUsedAt) : "尚未调用"}
                    </span>
                    <span className="api-token-meta-pill">
                      {item.expiresAt ? `到期于 ${formatWhen(item.expiresAt)}` : "长期有效"}
                    </span>
                  </div>

                  <section className="api-token-secret-box">
                    <div className="api-token-section-head">
                      <div>
                        <p className="eyebrow">API 密钥</p>
                        <p>
                          {storedTokenValue
                            ? "完整明文已保存在当前浏览器，可直接复制到脚本、Raycast 或快捷指令。"
                            : "当前浏览器没有保存这把密钥的完整明文；服务端不会再次返回明文。"}
                        </p>
                      </div>
                      {storedTokenValue ? (
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => void handleCopyStoredToken(item.name, storedTokenValue)}
                        >
                          复制密钥
                        </button>
                      ) : null}
                    </div>

                    <code className="api-token-code-block">
                      {storedTokenValue ?? item.tokenPreview}
                    </code>

                    <p className="api-token-secret-note">
                      {storedTokenValue
                        ? "为了方便测试，这个明文只保存在当前浏览器的本地存储里。"
                        : "如果你需要直接测试，请重新创建一个新的 API 密钥。"}
                    </p>
                  </section>

                  <section className="api-token-usage-box">
                    <div className="api-token-section-head">
                      <div>
                        <p className="eyebrow">curl 调试</p>
                        <p>默认示例使用 <code>Authorization: Bearer</code>。也支持复制 <code>X-KeepPage-Api-Key</code> 版本。</p>
                      </div>
                    </div>

                    <code className="api-token-code-block">
                      {buildBookmarkIngestCurl(apiBaseUrl, storedTokenValue ?? "<api-token>", "authorization")}
                    </code>

                    <div className="api-token-usage-actions">
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => void handleCopyCurl(
                          item.name,
                          storedTokenValue ?? "<api-token>",
                          "authorization",
                        )}
                      >
                        {storedTokenValue ? "复制 Bearer curl" : "复制 curl 模板"}
                      </button>
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => void handleCopyCurl(
                          item.name,
                          storedTokenValue ?? "<api-token>",
                          "x-api-key",
                        )}
                      >
                        复制 Header 版本
                      </button>
                    </div>
                  </section>

                  <div className="api-token-card-foot">
                    <p>
                      轻量写入只会创建或合并书签，不会主动抓取网页正文。适合先把 URL 丢进 KeepPage 收集箱。
                    </p>
                    {!item.revokedAt ? (
                      <button
                        className="secondary-button compact-button danger-button"
                        type="button"
                        onClick={() => {
                          setRevokeError(null);
                          setRevokeTarget(item);
                        }}
                      >
                        吊销
                      </button>
                    ) : (
                      <span className="api-token-revoked-note">
                        于 {formatWhen(item.revokedAt)} 停用
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>

      {createOpen ? (
        <div className="manager-dialog-backdrop api-token-dialog-backdrop" aria-hidden="true" onClick={closeCreateDialog}>
          <div
            className="api-token-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-token-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="api-token-dialog-shell">
              <div className="api-token-dialog-header">
                <div className="api-token-dialog-heading">
                  <p className="eyebrow">新建凭证</p>
                  <h2 id="api-token-create-title">创建 API 密钥</h2>
                  <p>生成一个只允许新增书签的写入密钥。创建成功后，完整明文会保存在当前浏览器，方便你直接复制和测试。</p>
                </div>
                <button className="create-folder-dialog-close" type="button" onClick={closeCreateDialog} disabled={createBusy}>
                  <DialogCloseIcon />
                </button>
              </div>

              <form className="api-token-dialog-form" onSubmit={handleCreateToken}>
                <label className="api-token-field">
                  <span className="api-token-field-label">密钥名称</span>
                  <input
                    type="text"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="例如 Raycast 收件箱"
                    autoFocus
                    maxLength={120}
                  />
                </label>

                <label className="api-token-field">
                  <span className="api-token-field-label">过期时间（可选）</span>
                  <input
                    type="datetime-local"
                    value={createExpiresAt}
                    onChange={(event) => setCreateExpiresAt(event.target.value)}
                  />
                  <small>留空表示长期有效。当前固定授予 <code>bookmark:create</code> 作用域。</small>
                </label>

                <div className="api-token-scope-box">
                  <span className="api-token-scope-chip">bookmark:create</span>
                  <p>适合从外部工具传入一个 URL，由 KeepPage 负责合并或新建书签记录。</p>
                </div>

                {createError ? <p className="manager-dialog-error">{createError}</p> : null}

                <div className="api-token-dialog-actions">
                  <button className="secondary-button" type="button" onClick={closeCreateDialog} disabled={createBusy}>
                    取消
                  </button>
                  <button className="primary-button" type="submit" disabled={createBusy}>
                    {createBusy ? "创建中..." : "创建密钥"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {revokeTarget ? (
        <div
          className="manager-dialog-backdrop api-token-dialog-backdrop"
          aria-hidden="true"
          onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
        >
          <div
            className="api-token-dialog is-danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-token-revoke-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="api-token-dialog-shell">
              <div className="api-token-dialog-header">
                <div className="api-token-dialog-heading">
                  <p className="eyebrow">吊销访问</p>
                  <h2 id="api-token-revoke-title">吊销 API 密钥</h2>
                  <p>吊销后，依赖这个密钥的自动化入口会立即失效，现有 URL 不会继续写入你的书签库。</p>
                </div>
                <button
                  className="create-folder-dialog-close"
                  type="button"
                  onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
                  disabled={revokeBusy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <div className="api-token-revoke-card">
                <strong>{revokeTarget.name}</strong>
                <code>{revokeTarget.tokenPreview}</code>
              </div>

              {revokeError ? <p className="manager-dialog-error">{revokeError}</p> : null}

              <div className="api-token-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
                  disabled={revokeBusy}
                >
                  取消
                </button>
                <button className="primary-button danger-fill" type="button" onClick={() => void handleRevokeToken()} disabled={revokeBusy}>
                  {revokeBusy ? "Revoking..." : "确认吊销"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ManagerDialog({
  state,
  busy,
  error,
  nameValue,
  pathValue,
  colorValue,
  onClose,
  onSubmit,
  onConfirmDelete,
  onNameChange,
  onPathChange,
  onColorChange,
}: {
  state: ManagerDialogState;
  busy: boolean;
  error: string | null;
  nameValue: string;
  pathValue: string;
  colorValue: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmDelete: () => void;
  onNameChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onColorChange: (value: string) => void;
}) {
  if (state.kind === "closed") {
    return null;
  }

  if (state.kind === "create-folder" || state.kind === "create-tag") {
    const isCreateFolder = state.kind === "create-folder";
    const createTitle = isCreateFolder ? "New Collection" : "New Tag";
    const createDescription = isCreateFolder
      ? (state.parent
        ? "Organize your bookmarks inside a focused parent collection."
        : "Organize your bookmarks with a custom style.")
      : "Keep related bookmarks grouped under a concise label.";
    const fieldLabel = isCreateFolder ? "Collection Name" : "Tag Name";
    const placeholder = isCreateFolder ? "e.g. Design Inspiration" : "e.g. Read Later";
    const submitLabel = busy
      ? (isCreateFolder ? "Creating..." : "Saving...")
      : "Create";

    return (
      <div
        aria-hidden="true"
        className="manager-dialog-backdrop is-create-folder"
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      >
        <div
          aria-labelledby="manager-dialog-title"
          aria-modal="true"
          className="create-folder-dialog"
          role="dialog"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="create-folder-dialog-shell">
            <div className="create-folder-dialog-header">
              <div className="create-folder-dialog-heading">
                <h2 id="manager-dialog-title">{createTitle}</h2>
                <p>{createDescription}</p>
              </div>
              <button
                aria-label="关闭"
                className="create-folder-dialog-close"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                <DialogCloseIcon />
              </button>
            </div>

            <form className="create-folder-dialog-form" onSubmit={onSubmit}>
              {isCreateFolder && state.parent ? (
                <div className="create-folder-parent-pill">
                  <span>Parent</span>
                  <strong>{state.parent.path}</strong>
                </div>
              ) : null}

              <label className="create-folder-dialog-section">
                <span className="create-folder-dialog-label">{fieldLabel}</span>
                <input
                  autoFocus
                  className="create-folder-dialog-input"
                  maxLength={isCreateFolder ? 120 : 80}
                  placeholder={placeholder}
                  value={nameValue}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </label>

              {error ? <p className="manager-dialog-error create-folder-dialog-error">{error}</p> : null}

              <div className="create-folder-dialog-actions">
                <button className="create-folder-action-button is-secondary" type="button" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="create-folder-action-button is-primary" type="submit" disabled={busy}>
                  {submitLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const isDeleteDialog = state.kind === "delete-bookmark" || state.kind === "delete-bookmarks-batch" || state.kind === "delete-folder" || state.kind === "delete-tag";
  const isBookmarkDialog = state.kind === "delete-bookmark";
  const isBatchDeleteDialog = state.kind === "delete-bookmarks-batch";
  const bookmarkDeleteTarget = state.kind === "delete-bookmark" ? state.bookmark : null;
  const bookmarkDeleteFaviconSrc = bookmarkDeleteTarget
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(bookmarkDeleteTarget.domain)}&sz=64`
    : "";
  const isFolderDialog = state.kind === "edit-folder" || state.kind === "delete-folder";
  const isTagDialog = state.kind === "edit-tag" || state.kind === "delete-tag";
  const tagColor = colorValue.trim();

  let title = "";
  let description = "";
  let eyebrow = "";
  let submitLabel = "";

  if (state.kind === "edit-folder") {
    eyebrow = "Edit Folder Path";
    title = "调整收藏夹路径";
    description = "直接改完整路径，系统会自动识别父级并把它移动到正确位置。";
    submitLabel = "保存路径";
  } else if (state.kind === "delete-bookmark") {
    eyebrow = "Delete Bookmark";
    title = "删除这条书签？";
    description = "它会从归档列表中移除，关联的版本记录也会一起删除。";
    submitLabel = "删除";
  } else if (state.kind === "delete-bookmarks-batch") {
    eyebrow = "Batch Delete";
    title = `确认删除 ${state.count} 个书签？`;
    description = "所选书签将从归档列表中移除，关联的版本记录也会一起删除。此操作不可撤销。";
    submitLabel = `删除 ${state.count} 个`;
  } else if (state.kind === "delete-folder") {
    eyebrow = "Delete Folder";
    title = "确认删除这个收藏夹";
    description = "它自己会被删除，子收藏夹会上移一层，当前文件夹下的网页会解除归档。";
    submitLabel = "删除收藏夹";
  } else if (state.kind === "edit-tag") {
    eyebrow = "Edit Tag";
    title = "调整标签名称和颜色";
    description = "标签名保持简短就好，颜色可以写成 `blue`、`#1d4ed8` 这类值。";
    submitLabel = "保存标签";
  } else {
    eyebrow = "Delete Tag";
    title = "确认删除这个标签";
    description = "已经挂载到网页上的这个标签也会一起解除，但不会删除网页本身。";
    submitLabel = "删除标签";
  }

  return (
    <div
      aria-hidden="true"
      className={isBookmarkDialog ? "manager-dialog-backdrop is-bookmark-delete" : isBatchDeleteDialog ? "manager-dialog-backdrop" : "manager-dialog-backdrop"}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="manager-dialog-title"
        aria-modal="true"
        className={isBookmarkDialog ? "manager-dialog bookmark-delete-dialog" : isDeleteDialog ? "manager-dialog is-danger" : "manager-dialog"}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        {isBatchDeleteDialog ? (
          <>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="manager-dialog-title">{title}</h2>
            <p className="manager-dialog-description">{description}</p>
            {error ? <p className="manager-dialog-error">{error}</p> : null}
            <div className="manager-dialog-footer">
              <button className="manager-dialog-cancel" type="button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button className="manager-dialog-submit is-danger" type="button" onClick={onConfirmDelete} disabled={busy}>
                {busy ? "删除中..." : submitLabel}
              </button>
            </div>
          </>
        ) : isBookmarkDialog && bookmarkDeleteTarget ? (
          <>
            <div className="bookmark-delete-dialog-shell">
              <div className="bookmark-delete-dialog-header">
                <div className="bookmark-delete-dialog-heading">
                  <p className="eyebrow">{eyebrow}</p>
                  <h2 id="manager-dialog-title">{title}</h2>
                  <p>{description}</p>
                </div>
                <button
                  aria-label="关闭"
                  className="bookmark-delete-dialog-close"
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <section className="bookmark-delete-card">
                <img
                  alt=""
                  className="bookmark-delete-card-favicon"
                  src={bookmarkDeleteFaviconSrc}
                  width={28}
                  height={28}
                />
                <div className="bookmark-delete-card-body">
                  <strong>{bookmarkDeleteTarget.title}</strong>
                  <span className="bookmark-delete-card-domain">{bookmarkDeleteTarget.domain}</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，这条书签和它的归档版本会一起从列表中移除。</p>
              </div>

              {error ? <p className="manager-dialog-error bookmark-delete-dialog-error">{error}</p> : null}

              <div className="bookmark-delete-dialog-actions">
                <button className="bookmark-delete-action is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="bookmark-delete-action is-danger" type="button" onClick={onConfirmDelete} disabled={busy}>
                  {busy ? "处理中..." : submitLabel}
                </button>
              </div>
            </div>
          </>
        ) : isDeleteDialog ? (
          <>
            <div className="manager-dialog-accent" />
            <div className="manager-dialog-header">
              <div className="manager-dialog-heading">
                <p className="eyebrow">{eyebrow}</p>
                <h2 id="manager-dialog-title">{title}</h2>
                <p>{description}</p>
              </div>
              <button className="ghost-button manager-dialog-close" type="button" onClick={onClose} disabled={busy}>
                关闭
              </button>
            </div>

            <section className="manager-dialog-hero">
              <div className={isFolderDialog ? "manager-dialog-mark is-folder" : "manager-dialog-mark is-tag"}>
                {isFolderDialog ? "DIR" : "TAG"}
              </div>
              <div className="manager-dialog-hero-copy">
                <strong>
                  {state.kind === "delete-folder"
                    ? state.folder.path
                    : state.kind === "delete-tag"
                    ? `#${state.tag.name}`
                    : ""}
                </strong>
                <span>
                  {state.kind === "delete-folder"
                    ? "删除后会立即从收藏夹列表中消失。"
                    : "删除后，这个标签会从所有相关网页上解绑。"}
                </span>
              </div>
            </section>
            <div className="manager-dialog-warning">
              <strong>这个操作会立刻生效。</strong>
              <p>如果你只是想暂时不用它，建议先改名或调整路径，而不是直接删除。</p>
            </div>
            {error ? <p className="manager-dialog-error">{error}</p> : null}
            <div className="manager-dialog-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button className="primary-button danger-fill" type="button" onClick={onConfirmDelete} disabled={busy}>
                {busy ? "处理中..." : submitLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="manager-dialog-accent" />
            <div className="manager-dialog-header">
              <div className="manager-dialog-heading">
                <p className="eyebrow">{eyebrow}</p>
                <h2 id="manager-dialog-title">{title}</h2>
                <p>{description}</p>
              </div>
              <button className="ghost-button manager-dialog-close" type="button" onClick={onClose} disabled={busy}>
                关闭
              </button>
            </div>

            <form className="manager-dialog-form" onSubmit={onSubmit}>
              <section className="manager-dialog-hero">
                <div className={isFolderDialog ? "manager-dialog-mark is-folder" : "manager-dialog-mark is-tag"}>
                  {isFolderDialog ? "DIR" : "TAG"}
                </div>
                <div className="manager-dialog-hero-copy">
                  <strong>
                    {state.kind === "edit-folder"
                      ? (pathValue.trim() || state.folder.path)
                      : `#${nameValue.trim() || "新标签"}`}
                  </strong>
                  <span>
                    {state.kind === "edit-folder"
                      ? "完整路径支持多层结构，例如：工作/研究/案例。"
                      : "先预览一下最终效果，不满意可以继续改。"}
                  </span>
                </div>
              </section>

              {state.kind === "edit-folder" ? (
                <label className="field">
                  <span>完整路径</span>
                  <input
                    autoFocus
                    maxLength={240}
                    placeholder="例如：工作/研究"
                    value={pathValue}
                    onChange={(event) => onPathChange(event.target.value)}
                  />
                </label>
              ) : null}

              {state.kind === "edit-tag" ? (
                <>
                  <label className="field">
                    <span>标签名称</span>
                    <input
                      autoFocus
                      maxLength={80}
                      placeholder="例如：稍后细读"
                      value={nameValue}
                      onChange={(event) => onNameChange(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>颜色说明</span>
                    <input
                      maxLength={32}
                      placeholder="可选，例如 blue 或 #1d4ed8"
                      value={colorValue}
                      onChange={(event) => onColorChange(event.target.value)}
                    />
                  </label>
                  <div className="manager-dialog-tag-preview">
                    {tagColor ? (
                      <span
                        className="manager-dialog-tag-swatch"
                        style={{ backgroundColor: tagColor }}
                      />
                    ) : (
                      <span className="manager-dialog-tag-swatch is-empty" />
                    )}
                    <span className="manager-dialog-tag-chip">
                      #{nameValue.trim() || "新标签"}
                    </span>
                    <small>{tagColor || "未设置颜色时会沿用默认样式。"}</small>
                  </div>
                </>
              ) : null}

              {error ? <p className="manager-dialog-error">{error}</p> : null}

              <div className="manager-dialog-actions">
                <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? "处理中..." : submitLabel}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

type CloudArchiveDialogState =
  | { step: "closed" }
  | { step: "form" }
  | { step: "progress"; taskId: string; status: CloudArchiveStatus; errorMessage?: string }
  | { step: "done"; bookmarkId: string };

function cloudArchiveStatusLabel(status: CloudArchiveStatus) {
  switch (status) {
    case "queued":
      return "排队中...";
    case "fetching":
      return "正在抓取网页...";
    case "processing":
      return "处理存档...";
    case "completed":
      return "存档完成";
    case "failed":
      return "存档失败";
    default:
      return "处理中...";
  }
}

function CloudArchiveDialog({
  state,
  isUpdateMode,
  url,
  title,
  folderId,
  folders,
  tags,
  selectedTagIds,
  busy,
  error,
  onUrlChange,
  onTitleChange,
  onFolderChange,
  onTagToggle,
  onSubmit,
  onRetry,
  onClose,
  onOpenBookmark,
}: {
  state: CloudArchiveDialogState;
  isUpdateMode: boolean;
  url: string;
  title: string;
  folderId: string;
  folders: Folder[];
  tags: Tag[];
  selectedTagIds: string[];
  busy: boolean;
  error: string | null;
  onUrlChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onFolderChange: (value: string) => void;
  onTagToggle: (tagId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
  onClose: () => void;
  onOpenBookmark: (bookmarkId: string) => void;
}) {
  if (state.step === "closed") {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="manager-dialog-backdrop is-create-folder"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="cloud-archive-title"
        aria-modal="true"
        className="create-folder-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="create-folder-header">
          <h2 id="cloud-archive-title" className="create-folder-heading">
            {isUpdateMode ? "云端更新存档" : "云端存档"}
          </h2>
          <p className="create-folder-description">
            {state.step === "form"
              ? (isUpdateMode
                  ? "重新抓取当前网页并为这条书签追加新版本。"
                  : "输入网页 URL，服务端将自动抓取并生成存档。")
              : state.step === "progress"
                ? cloudArchiveStatusLabel(state.status)
                : (isUpdateMode ? "存档已更新完成。" : "存档已完成。")}
          </p>
          <button
            className="create-folder-close"
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={busy}
          >
            <DialogCloseIcon />
          </button>
        </div>

        {state.step === "form" ? (
          <form className="create-folder-body" onSubmit={onSubmit}>
            {error ? <p className="manager-dialog-error">{error}</p> : null}
            <label className="create-folder-field">
              <span className="create-folder-label">URL</span>
              <input
                className="create-folder-input"
                type="url"
                value={url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://example.com/article"
                required
                autoFocus
              />
            </label>
            <label className="create-folder-field">
              <span className="create-folder-label">标题（可选）</span>
              <input
                className="create-folder-input"
                type="text"
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="留空则自动从页面提取"
              />
            </label>
            {folders.length > 0 ? (
              <label className="create-folder-field">
                <span className="create-folder-label">文件夹</span>
                <select
                  className="create-folder-input"
                  value={folderId}
                  onChange={(event) => onFolderChange(event.target.value)}
                >
                  <option value="">不指定</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.path}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {tags.length > 0 ? (
              <div className="create-folder-field">
                <span className="create-folder-label">标签</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={selectedTagIds.includes(tag.id) ? "tag-chip is-active" : "tag-chip"}
                      onClick={() => onTagToggle(tag.id)}
                      style={{
                        padding: "2px 10px",
                        borderRadius: "12px",
                        border: selectedTagIds.includes(tag.id) ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: selectedTagIds.includes(tag.id) ? "var(--accent-bg, rgba(99,102,241,0.1))" : "transparent",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="manager-dialog-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={busy || !url.trim()}>
                {busy ? "提交中..." : isUpdateMode ? "更新存档" : "开始存档"}
              </button>
            </div>
          </form>
        ) : state.step === "progress" ? (
          <div className="create-folder-body" style={{ textAlign: "center", padding: "24px 0" }}>
            {state.status === "failed" ? (
              <>
                <p style={{ color: "var(--danger, #ef4444)", marginBottom: "8px" }}>
                  {state.errorMessage ?? "存档失败，请稍后重试。"}
                </p>
                <div className="manager-dialog-actions">
                  <button className="secondary-button" type="button" onClick={onClose}>
                    关闭
                  </button>
                  <button className="primary-button" type="button" onClick={onRetry}>
                    重试
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  width: "32px",
                  height: "32px",
                  margin: "0 auto 12px",
                  border: "3px solid var(--border)",
                  borderTopColor: "var(--accent, #6366f1)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                <p>{cloudArchiveStatusLabel(state.status)}</p>
              </>
            )}
          </div>
        ) : state.step === "done" ? (
          <div className="create-folder-body" style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ marginBottom: "16px" }}>
              {isUpdateMode ? "当前书签已成功更新存档。" : "网页已成功存档！"}
            </p>
            <div className="manager-dialog-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                关闭
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => onOpenBookmark(state.bookmarkId)}
              >
                查看书签
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextMenu({
  state,
  groups,
  onClose,
}: {
  state: Exclude<ContextMenuState, { kind: "closed" }>;
  groups: ContextMenuGroup[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => ({ left: state.x, top: state.y }));

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const currentMenu = menuRef.current;

    const { width, height } = currentMenu.getBoundingClientRect();
    setPosition(clampContextMenuPosition(state.x, state.y, width, height));
  }, [groups, state.x, state.y]);

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const currentMenu = menuRef.current;

    function handlePointerDown(event: PointerEvent) {
      if (!currentMenu.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleWindowContextMenu(event: MouseEvent) {
      if (!currentMenu.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handleViewportChange() {
      onClose();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onClose]);

  return (
    <div className="context-menu-layer">
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        aria-label={state.kind === "bookmark" ? `${state.bookmark.title} 的右键菜单` : state.kind === "folder" ? `${state.folder.name} 的右键菜单` : `${state.tag.name} 的右键菜单`}
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
        }}
      >
        {groups.map((group, groupIndex) => (
          <div key={`${state.kind}-${groupIndex}`}>
            {groupIndex > 0 ? <div className="context-menu-divider" aria-hidden="true" /> : null}
            {group.label ? <p className="context-menu-group-label">{group.label}</p> : null}
            {group.items.map((item) => (
              <button
                key={item.id}
                className={[
                  "context-menu-item",
                  item.danger ? "is-danger" : "",
                  item.disabled ? "is-disabled" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                <span className="context-menu-item-icon" aria-hidden="true">{item.icon}</span>
                <span className="context-menu-item-label">{item.label}</span>
                {item.shortcut ? <span className="context-menu-item-shortcut">{item.shortcut}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthPanel({
  isDemoMode,
  mode,
  name,
  email,
  password,
  submitting,
  error,
  onModeChange,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  isDemoMode: boolean;
  mode: AuthMode;
  name: string;
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onModeChange: (mode: AuthMode) => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isRegister = mode === "register";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{isRegister ? "创建账号" : "登录"}</h1>

        <div className="auth-switch">
          <button
            className={mode === "login" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            onClick={() => onModeChange("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            onClick={() => onModeChange("register")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {isRegister ? (
            <label className="field">
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="昵称（可选）"
              />
            </label>
          ) : null}
          <label className="field">
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder={isDemoMode ? "邮箱（演示模式可留空）" : "邮箱"}
              autoComplete="email"
              required={!isDemoMode}
            />
          </label>
          <label className="field">
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={isDemoMode ? "密码（演示模式不校验）" : isRegister ? "密码（至少 8 位）" : "密码"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required={!isDemoMode}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : isRegister ? "注册" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function DetailPanel({
  detail,
  selectedVersion,
  previewState,
  preferredPreviewMode,
  activePreviewMode,
  folders,
  tags,
  cloudArchiveUpdating,
  metadataNote,
  metadataIsFavorite,
  metadataFolderId,
  metadataTagIds,
  metadataSaving,
  metadataFeedback,
  onCloudArchiveRefresh,
  onMetadataNoteChange,
  onMetadataFavoriteChange,
  onMetadataFolderChange,
  onMetadataTagToggle,
  onPreviewModeChange,
  onMetadataSave,
}: {
  detail: BookmarkDetailResult;
  selectedVersion: BookmarkViewerVersion;
  previewState: ArchivePreviewState;
  preferredPreviewMode: ArchiveViewMode;
  activePreviewMode: ArchiveViewMode | null;
  folders: Folder[];
  tags: Tag[];
  cloudArchiveUpdating: boolean;
  metadataNote: string;
  metadataIsFavorite: boolean;
  metadataFolderId: string;
  metadataTagIds: string[];
  metadataSaving: boolean;
  metadataFeedback: InlineFeedback | null;
  onCloudArchiveRefresh: () => void;
  onMetadataNoteChange: (value: string) => void;
  onMetadataFavoriteChange: (value: boolean) => void;
  onMetadataFolderChange: (value: string) => void;
  onMetadataTagToggle: (tagId: string) => void;
  onPreviewModeChange: (mode: ArchiveViewMode) => void;
  onMetadataSave: () => void;
}) {
  const quality: QualityReport = selectedVersion.quality;
  const displayedArchiveSize = activePreviewMode === "reader"
    ? (
        selectedVersion.readerArchiveSizeBytes ??
        selectedVersion.archiveSizeBytes ??
        quality.archiveSignals.fileSize
      )
    : (selectedVersion.archiveSizeBytes ?? quality.archiveSignals.fileSize);
  const readerPreviewAvailable = Boolean(
    selectedVersion.readerHtmlObjectKey && selectedVersion.readerArchiveAvailable,
  );
  const originalPreviewAvailable = selectedVersion.archiveAvailable;
  const previewFallbackMessage = activePreviewMode && preferredPreviewMode !== activePreviewMode
    ? (
        preferredPreviewMode === "reader"
          ? "当前版本暂无阅读视图，已自动回退到原始归档。"
          : "原始归档不可用，已自动回退到阅读视图。"
      )
    : null;
  const [notesEditing, setNotesEditing] = useState(false);

  return (
    <section className="detail-shell">
      <section className="detail-preview-panel">
        {!activePreviewMode ? (
          <section className="empty-state preview-empty">
            <h2>归档对象不可用</h2>
            <p>当前版本没有可读取的归档对象。</p>
          </section>
        ) : previewState.status === "loading" ? (
          <section className="loading preview-empty">正在加载...</section>
        ) : previewState.status === "error" ? (
          <section className="empty-state preview-empty">
            <h2>加载失败</h2>
            <p>{previewState.error}</p>
          </section>
        ) : previewState.status === "ready" ? (
          <iframe
            className="archive-frame"
            src={previewState.url}
            title={`${detail.bookmark.title} v${selectedVersion.versionNo}`}
          />
        ) : null}
      </section>

      <aside className="detail-panel">
        {/* Top bar: back + preview mode */}
        <div className="detail-top-bar">
          <button className="detail-back-button" type="button" onClick={goToList}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
          <div className="preview-mode-switch preview-mode-switch--compact" role="tablist" aria-label="归档预览模式">
            <button
              className={activePreviewMode === "reader" ? "preview-mode-button is-active" : "preview-mode-button"}
              type="button"
              onClick={() => onPreviewModeChange("reader")}
              disabled={!readerPreviewAvailable}
              aria-pressed={activePreviewMode === "reader"}
            >
              阅读视图
            </button>
            <button
              className={activePreviewMode === "original" ? "preview-mode-button is-active" : "preview-mode-button"}
              type="button"
              onClick={() => onPreviewModeChange("original")}
              disabled={!originalPreviewAvailable}
              aria-pressed={activePreviewMode === "original"}
            >
              原始归档
            </button>
          </div>
        </div>
        {previewFallbackMessage ? (
          <p className="preview-mode-note">{previewFallbackMessage}</p>
        ) : null}

        {/* Header: label + ID */}
        <div className="detail-block">
          <div className="detail-header-label">
            <span className="detail-header-label-text">Detail View</span>
            <span className="detail-header-label-id">#{detail.bookmark.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="detail-title-row">
            <h2 className="detail-title">{detail.bookmark.title}</h2>
            {detail.bookmark.isFavorite ? (
              <span className="detail-favorite material-symbols-outlined" aria-hidden="true">
                star
              </span>
            ) : null}
          </div>
          <div className="detail-url-row">
            <span className="material-symbols-outlined" aria-hidden="true">link</span>
            <a href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              {detail.bookmark.sourceUrl}
            </a>
            <span className="material-symbols-outlined url-external-icon" aria-hidden="true">open_in_new</span>
          </div>
        </div>

        {/* Compact Metadata Grid */}
        <div className="detail-meta-grid">
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Collection</span>
            <select
              className="detail-meta-cell-value"
              value={metadataFolderId}
              onChange={(event) => onMetadataFolderChange(event.target.value)}
            >
              <option value="">未归档</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Added</span>
            <span className="detail-meta-cell-value">{formatWhen(detail.bookmark.createdAt)}</span>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">File Size</span>
            <span className="detail-meta-cell-value">{formatFileSize(displayedArchiveSize)}</span>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Last Sync</span>
            <span className="detail-meta-cell-value">{formatWhen(detail.bookmark.updatedAt)}</span>
          </div>
        </div>

        {/* Tags */}
        <div className="detail-tags-section">
          <span className="detail-tags-section-label">Tags</span>
          <div className="detail-tags-wrap">
            {tags.map((tag) => {
              const checked = metadataTagIds.includes(tag.id);
              return (
                <label className={checked ? "detail-tag-pill is-active" : "detail-tag-pill"} key={tag.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onMetadataTagToggle(tag.id)}
                  />
                  <span>#{tag.name}</span>
                </label>
              );
            })}
            <button className="detail-tag-add" type="button">
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
              <span>Tag</span>
            </button>
          </div>
        </div>

        {/* Version History */}
        <details className="detail-collapsible" open>
          <summary>
            <span className="detail-summary-label">
              <span className="detail-summary-icon material-symbols-outlined" aria-hidden="true">
                history
              </span>
              <span>版本历史</span>
            </span>
            <span className="badge">{detail.versions.length}</span>
          </summary>
          <div className="detail-collapsible-body">
            <div className="version-list">
              {detail.versions.map((version, index) => {
                const active = version.id === selectedVersion.id;
                const isLatest = index === 0;
                return (
                  <button
                    key={version.id}
                    className={`version-item${active ? " is-active" : ""}`}
                    type="button"
                    onClick={() => openBookmark(detail.bookmark.id, version.id)}
                  >
                    <span className="version-item-icon material-symbols-outlined" aria-hidden="true">refresh</span>
                    <div>
                      <strong>v{version.versionNo}{isLatest ? " (Latest)" : ""}</strong>
                      <span>{formatWhen(version.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
              <div className="version-item version-item--source">
                <span className="version-item-icon material-symbols-outlined" aria-hidden="true">description</span>
                <div>
                  <strong>Original Source</strong>
                  <span>{new URL(detail.bookmark.sourceUrl).hostname} {"\u2022"} {formatWhen(detail.bookmark.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </details>

        {/* Personal Notes */}
        <div className="detail-notes-section">
          <span className="detail-notes-section-label">Personal Notes</span>
          {notesEditing ? (
            <div className="detail-notes-edit">
              <textarea
                value={metadataNote}
                onChange={(event) => onMetadataNoteChange(event.target.value)}
                rows={3}
                placeholder="添加备注..."
                autoFocus
              />
              <div className="detail-notes-edit-actions">
                <button className="primary-button compact-button" type="button" onClick={() => { onMetadataSave(); setNotesEditing(false); }} disabled={metadataSaving}>
                  {metadataSaving ? "保存中..." : "保存"}
                </button>
                <button className="ghost-button compact-button" type="button" onClick={() => setNotesEditing(false)}>
                  取消
                </button>
              </div>
              {metadataFeedback ? (
                <p className={metadataFeedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
                  {metadataFeedback.message}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="detail-note-quote" role="button" tabIndex={0} onClick={() => setNotesEditing(true)} onKeyDown={(e) => { if (e.key === "Enter") setNotesEditing(true); }}>
              {metadataNote ? (
                <p>{metadataNote}</p>
              ) : (
                <p className="detail-note-quote-placeholder">点击添加备注...</p>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="detail-actions-footer">
          <button
            className="detail-action-button is-primary"
            type="button"
            onClick={onCloudArchiveRefresh}
            disabled={cloudArchiveUpdating}
          >
            <span className="material-symbols-outlined" aria-hidden="true">cloud_sync</span>
            {cloudArchiveUpdating ? "更新中..." : "云端更新"}
          </button>
          {previewState.status === "ready" && activePreviewMode ? (
            <a
              className="detail-action-button"
              href={previewState.url}
              download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}-${activePreviewMode === "reader" ? "reader" : "original"}.html`}
            >
              <span className="material-symbols-outlined" aria-hidden="true">download</span>
              Export
            </a>
          ) : (
            <span className="detail-action-button" style={{ opacity: 0.4, cursor: "not-allowed" }}>
              <span className="material-symbols-outlined" aria-hidden="true">download</span>
              Export
            </span>
          )}
          <button className="detail-action-button is-danger" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">delete</span>
            Delete
          </button>
        </div>
      </aside>
    </section>
  );
}

export function App({
  mode = "live",
}: {
  mode?: "live" | "mock";
}) {
  const isDemoMode = mode === "mock";
  const [route, setRoute] = useState<ViewRoute>(() => parseRoute(window.location.hash));
  const [demoState, setDemoState] = useState<DemoWorkspace>(() => createDemoWorkspace());
  const [session, setSession] = useState<SessionState>({
    status: "booting",
    token: null,
    user: null,
    error: null,
  });
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [bookmarkView, setBookmarkView] = useState<BookmarkListView>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [sidebarCountItems, setSidebarCountItems] = useState<Bookmark[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [preferredPreviewMode, setPreferredPreviewMode] = useState<ArchiveViewMode>("reader");
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerFeedback, setManagerFeedback] = useState<InlineFeedback | null>(null);
  const [managerDialog, setManagerDialog] = useState<ManagerDialogState>({ kind: "closed" });
  const [managerDialogName, setManagerDialogName] = useState("");
  const [managerDialogPath, setManagerDialogPath] = useState("");
  const [managerDialogColor, setManagerDialogColor] = useState("");
  const [managerDialogError, setManagerDialogError] = useState<string | null>(null);
  const [metadataNote, setMetadataNote] = useState("");
  const [metadataIsFavorite, setMetadataIsFavorite] = useState(false);
  const [metadataFolderId, setMetadataFolderId] = useState("");
  const [metadataTagIds, setMetadataTagIds] = useState<string[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataFeedback, setMetadataFeedback] = useState<InlineFeedback | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: "closed" });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [batchDropdown, setBatchDropdown] = useState<"closed" | "folder" | "tag">("closed");
  const [cloudArchiveDialog, setCloudArchiveDialog] = useState<CloudArchiveDialogState>({ step: "closed" });
  const [cloudArchiveUrl, setCloudArchiveUrl] = useState("");
  const [cloudArchiveTitle, setCloudArchiveTitle] = useState("");
  const [cloudArchiveFolderId, setCloudArchiveFolderId] = useState("");
  const [cloudArchiveTagIds, setCloudArchiveTagIds] = useState<string[]>([]);
  const [cloudArchiveTargetBookmarkId, setCloudArchiveTargetBookmarkId] = useState<string | null>(null);
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false);
  const [cloudArchiveError, setCloudArchiveError] = useState<string | null>(null);
  const cloudArchiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);
  const authToken = session.status === "authenticated" ? session.token : null;
  const logoutLabel = isDemoMode ? "重置 Mock 数据" : "退出登录";
  const isManagerDialogVisible = isManagerDialogOpen(managerDialog);
  const activeBookmarkContextId = contextMenu.kind === "bookmark" ? contextMenu.bookmark.id : null;
  const activeFolderContextId = contextMenu.kind === "folder" ? contextMenu.folder.id : null;
  const activeTagContextId = contextMenu.kind === "tag" ? contextMenu.tag.id : null;

  const importAdapter = useMemo<ImportPanelAdapter | undefined>(() => {
    if (!isDemoMode) {
      return undefined;
    }
    return {
      previewImport: async (input) => previewDemoImport(demoState, input),
      createImportTask: async (input) => {
        const result = createDemoImportTask(demoState, input);
        setDemoState(result.workspace);
        return { taskId: result.taskId };
      },
      fetchImportTasks: async () => listDemoImportTasks(demoState),
      fetchImportTaskDetail: async (taskId) => getDemoImportTaskDetail(demoState, taskId),
    };
  }, [demoState, isDemoMode]);

  function logout(message?: string) {
    if (isDemoMode) {
      const nextWorkspace = createDemoWorkspace();
      setDemoState(nextWorkspace);
      goToList();
      startTransition(() => {
        setSession({
          status: "authenticated",
          token: "demo-token",
          user: nextWorkspace.user,
          error: null,
        });
        setSearchInput("");
        setBookmarkView("all");
        setQualityFilter("all");
        setSelectedFolderId("");
        setSelectedTagId("");
        setDetail(null);
        setLoadState("idle");
        setListError(null);
        setDetailLoadState("idle");
        setDetailError(null);
        setArchivePreview({ status: "idle" });
        setManagerFeedback({
          kind: "success",
          message: "Mock 数据已重置到初始状态。",
        });
        setManagerDialog({ kind: "closed" });
        setContextMenu({ kind: "closed" });
        setManagerDialogError(null);
        setMetadataFeedback(null);
      });
      return;
    }

    clearStoredToken();
    goToList();
    startTransition(() => {
      setSession({
        status: "anonymous",
        token: null,
        user: null,
        error: message ?? null,
      });
      setItems([]);
      setSidebarCountItems([]);
      setFolders([]);
      setTags([]);
      setBookmarkView("all");
      setSelectedFolderId("");
      setSelectedTagId("");
      setDetail(null);
      setLoadState("idle");
      setListError(null);
      setDetailLoadState("idle");
      setDetailError(null);
      setArchivePreview({ status: "idle" });
      setManagerFeedback(null);
      setManagerDialog({ kind: "closed" });
      setContextMenu({ kind: "closed" });
      setManagerDialogError(null);
      setMetadataFeedback(null);
    });
  }

  function closeManagerDialog() {
    setManagerDialog({ kind: "closed" });
    setManagerDialogError(null);
  }

  function closeContextMenu() {
    setContextMenu({ kind: "closed" });
  }

  function enterSelectionMode(bookmarkId?: string) {
    setSelectionMode(true);
    setBatchDropdown("closed");
    if (bookmarkId) {
      setSelectedIds(new Set([bookmarkId]));
    } else {
      setSelectedIds(new Set());
    }
    closeContextMenu();
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBatchDropdown("closed");
  }

  function toggleSelected(bookmarkId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId);
      } else {
        next.add(bookmarkId);
      }
      return next;
    });
  }

  function selectAllBookmarks() {
    setSelectedIds(new Set(items.map((b) => b.id)));
  }

  function deselectAllBookmarks() {
    setSelectedIds(new Set());
  }

  function openCloudArchive() {
    setCloudArchiveUrl("");
    setCloudArchiveTitle("");
    setCloudArchiveFolderId("");
    setCloudArchiveTagIds([]);
    setCloudArchiveTargetBookmarkId(null);
    setCloudArchiveBusy(false);
    setCloudArchiveError(null);
    setCloudArchiveDialog({ step: "form" });
  }

  function openCloudArchiveForBookmark(bookmark: Bookmark) {
    if (cloudArchiveTimerRef.current) {
      clearInterval(cloudArchiveTimerRef.current);
      cloudArchiveTimerRef.current = null;
    }
    setCloudArchiveUrl(bookmark.sourceUrl);
    setCloudArchiveTitle(bookmark.title);
    setCloudArchiveFolderId(bookmark.folder?.id ?? "");
    setCloudArchiveTagIds(bookmark.tags.map((tag) => tag.id));
    setCloudArchiveTargetBookmarkId(bookmark.id);
    setCloudArchiveBusy(false);
    setCloudArchiveError(null);
    setCloudArchiveDialog({ step: "form" });
    closeContextMenu();
  }

  function closeCloudArchive() {
    if (cloudArchiveTimerRef.current) {
      clearInterval(cloudArchiveTimerRef.current);
      cloudArchiveTimerRef.current = null;
    }
    setCloudArchiveTargetBookmarkId(null);
    setCloudArchiveDialog({ step: "closed" });
  }

  function startCloudArchivePolling(taskId: string) {
    if (cloudArchiveTimerRef.current) {
      clearInterval(cloudArchiveTimerRef.current);
    }
    cloudArchiveTimerRef.current = setInterval(async () => {
      if (!authToken) {
        return;
      }
      try {
        const task = await fetchCloudArchiveTask(taskId, authToken);
        if (!task) {
          return;
        }
        if (task.status === "completed") {
          if (cloudArchiveTimerRef.current) {
            clearInterval(cloudArchiveTimerRef.current);
            cloudArchiveTimerRef.current = null;
          }
          setCloudArchiveDialog({
            step: "done",
            bookmarkId: task.bookmarkId ?? "",
          });
          if (authToken) {
            void refreshBookmarksList(authToken);
            void refreshSidebarCountItems(authToken);
            if (route.page === "detail" && task.bookmarkId === route.bookmarkId) {
              void refreshBookmarkDetail(authToken, route.bookmarkId);
            }
          }
        } else if (task.status === "failed") {
          if (cloudArchiveTimerRef.current) {
            clearInterval(cloudArchiveTimerRef.current);
            cloudArchiveTimerRef.current = null;
          }
          setCloudArchiveDialog({
            step: "progress",
            taskId,
            status: "failed",
            errorMessage: task.errorMessage,
          });
        } else {
          setCloudArchiveDialog({
            step: "progress",
            taskId,
            status: task.status,
          });
        }
      } catch {
        // Polling errors are silently ignored; next tick will retry.
      }
    }, 2000);
  }

  async function startCloudArchiveTask(
    input: CloudArchiveRequest,
    options?: { targetBookmarkId?: string | null },
  ) {
    if (!authToken || !input.url.trim()) {
      return;
    }
    setCloudArchiveUrl(input.url);
    setCloudArchiveTitle(input.title ?? "");
    setCloudArchiveFolderId(input.folderId ?? "");
    setCloudArchiveTagIds(input.tagIds ?? []);
    setCloudArchiveTargetBookmarkId(options?.targetBookmarkId ?? null);
    setCloudArchiveBusy(true);
    setCloudArchiveError(null);
    if (isDemoMode) {
      setCloudArchiveDialog({ step: "form" });
      setCloudArchiveError("Mock 模式暂不支持云端存档，请切换到真实 API 环境后使用。");
      setCloudArchiveBusy(false);
      return;
    }
    try {
      const result = await submitCloudArchive(input, authToken);
      setCloudArchiveDialog({
        step: "progress",
        taskId: result.taskId,
        status: result.status,
      });
      startCloudArchivePolling(result.taskId);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setCloudArchiveDialog({ step: "form" });
      setCloudArchiveError(toErrorMessage(error));
    } finally {
      setCloudArchiveBusy(false);
    }
  }

  async function handleCloudArchiveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await startCloudArchiveTask({
      url: cloudArchiveUrl.trim(),
      title: cloudArchiveTitle.trim() || undefined,
      folderId: cloudArchiveFolderId || undefined,
      tagIds: cloudArchiveTagIds.length > 0 ? cloudArchiveTagIds : undefined,
    }, {
      targetBookmarkId: cloudArchiveTargetBookmarkId,
    });
  }

  async function handleCloudArchiveRefreshCurrentBookmark() {
    if (!detail) {
      return;
    }
    await startCloudArchiveTask({
      url: detail.bookmark.sourceUrl,
    }, {
      targetBookmarkId: detail.bookmark.id,
    });
  }

  function handleCloudArchiveRetry() {
    setCloudArchiveDialog({ step: "form" });
  }

  function openManagerDialog(nextState: ManagerDialogState) {
    setManagerDialog(nextState);
    setManagerDialogError(null);
  }

  function openBookmarkContextMenu(bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "bookmark",
      bookmark,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openFolderContextMenu(folder: Folder, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "folder",
      folder,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openTagContextMenu(tag: Tag, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "tag",
      tag,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function pushHomeFeedback(kind: InlineFeedback["kind"], message: string) {
    setManagerFeedback({ kind, message });
  }

  async function handleCopySuccess(value: string, successMessage: string) {
    try {
      await copyTextToClipboard(value);
      pushHomeFeedback("success", successMessage);
    } catch (error) {
      pushHomeFeedback("error", toErrorMessage(error));
    }
  }

  function handleProtectedApiError(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      logout(error.message);
      return true;
    }
    return false;
  }

  useEffect(() => {
    closeContextMenu();
  }, [route]);

  useEffect(() => {
    if (isManagerDialogVisible) {
      closeContextMenu();
    }
  }, [isManagerDialogVisible]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "#/";
    }

    const handleHashChange = () => {
      setRoute(parseRoute(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (isDemoMode) {
      setSession({
        status: "authenticated",
        token: "demo-token",
        user: demoState.user,
        error: null,
      });
      return;
    }

    let cancelled = false;
    const storedToken = getStoredToken();
    if (!storedToken) {
      setSession({
        status: "anonymous",
        token: null,
        user: null,
        error: null,
      });
      return;
    }

    fetchCurrentUser(storedToken)
      .then((user) => {
        if (cancelled) {
          return;
        }
        setSession({
          status: "authenticated",
          token: storedToken,
          user,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        clearStoredToken();
        setSession({
          status: "anonymous",
          token: null,
          user: null,
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [demoState.user, isDemoMode]);

  useEffect(() => {
    if (!authToken) {
      setFolders([]);
      setTags([]);
      setManagerFeedback(null);
      return;
    }

    if (isDemoMode) {
      setFolders(demoState.folders);
      setTags(demoState.tags);
      setSelectedFolderId((current) => (
        current && !demoState.folders.some((folder) => folder.id === current) ? "" : current
      ));
      setSelectedTagId((current) => (
        current && !demoState.tags.some((tag) => tag.id === current) ? "" : current
      ));
      return;
    }

    let cancelled = false;
    Promise.all([fetchFolders(authToken), fetchTags(authToken)])
      .then(([nextFolders, nextTags]) => {
        if (cancelled) {
          return;
        }
        setFolders(nextFolders);
        setTags(nextTags);
        setSelectedFolderId((current) => (
          current && !nextFolders.some((folder) => folder.id === current) ? "" : current
        ));
        setSelectedTagId((current) => (
          current && !nextTags.some((tag) => tag.id === current) ? "" : current
        ));
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, demoState.folders, demoState.tags, isDemoMode]);

  useEffect(() => {
    if (!authToken) {
      setSidebarCountItems([]);
      return;
    }

    if (isDemoMode) {
      setSidebarCountItems(demoState.bookmarks);
      return;
    }

    let cancelled = false;
    loadSidebarCountItems(authToken)
      .then((nextItems) => {
        if (cancelled) {
          return;
        }
        setSidebarCountItems(nextItems);
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, demoState.bookmarks, isDemoMode, route.page]);

  useEffect(() => {
    if (!authToken) {
      setItems([]);
      setLoadState("idle");
      setListError(null);
      return;
    }

    if (isDemoMode) {
      setLoadState("loading");
      setListError(null);
      startTransition(() => {
        setItems(filterDemoBookmarks(demoState, {
          search: deferredSearch,
          quality: qualityFilter,
          view: bookmarkView,
          folderId: selectedFolderId || undefined,
          tagId: selectedTagId || undefined,
        }));
        setLoadState("ready");
      });
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    setListError(null);

    fetchBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        folderId: selectedFolderId || undefined,
        tagId: selectedTagId || undefined,
      },
      authToken,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setItems(result.items);
          setLoadState("ready");
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setLoadState("error");
          setListError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, bookmarkView, deferredSearch, demoState, isDemoMode, qualityFilter, selectedFolderId, selectedTagId]);

  useEffect(() => {
    if (!authToken || route.page !== "detail") {
      setDetailLoadState("idle");
      setDetailError(null);
      setDetail(null);
      return;
    }

    if (isDemoMode) {
      setDetailLoadState("loading");
      setDetailError(null);
      startTransition(() => {
        const result = getDemoBookmarkDetail(demoState, route.bookmarkId);
        setDetail(result);
        setDetailLoadState(result ? "ready" : "not-found");
      });
      return;
    }

    let cancelled = false;
    setDetailLoadState("loading");
    setDetailError(null);

    fetchBookmarkDetail(route.bookmarkId, authToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setDetail(result);
          setDetailLoadState(result ? "ready" : "not-found");
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        startTransition(() => {
          setDetail(null);
          setDetailLoadState("error");
          setDetailError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, demoState, isDemoMode, route]);

  useEffect(() => {
    if (!detail) {
      setMetadataNote("");
      setMetadataIsFavorite(false);
      setMetadataFolderId("");
      setMetadataTagIds([]);
      setMetadataFeedback(null);
      return;
    }
    setMetadataNote(detail.bookmark.note);
    setMetadataIsFavorite(detail.bookmark.isFavorite);
    setMetadataFolderId(detail.bookmark.folder?.id ?? "");
    setMetadataTagIds(detail.bookmark.tags.map((tag) => tag.id));
    setMetadataFeedback(null);
  }, [detail]);

  useEffect(() => {
    setManagerDialogError(null);
    if (managerDialog.kind === "create-folder") {
      setManagerDialogName("");
      setManagerDialogPath("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-folder") {
      setManagerDialogName("");
      setManagerDialogPath(managerDialog.folder.path);
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "create-tag") {
      setManagerDialogName("");
      setManagerDialogPath("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-tag") {
      setManagerDialogName(managerDialog.tag.name);
      setManagerDialogPath("");
      setManagerDialogColor(managerDialog.tag.color ?? "");
      return;
    }
    setManagerDialogName("");
    setManagerDialogPath("");
    setManagerDialogColor("");
  }, [managerDialog]);

  useEffect(() => {
    if (!isManagerDialogVisible) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !managerBusy) {
        closeManagerDialog();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isManagerDialogVisible, managerBusy]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const handleSelectionKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !selectionBusy) {
        exitSelectionMode();
      }
    };
    window.addEventListener("keydown", handleSelectionKeyDown);
    return () => {
      window.removeEventListener("keydown", handleSelectionKeyDown);
    };
  }, [selectionMode, selectionBusy]);

  const selectedVersion = useMemo(() => {
    if (!detail || route.page !== "detail") {
      return null;
    }

    return (
      detail.versions.find((version) => version.id === route.versionId) ??
      detail.versions.find((version) => version.id === detail.bookmark.latestVersionId) ??
      detail.versions[0] ??
      null
    );
  }, [detail, route]);

  const previewSourceUrl = detail
    ? (detail.bookmark.canonicalUrl ?? detail.bookmark.sourceUrl)
    : null;
  const previewSelection = useMemo(
    () => resolvePreviewSelection(selectedVersion, preferredPreviewMode),
    [preferredPreviewMode, selectedVersion],
  );

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !previewSelection?.objectKey || !previewSourceUrl) {
      setArchivePreview({ status: "idle" });
      return;
    }

    setArchivePreview({ status: "loading" });

    if (isDemoMode) {
      if (!selectedVersion) {
        setArchivePreview({ status: "idle" });
        return;
      }
      const html = getDemoArchiveHtml(demoState, selectedVersion.id);
      if (!html) {
        setArchivePreview({
          status: "error",
          error: "未找到本地 Mock 归档内容。",
        });
        return;
      }
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      revokedUrl = url;
      setArchivePreview({
        status: "ready",
        url,
      });
      return () => {
        cancelled = true;
        if (revokedUrl) {
          URL.revokeObjectURL(revokedUrl);
        }
      };
    }

    createArchiveObjectUrl(
      authToken,
      previewSelection.objectKey,
      previewSourceUrl,
    )
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokedUrl = url;
        setArchivePreview({
          status: "ready",
          url,
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          previewSelection?.mode === "reader" &&
          selectedVersion?.archiveAvailable
        ) {
          setPreferredPreviewMode("original");
          return;
        }
        setArchivePreview({
          status: "error",
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [
    authToken,
    demoState,
    isDemoMode,
    previewSelection?.objectKey,
    previewSelection?.mode,
    previewSourceUrl,
    selectedVersion?.id,
  ]);

  async function loadSidebarCountItems(currentToken: string) {
    const nextItems: Bookmark[] = [];
    let offset = 0;
    let total = 0;

    do {
      const result = await fetchBookmarks(
        {
          search: "",
          quality: "all",
          view: "all",
          limit: SIDEBAR_COUNT_PAGE_SIZE,
          offset,
        },
        currentToken,
      );
      nextItems.push(...result.items);
      total = result.total;
      offset += result.items.length;
      if (result.items.length === 0) {
        break;
      }
    } while (nextItems.length < total);

    return nextItems;
  }

  async function refreshSidebarCountItems(currentToken: string) {
    const nextItems = await loadSidebarCountItems(currentToken);
    setSidebarCountItems(nextItems);
  }

  async function refreshCatalogs(currentToken: string) {
    const [nextFolders, nextTags] = await Promise.all([
      fetchFolders(currentToken),
      fetchTags(currentToken),
    ]);
    setFolders(nextFolders);
    setTags(nextTags);
    setSelectedFolderId((current) => (
      current && !nextFolders.some((folder) => folder.id === current) ? "" : current
    ));
    setSelectedTagId((current) => (
      current && !nextTags.some((tag) => tag.id === current) ? "" : current
    ));
  }

  async function refreshBookmarksList(currentToken: string) {
    const result = await fetchBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        folderId: selectedFolderId || undefined,
        tagId: selectedTagId || undefined,
      },
      currentToken,
    );
    setListError(null);
    setItems(result.items);
    setLoadState("ready");
  }

  async function refreshBookmarkDetail(currentToken: string, bookmarkId: string) {
    const result = await fetchBookmarkDetail(bookmarkId, currentToken);
    setDetailError(null);
    setDetail(result);
    setDetailLoadState(result ? "ready" : "not-found");
  }

  async function runManagerAction(action: () => Promise<string>) {
    if (!authToken) {
      throw new Error("当前未登录，暂时无法执行这个操作。");
    }
    setManagerBusy(true);
    setManagerFeedback(null);
    try {
      const message = await action();
      await refreshCatalogs(authToken);
      await refreshSidebarCountItems(authToken);
      await refreshBookmarksList(authToken);
      if (route.page === "detail") {
        await refreshBookmarkDetail(authToken, route.bookmarkId);
      }
      setManagerFeedback({
        kind: "success",
        message,
      });
    } catch (error) {
      if (handleProtectedApiError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      setManagerFeedback({
        kind: "error",
        message,
      });
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setManagerBusy(false);
    }
  }

  async function handleDeleteBookmark(bookmark: Bookmark) {
    if (isDemoMode) {
      try {
        setDemoState(deleteDemoBookmark(demoState, bookmark.id));
        if (route.page === "detail" && route.bookmarkId === bookmark.id) {
          goToList();
        }
        setManagerFeedback({
          kind: "success",
          message: `已删除书签：${bookmark.title}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      await deleteBookmark(bookmark.id, authToken!);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) {
        goToList();
      }
      return `已删除书签：${bookmark.title}`;
    });
  }

  async function handleBatchDelete(ids: Set<string>) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        let workspace = demoState;
        for (const id of ids) {
          workspace = deleteDemoBookmark(workspace, id);
        }
        setDemoState(workspace);
      } else {
        const results = await Promise.allSettled(
          [...ids].map((id) => deleteBookmark(id, authToken!)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          setManagerFeedback({
            kind: "error",
            message: `批量删除完成，但有 ${failed} 条失败。`,
          });
          await refreshSidebarCountItems(authToken!);
          await refreshBookmarksList(authToken!);
          exitSelectionMode();
          return;
        }
        await refreshSidebarCountItems(authToken!);
        await refreshBookmarksList(authToken!);
      }
      setManagerFeedback({
        kind: "success",
        message: `已删除 ${ids.size} 个书签。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchToggleFavorite(ids: Set<string>, isFavorite: boolean) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        let workspace = demoState;
        for (const id of ids) {
          const result = updateDemoBookmarkMetadata(workspace, id, { isFavorite });
          workspace = result.workspace;
        }
        setDemoState(workspace);
      } else {
        await Promise.allSettled(
          [...ids].map((id) => updateBookmarkMetadata(id, { isFavorite }, authToken!)),
        );
        await refreshSidebarCountItems(authToken!);
        await refreshBookmarksList(authToken!);
      }
      setManagerFeedback({
        kind: "success",
        message: isFavorite
          ? `已将 ${ids.size} 个书签加入收藏。`
          : `已取消 ${ids.size} 个书签的收藏。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchLocalArchive(ids: Set<string>) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        setManagerFeedback({
          kind: "error",
          message: "Mock 模式暂不支持本地插件批量存档。",
        });
        return;
      }
      if (!authToken) {
        throw new Error("当前未登录，无法发送本地存档任务。");
      }

      const selectedBookmarks = items.filter((bookmark) => ids.has(bookmark.id));
      const result = await enqueueBookmarksToLocalExtension(selectedBookmarks);
      const parts = [] as string[];
      if (result.acceptedCount > 0) {
        parts.push(`已把 ${result.acceptedCount} 条书签加入本地插件队列`);
      }
      if (result.skippedCount > 0) {
        parts.push(`跳过 ${result.skippedCount} 条已在队列中的任务`);
      }
      if (parts.length === 0) {
        parts.push("所选书签都已在本地插件队列中");
      }
      if (result.queueSize > 0) {
        parts.push(`当前队列剩余 ${result.queueSize} 条待处理`);
      }

      setManagerFeedback({
        kind: "success",
        message: `${parts.join("，")}。`,
      });
      exitSelectionMode();
    } catch (error) {
      setManagerFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchMoveTo(ids: Set<string>, folderId: string | null) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        let workspace = demoState;
        for (const id of ids) {
          const result = updateDemoBookmarkMetadata(workspace, id, { folderId });
          workspace = result.workspace;
        }
        setDemoState(workspace);
      } else {
        await Promise.allSettled(
          [...ids].map((id) => updateBookmarkMetadata(id, { folderId }, authToken!)),
        );
        await refreshSidebarCountItems(authToken!);
        await refreshBookmarksList(authToken!);
      }
      const folderName = folderId
        ? (folders.find((f) => f.id === folderId)?.name ?? "指定收藏夹")
        : "未归类";
      setManagerFeedback({
        kind: "success",
        message: `已将 ${ids.size} 个书签移动到「${folderName}」。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchSetTags(ids: Set<string>, tagIds: string[]) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        let workspace = demoState;
        for (const id of ids) {
          const result = updateDemoBookmarkMetadata(workspace, id, { tagIds });
          workspace = result.workspace;
        }
        setDemoState(workspace);
      } else {
        await Promise.allSettled(
          [...ids].map((id) => updateBookmarkMetadata(id, { tagIds }, authToken!)),
        );
        await refreshSidebarCountItems(authToken!);
        await refreshBookmarksList(authToken!);
      }
      const tagName = tags.find((t) => t.id === tagIds[0])?.name ?? "标签";
      setManagerFeedback({
        kind: "success",
        message: `已为 ${ids.size} 个书签设置标签「${tagName}」。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleCreateFolder(name: string, parent?: Folder) {
    const trimmedName = name.trim();
    if (isDemoMode) {
      try {
        const result = createDemoFolder(demoState, {
          name: trimmedName,
          parentId: parent?.id ?? null,
        });
        setDemoState(result.workspace);
        setManagerFeedback({
          kind: "success",
          message: `已创建收藏夹：${result.folder.path}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      const folder = await createFolder({
        name: trimmedName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已创建收藏夹：${folder.path}`;
    });
  }

  async function handleEditFolderPath(folder: Folder, nextPathInput: string) {
    const nextPath = nextPathInput
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const nextName = nextPath[nextPath.length - 1] ?? folder.name;
    const parentPath = nextPath.slice(0, -1).join("/");
    const parent = parentPath ? folders.find((item) => item.path === parentPath) : undefined;
    if (parentPath && !parent) {
      throw new Error(`未找到父收藏夹路径：${parentPath}`);
    }

    if (isDemoMode) {
      try {
        const result = updateDemoFolder(demoState, folder.id, {
          name: nextName,
          parentId: parent?.id ?? null,
        });
        setDemoState(result.workspace);
        setManagerFeedback({
          kind: "success",
          message: `已更新收藏夹路径：${result.folder.path}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      const updated = await updateFolder(folder.id, {
        name: nextName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已更新收藏夹路径：${updated.path}`;
    });
  }

  async function handleDeleteFolder(folder: Folder) {
    if (isDemoMode) {
      try {
        setDemoState(deleteDemoFolder(demoState, folder.id));
        setManagerFeedback({
          kind: "success",
          message: `已删除收藏夹：${folder.path}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      await deleteFolder(folder.id, authToken!);
      return `已删除收藏夹：${folder.path}`;
    });
  }

  async function handleCreateTag(name: string, color?: string) {
    const trimmedName = name.trim();
    if (isDemoMode) {
      try {
        const result = createDemoTag(demoState, {
          name: trimmedName,
          color,
        });
        setDemoState(result.workspace);
        setManagerFeedback({
          kind: "success",
          message: `已创建标签：#${result.tag.name}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      const tag = await createTag({
        name: trimmedName,
        color,
      }, authToken!);
      return `已创建标签：#${tag.name}`;
    });
  }

  async function handleEditTag(tag: Tag, nextName: string, nextColorRaw: string) {
    if (isDemoMode) {
      try {
        const result = updateDemoTag(demoState, tag.id, {
          name: nextName.trim(),
          color: nextColorRaw.trim() || null,
        });
        setDemoState(result.workspace);
        setManagerFeedback({
          kind: "success",
          message: `已更新标签：#${result.tag.name}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      const updated = await updateTag(tag.id, {
        name: nextName.trim(),
        color: nextColorRaw.trim() || null,
      }, authToken!);
      return `已更新标签：#${updated.name}`;
    });
  }

  async function handleDeleteTag(tag: Tag) {
    if (isDemoMode) {
      try {
        setDemoState(deleteDemoTag(demoState, tag.id));
        setManagerFeedback({
          kind: "success",
          message: `已删除标签：#${tag.name}`,
        });
      } catch (error) {
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
        throw error;
      }
      return;
    }

    await runManagerAction(async () => {
      await deleteTag(tag.id, authToken!);
      return `已删除标签：#${tag.name}`;
    });
  }

  async function handleManagerDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManagerDialogError(null);

    try {
      if (managerDialog.kind === "create-folder") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("收藏夹名称不能为空。");
          return;
        }
        if (trimmedName.includes("/")) {
          setManagerDialogError("收藏夹名称里不能包含 / 。");
          return;
        }
        await handleCreateFolder(trimmedName, managerDialog.parent);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "edit-folder") {
        const trimmedPath = managerDialogPath.trim();
        if (!trimmedPath) {
          setManagerDialogError("完整路径不能为空。");
          return;
        }
        if (trimmedPath.split("/").map((segment) => segment.trim()).filter(Boolean).length === 0) {
          setManagerDialogError("请输入至少一层有效路径。");
          return;
        }
        await handleEditFolderPath(managerDialog.folder, trimmedPath);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "create-tag") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("标签名称不能为空。");
          return;
        }
        await handleCreateTag(trimmedName, managerDialogColor.trim() || undefined);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "edit-tag") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("标签名称不能为空。");
          return;
        }
        await handleEditTag(managerDialog.tag, trimmedName, managerDialogColor);
        closeManagerDialog();
      }
    } catch (error) {
      setManagerDialogError(toErrorMessage(error));
    }
  }

  async function handleManagerDialogDelete() {
    setManagerDialogError(null);
    try {
      if (managerDialog.kind === "delete-bookmark") {
        await handleDeleteBookmark(managerDialog.bookmark);
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-bookmarks-batch") {
        await handleBatchDelete(new Set(managerDialog.bookmarkIds));
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-folder") {
        await handleDeleteFolder(managerDialog.folder);
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-tag") {
        await handleDeleteTag(managerDialog.tag);
        closeManagerDialog();
      }
    } catch (error) {
      setManagerDialogError(toErrorMessage(error));
    }
  }

  async function handleSaveMetadata() {
    if (!authToken || route.page !== "detail") {
      return;
    }

    setMetadataSaving(true);
    setMetadataFeedback(null);
    if (isDemoMode) {
      try {
        const result = updateDemoBookmarkMetadata(demoState, route.bookmarkId, {
          note: metadataNote,
          isFavorite: metadataIsFavorite,
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        });
        setDemoState(result.workspace);
        setMetadataFeedback({
          kind: "success",
          message: "Mock 数据中的收藏状态、收藏夹、标签和备注已更新。",
        });
      } catch (error) {
        setMetadataFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
      } finally {
        setMetadataSaving(false);
      }
      return;
    }

    try {
      const updated = await updateBookmarkMetadata(
        route.bookmarkId,
        {
          note: metadataNote,
          isFavorite: metadataIsFavorite,
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        },
        authToken,
      );
      await refreshSidebarCountItems(authToken);
      await refreshBookmarksList(authToken);
      await refreshBookmarkDetail(authToken, updated.id);
      setMetadataFeedback({
        kind: "success",
        message: "书签的收藏状态、收藏夹、标签和备注已经保存。",
      });
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setMetadataFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setMetadataSaving(false);
    }
  }

  async function handleToggleFavorite(bookmark: Bookmark, isFavorite: boolean) {
    if (!authToken) {
      return;
    }

    setManagerBusy(true);
    setManagerFeedback(null);
    try {
      if (isDemoMode) {
        const result = updateDemoBookmarkMetadata(demoState, bookmark.id, { isFavorite });
        setDemoState(result.workspace);
      } else {
        await updateBookmarkMetadata(bookmark.id, { isFavorite }, authToken);
        await refreshSidebarCountItems(authToken);
        await refreshBookmarksList(authToken);
        if (route.page === "detail" && route.bookmarkId === bookmark.id) {
          await refreshBookmarkDetail(authToken, bookmark.id);
        }
      }

      setManagerFeedback({
        kind: "success",
        message: isFavorite ? "已加入收藏。" : "已取消收藏。",
      });
      closeContextMenu();
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setManagerFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setManagerBusy(false);
    }
  }

  const contextMenuGroups = useMemo<ContextMenuGroup[]>(() => {
    if (contextMenu.kind === "closed") {
      return [];
    }

    if (contextMenu.kind === "bookmark") {
      const bookmark = contextMenu.bookmark;
      const cloudArchiveInFlight = cloudArchiveTargetBookmarkId === bookmark.id
        && (cloudArchiveBusy || cloudArchiveDialog.step === "progress");
      const detailHash = buildDetailHash(bookmark.id);
      const detailUrl = buildAppUrl(detailHash);
      return [
        {
          label: "书签",
          items: [
            {
              id: "open-archive",
              label: "打开归档",
              icon: "AR",
              shortcut: "Enter",
              onSelect: () => openBookmark(bookmark.id),
            },
            {
              id: "open-archive-new-tab",
              label: "新标签打开归档",
              icon: "NT",
              onSelect: () => {
                window.open(detailUrl, "_blank", "noopener,noreferrer");
              },
            },
            {
              id: "open-original",
              label: "打开原网页",
              icon: "GO",
              onSelect: () => {
                window.open(bookmark.sourceUrl, "_blank", "noopener,noreferrer");
              },
            },
          ],
        },
        {
          label: "快速操作",
          items: [
            {
              id: "toggle-favorite",
              label: bookmark.isFavorite ? "取消收藏" : "加入收藏",
              icon: "FV",
              disabled: managerBusy,
              onSelect: () => void handleToggleFavorite(bookmark, !bookmark.isFavorite),
            },
            {
              id: "copy-original-link",
              label: "复制原链接",
              icon: "CP",
              onSelect: () => void handleCopySuccess(bookmark.sourceUrl, "已复制原网页链接。"),
            },
            {
              id: "copy-archive-link",
              label: "复制归档链接",
              icon: "LK",
              onSelect: () => void handleCopySuccess(detailUrl, "已复制归档详情链接。"),
            },
            {
              id: "edit-metadata",
              label: "前往详情编辑",
              icon: "ED",
              onSelect: () => openBookmark(bookmark.id),
            },
            {
              id: "cloud-archive-bookmark",
              label: bookmark.versionCount > 0 ? "云端更新存档" : "云端存档",
              icon: "CA",
              disabled: cloudArchiveInFlight,
              onSelect: () => openCloudArchiveForBookmark(bookmark),
            },
            {
              id: "delete-bookmark",
              label: "删除书签",
              icon: "DL",
              danger: true,
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "delete-bookmark", bookmark }),
            },
          ],
        },
        {
          items: [
            {
              id: "select-bookmark",
              label: "选择",
              icon: "SL",
              onSelect: () => enterSelectionMode(bookmark.id),
            },
          ],
        },
      ];
    }

    if (contextMenu.kind === "tag") {
      const tag = contextMenu.tag;
      return [
        {
          label: "标签",
          items: [
            {
              id: "filter-tag",
              label: selectedTagId === tag.id ? "取消筛选" : "筛选这个标签",
              icon: "FL",
              onSelect: () => {
                setBookmarkView("all");
                setSelectedFolderId("");
                setSelectedTagId((current) => current === tag.id ? "" : tag.id);
              },
            },
            {
              id: "rename-tag",
              label: "重命名标签",
              icon: "RN",
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "edit-tag", tag }),
            },
          ],
        },
        {
          items: [
            {
              id: "delete-tag",
              label: "删除标签",
              icon: "DL",
              danger: true,
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "delete-tag", tag }),
            },
          ],
        },
      ];
    }

    const folder = contextMenu.folder;
    return [
      {
        label: "收藏夹",
        items: [
          {
            id: "filter-folder",
            label: selectedFolderId === folder.id ? "取消筛选" : "筛选这个收藏夹",
            icon: "FL",
            onSelect: () => {
              setBookmarkView("all");
              setSelectedTagId("");
              setSelectedFolderId((current) => current === folder.id ? "" : folder.id);
            },
          },
          {
            id: "create-child-folder",
            label: "新建子收藏夹",
            icon: "NW",
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "create-folder", parent: folder }),
          },
          {
            id: "rename-folder",
            label: "重命名收藏夹",
            icon: "RN",
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "edit-folder", folder }),
          },
        ],
      },
      {
        items: [
          {
            id: "delete-folder",
            label: "删除收藏夹",
            icon: "DL",
            danger: true,
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "delete-folder", folder }),
          },
        ],
      },
    ];
  }, [
    cloudArchiveBusy,
    cloudArchiveDialog.step,
    cloudArchiveTargetBookmarkId,
    contextMenu,
    managerBusy,
    selectedFolderId,
    selectedTagId,
  ]);

  const detailCloudArchiveUpdating = Boolean(
    detail
      && cloudArchiveTargetBookmarkId === detail.bookmark.id
      && (cloudArchiveBusy || cloudArchiveDialog.step === "progress"),
  );

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      if (isDemoMode) {
        setStoredToken("demo-token");
        setSession({
          status: "authenticated",
          token: "demo-token",
          user: demoState.user,
          error: null,
        });
        setAuthPassword("");
        goToList();
        return;
      }

      const sessionResult = authMode === "register"
        ? await registerAccount({
            name: authName.trim() || undefined,
            email: authEmail.trim(),
            password: authPassword,
          })
        : await loginAccount({
            email: authEmail.trim(),
            password: authPassword,
          });

      setStoredToken(sessionResult.token);
      setSession({
        status: "authenticated",
        token: sessionResult.token,
        user: sessionResult.user,
        error: null,
      });
      setAuthPassword("");
      goToList();
    } catch (error) {
      clearStoredToken();
      setAuthError(toErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  if (session.status !== "authenticated") {
    return session.status === "booting" ? (
      <main className="auth-shell">
        <section className="loading auth-loading">正在恢复登录状态...</section>
      </main>
    ) : (
      <AuthPanel
        isDemoMode={isDemoMode}
        mode={authMode}
        name={authName}
        email={authEmail}
        password={authPassword}
        submitting={authSubmitting}
        error={authError ?? session.error}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
        }}
        onNameChange={setAuthName}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <>
      <AppShell
        user={session.user}
        items={items}
        countItems={sidebarCountItems}
        folders={folders}
        tags={tags}
        routePage={route.page}
        bookmarkView={bookmarkView}
        selectedFolderId={selectedFolderId}
        selectedTagId={selectedTagId}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        managerBusy={managerBusy}
        onSelectBookmarkView={setBookmarkView}
        onSelectFolder={setSelectedFolderId}
        onSelectTag={setSelectedTagId}
        onGoHome={goToList}
        onCreateRootFolder={() => openManagerDialog({ kind: "create-folder" })}
        onCreateTag={() => openManagerDialog({ kind: "create-tag" })}
        onOpenApiTokens={goToApiTokens}
        onOpenImportNew={goToImportNew}
        onOpenImportHistory={goToImportList}
        onOpenCloudArchive={openCloudArchive}
        onLogout={() => logout()}
        contextMenuFolderId={activeFolderContextId}
        onFolderContextMenu={openFolderContextMenu}
        contextMenuTagId={activeTagContextId}
        onTagContextMenu={openTagContextMenu}
        logoutLabel={logoutLabel}
      >
        {route.page === "list" ? (
          <>
            {selectionMode ? (
              <SelectionToolbar
                selectedCount={selectedIds.size}
                totalCount={items.length}
                busy={selectionBusy}
                folders={folders}
                tags={tags}
                batchDropdown={batchDropdown}
                onBatchDropdownChange={setBatchDropdown}
                onSelectAll={selectAllBookmarks}
                onDeselectAll={deselectAllBookmarks}
                onBatchFavorite={(fav) => void handleBatchToggleFavorite(selectedIds, fav)}
                onBatchLocalArchive={() => void handleBatchLocalArchive(selectedIds)}
                onBatchMoveTo={(folderId) => void handleBatchMoveTo(selectedIds, folderId)}
                onBatchSetTags={(tagIds) => void handleBatchSetTags(selectedIds, tagIds)}
                onBatchDelete={() => openManagerDialog({ kind: "delete-bookmarks-batch", bookmarkIds: [...selectedIds], count: selectedIds.size })}
                onExit={exitSelectionMode}
              />
            ) : null}
            <HomePage
              items={items}
              bookmarkView={bookmarkView}
              loadState={loadState}
              listError={listError}
              hasActiveFilters={Boolean(
                searchInput.trim()
                || bookmarkView !== "all"
                || qualityFilter !== "all"
                || selectedFolderId
                || selectedTagId,
              )}
              managerFeedback={managerFeedback}
              onOpenBookmark={openBookmark}
              contextMenuBookmarkId={activeBookmarkContextId}
              onBookmarkContextMenu={openBookmarkContextMenu}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
            />
          </>
        ) : route.page === "detail" && (detailLoadState === "loading" || isPending) ? (
        <section className="loading">正在加载归档详情...</section>
      ) : route.page === "detail" && detailLoadState === "error" ? (
        <EmptyState
          mode="missing-detail"
          title="归档详情加载失败"
          description={detailError ?? "暂时无法读取这条归档。"}
          action={
            <button className="primary-button" type="button" onClick={goToList}>
              返回列表
            </button>
          }
        />
      ) : route.page === "detail" && (detailLoadState === "not-found" || !detail) ? (
        <EmptyState
          mode="missing-detail"
          action={
            <button className="primary-button" type="button" onClick={goToList}>
              返回列表
            </button>
          }
        />
      ) : route.page === "detail" && !selectedVersion ? (
        <EmptyState
          mode="missing-detail"
          title="该书签尚未生成归档版本"
          description="这是轻导入生成的书签元数据，暂时没有 archive.html 版本可预览。"
          action={
            <a className="primary-button" href={detail?.bookmark.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
              打开原网页
            </a>
          }
        />
      ) : route.page === "detail" ? (
        <DetailPanel
          detail={detail!}
          selectedVersion={selectedVersion!}
          previewState={archivePreview}
          preferredPreviewMode={preferredPreviewMode}
          activePreviewMode={previewSelection?.mode ?? null}
          folders={folders}
          tags={tags}
          cloudArchiveUpdating={detailCloudArchiveUpdating}
          metadataNote={metadataNote}
          metadataIsFavorite={metadataIsFavorite}
          metadataFolderId={metadataFolderId}
          metadataTagIds={metadataTagIds}
          metadataSaving={metadataSaving}
          metadataFeedback={metadataFeedback}
          onCloudArchiveRefresh={() => void handleCloudArchiveRefreshCurrentBookmark()}
          onMetadataNoteChange={setMetadataNote}
          onMetadataFavoriteChange={setMetadataIsFavorite}
          onMetadataFolderChange={setMetadataFolderId}
          onMetadataTagToggle={(tagId) => {
            setMetadataTagIds((current) => (
              current.includes(tagId)
                ? current.filter((item) => item !== tagId)
                : [...current, tagId]
            ));
          }}
          onPreviewModeChange={setPreferredPreviewMode}
          onMetadataSave={() => void handleSaveMetadata()}
        />
      ) : route.page === "imports-new" ? (
        <ImportNewPanel
          token={session.token}
          onApiError={handleProtectedApiError}
          adapter={importAdapter}
          onOpenHistory={goToImportList}
          onOpenTask={openImportTask}
        />
      ) : route.page === "imports-list" ? (
        <ImportHistoryPanel
          token={session.token}
          onApiError={handleProtectedApiError}
          adapter={importAdapter}
          onOpenTask={openImportTask}
          onOpenNew={goToImportNew}
        />
      ) : route.page === "imports-detail" ? (
        <ImportDetailPanel
          token={session.token}
          taskId={route.taskId}
          onApiError={handleProtectedApiError}
          adapter={importAdapter}
          onOpenHistory={goToImportList}
          onOpenBookmark={(bookmarkId) => openBookmark(bookmarkId)}
        />
      ) : route.page === "settings-api-tokens" ? (
        <ApiTokensPanel
          token={session.token}
          userId={session.user.id}
          isDemoMode={isDemoMode}
          onApiError={handleProtectedApiError}
          onBack={goToList}
        />
      ) : null}
      </AppShell>
      <ManagerDialog
        state={managerDialog}
        busy={managerBusy}
        error={managerDialogError}
        nameValue={managerDialogName}
        pathValue={managerDialogPath}
        colorValue={managerDialogColor}
        onClose={closeManagerDialog}
        onSubmit={(event) => void handleManagerDialogSubmit(event)}
        onConfirmDelete={() => void handleManagerDialogDelete()}
        onNameChange={setManagerDialogName}
        onPathChange={setManagerDialogPath}
        onColorChange={setManagerDialogColor}
      />
      <CloudArchiveDialog
        state={cloudArchiveDialog}
        isUpdateMode={Boolean(cloudArchiveTargetBookmarkId)}
        url={cloudArchiveUrl}
        title={cloudArchiveTitle}
        folderId={cloudArchiveFolderId}
        folders={folders}
        tags={tags}
        selectedTagIds={cloudArchiveTagIds}
        busy={cloudArchiveBusy}
        error={cloudArchiveError}
        onUrlChange={setCloudArchiveUrl}
        onTitleChange={setCloudArchiveTitle}
        onFolderChange={setCloudArchiveFolderId}
        onTagToggle={(tagId) => {
          setCloudArchiveTagIds((current) => (
            current.includes(tagId)
              ? current.filter((item) => item !== tagId)
              : [...current, tagId]
          ));
        }}
        onSubmit={(event) => void handleCloudArchiveSubmit(event)}
        onRetry={handleCloudArchiveRetry}
        onClose={closeCloudArchive}
        onOpenBookmark={(bookmarkId) => {
          closeCloudArchive();
          openBookmark(bookmarkId);
        }}
      />
      {contextMenu.kind !== "closed" ? (
        <ContextMenu state={contextMenu} groups={contextMenuGroups} onClose={closeContextMenu} />
      ) : null}
    </>
  );
}
