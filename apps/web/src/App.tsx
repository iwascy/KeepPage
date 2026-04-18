import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
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
  Folder,
  PrivateVaultSummary,
  QualityGrade,
  QualityReport,
  Tag,
} from "@keeppage/domain";
import {
  ApiError,
  type BookmarkDetailResult,
  type BookmarkViewerVersion,
} from "./api";
import {
  ImportDetailPanel,
  ImportHistoryPanel,
  ImportNewPanel,
  type ImportPanelAdapter,
} from "./features/imports";
import { BookmarkDetailRoute } from "./features/bookmarks/detail";
import { BookmarksListRoute } from "./features/bookmarks/list";
import { buildBookmarkSiteIconCandidates } from "./features/bookmarks/shared/site-icon";
import { type AppDataSource, useAppDataSource } from "./data-sources/use-app-data-source";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready" | "error";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type AuthMode = "login" | "register";
type ArchiveViewMode = "reader" | "original";
type ViewRoute =
  | { page: "list" }
  | { page: "detail"; bookmarkId: string; versionId?: string }
  | { page: "private-mode" }
  | { page: "private-detail"; bookmarkId: string; versionId?: string }
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
const BOOKMARKS_PAGE_SIZE = 24;

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
  if (path === "/settings/private-mode") {
    return { page: "private-mode" };
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
    if (path.startsWith("/private/bookmarks/")) {
      const bookmarkId = decodeURIComponent(path.slice("/private/bookmarks/".length));
      if (!bookmarkId) {
        return { page: "private-mode" };
      }
      const versionId = new URLSearchParams(queryString).get("version") ?? undefined;
      return {
        page: "private-detail",
        bookmarkId,
        versionId,
      };
    }
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

function buildPrivateDetailHash(bookmarkId: string, versionId?: string) {
  const params = new URLSearchParams();
  if (versionId) {
    params.set("version", versionId);
  }
  return `#/private/bookmarks/${encodeURIComponent(bookmarkId)}${params.toString() ? `?${params.toString()}` : ""}`;
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

function goToPrivateMode() {
  window.location.hash = "#/settings/private-mode";
}

function openImportTask(taskId: string) {
  window.location.hash = `#/imports/${encodeURIComponent(taskId)}`;
}

function openBookmark(bookmarkId: string, versionId?: string) {
  window.location.hash = buildDetailHash(bookmarkId, versionId);
}

function openPrivateBookmark(bookmarkId: string, versionId?: string) {
  window.location.hash = buildPrivateDetailHash(bookmarkId, versionId);
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

function AppShell({
  user,
  items,
  folderItemCounts,
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
  onOpenPrivateMode,
  onOpenApiTokens,
  onOpenImportNew,
  onOpenImportHistory,
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
  folderItemCounts: Record<string, number>;
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
  onOpenPrivateMode: () => void;
  onOpenApiTokens: () => void;
  onOpenImportNew: () => void;
  onOpenImportHistory: () => void;
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const activeNav = selectedFolderId || selectedTagId ? null : bookmarkView;
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );
  const selectedTag = useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) ?? null,
    [selectedTagId, tags],
  );

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
    function visit(folderId: string): number {
      const directCount = folderItemCounts[folderId] ?? 0;
      const nestedCount = (childrenByParent.get(folderId) ?? [])
        .reduce((sum, child) => sum + visit(child.id), 0);
      const total = directCount + nestedCount;
      mapping.set(folderId, total);
      return total;
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      visit(folder.id);
    }
    return mapping;
  }, [childrenByParent, folderItemCounts]);

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
  const mobileListTitle = selectedFolder?.name
    ?? (selectedTag ? `#${selectedTag.name}` : bookmarkView === "favorites" ? "星标" : bookmarkView === "recent" ? "最近" : "归档");
  const mobileListSubtitle = selectedFolder
    ? "当前收藏夹"
    : selectedTag
      ? "当前标签"
      : bookmarkView === "favorites"
        ? "Favorite Archive"
        : bookmarkView === "recent"
          ? "Recent Updates"
          : "KeepPage Archive";

  useEffect(() => {
    if (!mobileSearchOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus();
      mobileSearchInputRef.current?.select();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [mobileSearchOpen]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    setSidebarView("main");
  }, [routePage]);

  function handleSelectQuickNav(nextNav: BookmarkListView) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView(nextNav);
    onSelectFolder("");
    onSelectTag("");
  }

  function handleSelectFolderFilter(nextFolderId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView("all");
    onSelectTag("");
    onSelectFolder(nextFolderId);
  }

  function handleSelectTagFilter(nextTagId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
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
      <button
        className={mobileSidebarOpen ? "home-mobile-sidebar-backdrop is-visible" : "home-mobile-sidebar-backdrop"}
        type="button"
        aria-label="关闭移动端侧边栏"
        onClick={() => {
          setMobileSidebarOpen(false);
          setSidebarView("main");
        }}
      />
      <aside className={mobileSidebarOpen ? "home-sidebar is-mobile-open" : "home-sidebar"}>
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
                className={routePage === "private-mode" || routePage === "private-detail"
                  ? "home-settings-item is-active"
                  : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenPrivateMode();
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  lock
                </span>
                <span>私密模式</span>
              </button>
              <button
                className={routePage === "settings-api-tokens" ? "home-settings-item is-active" : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenApiTokens();
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  vpn_key
                </span>
                <span>API 密钥</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  onOpenImportNew();
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                <span>新建导入</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  onOpenImportHistory();
                }}
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
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  onLogout();
                }}
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

      <div className={routePage === "list" ? "home-shell has-mobile-list-chrome" : "home-shell"}>
        <header className="home-topbar" />

        {routePage === "list" ? (
          <section className="home-mobile-bar home-mobile-bar--list" aria-label="移动端顶栏">
            <div className="home-mobile-topbar">
              <button
                className={mobileSidebarOpen && sidebarView === "main" ? "home-mobile-icon-button is-active" : "home-mobile-icon-button"}
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSidebarView("main");
                  setMobileSidebarOpen((current) => (sidebarView === "main" ? !current : true));
                }}
                aria-label="打开筛选与收藏夹"
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  menu
                </span>
              </button>

              <button className="home-mobile-title-wrap" type="button" onClick={onGoHome} aria-label="返回归档首页">
                <span className="home-mobile-title-eyebrow">{mobileListSubtitle}</span>
                <span className="home-mobile-title">{mobileListTitle}</span>
              </button>

              <button
                className={mobileSearchOpen || searchInput.trim() ? "home-mobile-icon-button is-active" : "home-mobile-icon-button"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  setMobileSearchOpen((current) => !current);
                }}
                aria-label="打开搜索"
                aria-expanded={mobileSearchOpen}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  search
                </span>
              </button>
            </div>

            <div
              className={mobileSearchOpen || searchInput.trim() ? "home-mobile-search-panel is-open" : "home-mobile-search-panel"}
            >
              <label className="home-search">
                <span className="home-search-icon material-symbols-outlined" aria-hidden="true">
                  search
                </span>
                <input
                  ref={mobileSearchInputRef}
                  className="home-search-input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="搜索标题、域名、标签..."
                />
              </label>
            </div>
          </section>
        ) : (
          <section className="home-mobile-bar home-mobile-bar--default">
            <div className="home-mobile-header">
              <button className="home-brand-home" type="button" onClick={onGoHome} aria-label="返回主页">
                <span className="home-brand-title">KeepPage</span>
              </button>
              <div className="home-mobile-actions">
                <button
                  className={mobileSidebarOpen && sidebarView === "main" ? "home-mobile-action is-active" : "home-mobile-action"}
                  type="button"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setSidebarView("main");
                    setMobileSidebarOpen((current) => (sidebarView === "main" ? !current : true));
                  }}
                  aria-label="打开筛选与收藏夹"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    tune
                  </span>
                </button>
                <button className="home-mobile-cta" type="button" onClick={onOpenImportNew}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    add
                  </span>
                  <span>Add New</span>
                </button>
                <button
                  className={mobileSidebarOpen && sidebarView === "settings" ? "home-mobile-action is-active" : "home-mobile-action"}
                  type="button"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setSidebarView("settings");
                    setMobileSidebarOpen((current) => (sidebarView === "settings" ? !current : true));
                  }}
                  aria-label="打开设置"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    settings
                  </span>
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="home-content">
          {children}
        </section>

        {routePage === "list" ? (
          <>
            <button className="home-mobile-fab" type="button" onClick={onOpenImportNew} aria-label="新建归档导入">
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
            </button>

            <nav className="home-mobile-bottom-nav" aria-label="移动端主导航">
              <button
                className={activeNav === "all" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("all")}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  bookmarks
                </span>
                <span>全部</span>
              </button>
              <button
                className={activeNav === "recent" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("recent")}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  schedule
                </span>
                <span>最近</span>
              </button>
              <button
                className={activeNav === "favorites" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("favorites")}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  star
                </span>
                <span>星标</span>
              </button>
              <button
                className={selectedFolderId || selectedTagId || (mobileSidebarOpen && sidebarView === "main") ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSidebarView("main");
                  setMobileSidebarOpen((current) => !current);
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  folder_open
                </span>
                <span>收藏夹</span>
              </button>
            </nav>
          </>
        ) : null}
      </div>
    </main>
  );
}

function PrivateModePage({
  summary,
  privateToken,
  items,
  loadState,
  error,
  setupPassword,
  setupConfirm,
  unlockPassword,
  busy,
  onSetupPasswordChange,
  onSetupConfirmChange,
  onUnlockPasswordChange,
  onSetup,
  onUnlock,
  onLock,
  onOpenBookmark,
}: {
  summary: PrivateVaultSummary | null;
  privateToken: string | null;
  items: Bookmark[];
  loadState: LoadState;
  error: string | null;
  setupPassword: string;
  setupConfirm: string;
  unlockPassword: string;
  busy: boolean;
  onSetupPasswordChange: (value: string) => void;
  onSetupConfirmChange: (value: string) => void;
  onUnlockPasswordChange: (value: string) => void;
  onSetup: () => void;
  onUnlock: () => void;
  onLock: () => void;
  onOpenBookmark: (bookmarkId: string) => void;
}) {
  const enabled = Boolean(summary?.enabled);
  const unlocked = Boolean(privateToken);

  if (!summary) {
    return (
      <section className="private-mode-page">
        <header className="private-mode-hero">
          <div>
            <p className="eyebrow">设置</p>
            <h1>私密模式</h1>
            <p>正在读取私密模式状态...</p>
          </div>
        </header>
        {error ? (
          <p className="status-banner is-error">{error}</p>
        ) : (
          <p className="status-banner">正在加载私密模式状态...</p>
        )}
      </section>
    );
  }

  return (
    <section className="private-mode-page">
      <header className="private-mode-hero">
        <div>
          <p className="eyebrow">设置</p>
          <h1>私密模式</h1>
          <p>
            私密模式用于默认隐藏和密码进入，不等同于加密保险箱。
            当前版本会把私密内容存到独立私密链路中，首页默认不会展示。
          </p>
        </div>
        {enabled && unlocked ? (
          <button className="secondary-button" type="button" onClick={onLock} disabled={busy}>
            退出私密模式
          </button>
        ) : null}
      </header>

      <div className="private-mode-stats">
        <article className="private-mode-stat-card">
          <span>当前状态</span>
          <strong>{!enabled ? "未启用" : unlocked ? "已进入" : "已锁定"}</strong>
          <small>登录账号后仍需单独输入私密密码</small>
        </article>
        <article className="private-mode-stat-card">
          <span>私密条目</span>
          <strong>{summary?.totalItems ?? 0}</strong>
          <small>默认不会出现在普通首页和普通搜索中</small>
        </article>
        <article className="private-mode-stat-card">
          <span>最近更新</span>
          <strong>{summary?.lastUpdatedAt ? formatRelativeWhen(summary.lastUpdatedAt) : "暂无"}</strong>
          <small>{summary?.lastUpdatedAt ? formatWhen(summary.lastUpdatedAt) : "还没有私密内容"}</small>
        </article>
      </div>

      {!enabled ? (
        <section className="private-mode-card">
          <h2>启用私密模式</h2>
          <p>设置一个独立密码后，扩展和 Web 都可以把内容保存到私密工作区。</p>
          <div className="private-mode-form">
            <label>
              <span>私密密码</span>
              <input
                type="password"
                value={setupPassword}
                onChange={(event) => onSetupPasswordChange(event.target.value)}
                placeholder="至少 8 位"
              />
            </label>
            <label>
              <span>确认密码</span>
              <input
                type="password"
                value={setupConfirm}
                onChange={(event) => onSetupConfirmChange(event.target.value)}
                placeholder="再次输入"
              />
            </label>
          </div>
          <button className="primary-button" type="button" onClick={onSetup} disabled={busy}>
            {busy ? "启用中..." : "启用私密模式"}
          </button>
        </section>
      ) : !unlocked ? (
        <section className="private-mode-card">
          <h2>输入密码进入私密空间</h2>
          <p>关闭或刷新 KeepPage 页面后，会默认退出私密模式。</p>
          <div className="private-mode-form">
            <label>
              <span>私密密码</span>
              <input
                type="password"
                value={unlockPassword}
                onChange={(event) => onUnlockPasswordChange(event.target.value)}
                placeholder="输入私密密码"
              />
            </label>
          </div>
          <button className="primary-button" type="button" onClick={onUnlock} disabled={busy}>
            {busy ? "进入中..." : "进入私密空间"}
          </button>
        </section>
      ) : (
        <section className="private-mode-card">
          <div className="private-mode-card-head">
            <div>
              <h2>私密内容</h2>
              <p>这里是独立私密工作区。内容不会出现在普通列表、普通搜索和普通统计里。</p>
            </div>
          </div>

          {loadState === "loading" ? (
            <p className="status-banner">正在加载私密内容...</p>
          ) : items.length === 0 ? (
            <div className="private-mode-empty">
              <h3>还没有私密内容</h3>
              <p>可以在扩展侧通过“保存到 KP 私密模式”把当前网页保存进来。</p>
            </div>
          ) : (
            <div className="private-mode-list">
              {items.map((bookmark) => (
                <button
                  className="private-mode-item"
                  key={bookmark.id}
                  type="button"
                  onClick={() => onOpenBookmark(bookmark.id)}
                >
                  <div>
                    <strong>{bookmark.title}</strong>
                    <p>{bookmark.domain}</p>
                  </div>
                  <span>{formatRelativeWhen(bookmark.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {error ? (
        <p className="status-banner is-error">{error}</p>
      ) : null}
    </section>
  );
}

function PrivateDetailPage({
  detail,
  selectedVersion,
  previewState,
  preferredPreviewMode,
  activePreviewMode,
  onGoBack,
  onSelectVersion,
  onPreviewModeChange,
}: {
  detail: BookmarkDetailResult;
  selectedVersion: BookmarkViewerVersion;
  previewState: ArchivePreviewState;
  preferredPreviewMode: ArchiveViewMode;
  activePreviewMode: ArchiveViewMode | null;
  onGoBack: () => void;
  onSelectVersion: (bookmarkId: string, versionId?: string) => void;
  onPreviewModeChange: (mode: ArchiveViewMode) => void;
}) {
  const displayedArchiveSize = activePreviewMode === "reader"
    ? selectedVersion.readerArchiveSizeBytes ?? selectedVersion.archiveSizeBytes
    : selectedVersion.archiveSizeBytes ?? selectedVersion.readerArchiveSizeBytes;
  const readerPreviewAvailable = Boolean(
    selectedVersion.readerHtmlObjectKey && selectedVersion.readerArchiveAvailable,
  );
  const originalPreviewAvailable = selectedVersion.archiveAvailable;
  const fallbackMessage = activePreviewMode && preferredPreviewMode !== activePreviewMode
    ? "当前版本没有首选预览对象，已自动回退。"
    : null;

  return (
    <section className="detail-shell">
      <section className="detail-preview-panel">
        {!activePreviewMode ? (
          <section className="empty-state preview-empty">
            <h2>归档对象不可用</h2>
            <p>当前私密版本没有可读取的归档对象。</p>
          </section>
        ) : previewState.status === "loading" ? (
          <section className="loading preview-empty">正在加载私密预览...</section>
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
        <div className="detail-top-bar">
          <button className="detail-back-button" type="button" onClick={onGoBack}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
          <div className="preview-mode-switch preview-mode-switch--compact" role="tablist" aria-label="私密归档预览模式">
            <button
              className={activePreviewMode === "reader" ? "preview-mode-button is-active" : "preview-mode-button"}
              type="button"
              onClick={() => onPreviewModeChange("reader")}
              disabled={!readerPreviewAvailable}
            >
              阅读视图
            </button>
            <button
              className={activePreviewMode === "original" ? "preview-mode-button is-active" : "preview-mode-button"}
              type="button"
              onClick={() => onPreviewModeChange("original")}
              disabled={!originalPreviewAvailable}
            >
              原始归档
            </button>
          </div>
        </div>
        {fallbackMessage ? <p className="preview-mode-note">{fallbackMessage}</p> : null}

        <div className="detail-block">
          <div className="detail-header-label">
            <span className="detail-header-label-text">Private View</span>
            <span className="detail-header-label-id">#{detail.bookmark.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="detail-title-row">
            <h2 className="detail-title">{detail.bookmark.title}</h2>
          </div>
          <div className="detail-url-row">
            <span className="material-symbols-outlined" aria-hidden="true">link</span>
            <a href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              {detail.bookmark.sourceUrl}
            </a>
          </div>
        </div>

        <div className="detail-meta-grid">
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Added</span>
            <span className="detail-meta-cell-value">{formatWhen(detail.bookmark.createdAt)}</span>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Last Sync</span>
            <span className="detail-meta-cell-value">{formatWhen(detail.bookmark.updatedAt)}</span>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">Versions</span>
            <span className="detail-meta-cell-value">{detail.versions.length}</span>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-cell-label">File Size</span>
            <span className="detail-meta-cell-value">
              {displayedArchiveSize ? `${Math.round(displayedArchiveSize / 1024)} KB` : "未知"}
            </span>
          </div>
        </div>

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
                    onClick={() => onSelectVersion(detail.bookmark.id, version.id)}
                  >
                    <span className="version-item-icon material-symbols-outlined" aria-hidden="true">refresh</span>
                    <div>
                      <strong>v{version.versionNo}{isLatest ? " (Latest)" : ""}</strong>
                      <span>{formatWhen(version.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </details>
      </aside>
    </section>
  );
}

function ApiTokensPanel({
  token,
  userId,
  dataSource,
  onApiError,
  onBack,
}: {
  token: string;
  userId: string;
  dataSource: AppDataSource;
  onApiError: (error: unknown) => boolean;
  onBack: () => void;
}) {
  const isDemoMode = dataSource.kind === "demo";
  const storageUserId = isDemoMode ? "demo" : userId;
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [items, setItems] = useState<ApiToken[]>([]);
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
    let cancelled = false;
    setLoadState("loading");
    dataSource.fetchApiTokens(token)
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
  }, [dataSource, token]);

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
      const result = await dataSource.createApiToken({
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

      setCreateOpen(false);
      setCreateName("");
      setCreateExpiresAt("");
      setFeedback({
        kind: "success",
        message: `已创建 API 密钥：${trimmedName}。完整明文已保存在当前浏览器，下面可以直接复制 curl 测试。`,
      });
    } catch (error) {
      if (onApiError(error)) {
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
      await dataSource.revokeApiToken(revokeTarget.id, token);
      setItems((current) => current.map((item) => (
        item.id === revokeTarget.id
          ? { ...item, revokedAt }
          : item
      )));

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
      if (onApiError(error)) {
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
  const isFolderDeleteDialog = state.kind === "delete-folder";
  const useBookmarkDeleteStyle = isBookmarkDialog || isBatchDeleteDialog || isFolderDeleteDialog;
  const bookmarkDeleteTarget = state.kind === "delete-bookmark" ? state.bookmark : null;
  const folderDeleteTarget = state.kind === "delete-folder" ? state.folder : null;
  const tagDeleteTarget = state.kind === "delete-tag" ? state.tag : null;
  const bookmarkDeleteFaviconSrc = bookmarkDeleteTarget
    ? buildBookmarkSiteIconCandidates(bookmarkDeleteTarget, 64)[0] ?? ""
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
      className={useBookmarkDeleteStyle ? "manager-dialog-backdrop is-bookmark-delete" : "manager-dialog-backdrop"}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="manager-dialog-title"
        aria-modal="true"
        className={useBookmarkDeleteStyle ? "manager-dialog bookmark-delete-dialog" : isDeleteDialog ? "manager-dialog is-danger" : "manager-dialog"}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        {isBatchDeleteDialog ? (
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

              <section className="bookmark-delete-card batch-delete-card">
                <div className="batch-delete-card-count" aria-hidden="true">
                  {state.count}
                </div>
                <div className="bookmark-delete-card-body batch-delete-card-body">
                  <strong>即将删除 {state.count} 条归档</strong>
                  <span className="bookmark-delete-card-domain">关联的版本记录也会一起清除</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，所选书签和它们的归档版本会一起从列表中移除。</p>
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
        ) : isFolderDeleteDialog && folderDeleteTarget ? (
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
                <div className="bookmark-delete-card-icon" aria-hidden="true">
                  <span className="material-symbols-outlined">folder_open</span>
                </div>
                <div className="bookmark-delete-card-body is-folder-delete">
                  <strong>{folderDeleteTarget.path}</strong>
                  <span className="bookmark-delete-card-domain">子收藏夹会自动上移一层</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，这个收藏夹会消失，当前文件夹里的网页会解除归档，但不会被删除。</p>
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
        ) : isDeleteDialog && tagDeleteTarget ? (
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
              <div className="manager-dialog-mark is-tag">TAG</div>
              <div className="manager-dialog-hero-copy">
                <strong>{`#${tagDeleteTarget.name}`}</strong>
                <span>删除后，这个标签会从所有相关网页上解绑。</span>
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

type LocalArchiveDialogState =
  | { step: "closed" }
  | { step: "confirm"; bookmarks: Bookmark[] }
  | {
      step: "done";
      totalCount: number;
      acceptedCount: number;
      skippedCount: number;
      queueSize: number;
    };

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

function LocalArchiveDialog({
  state,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  state: LocalArchiveDialogState;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (state.step === "closed") {
    return null;
  }

  const totalCount = state.step === "confirm" ? state.bookmarks.length : state.totalCount;

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
        aria-labelledby="local-archive-title"
        aria-modal="true"
        className="create-folder-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="create-folder-dialog-shell">
          <div className="create-folder-dialog-header">
            <div className="create-folder-dialog-heading">
              <h2 id="local-archive-title">本地插件存档</h2>
              <p>
                {state.step === "confirm"
                  ? "任务会发送到本地浏览器插件，按队列顺序逐条存档，避免一次并发过多。"
                  : "任务已经提交到本地插件队列。"}
              </p>
            </div>
            <button
              className="create-folder-dialog-close"
              type="button"
              aria-label="关闭"
              onClick={onClose}
              disabled={busy}
            >
              <DialogCloseIcon />
            </button>
          </div>

          {state.step === "confirm" ? (
            <div className="archive-dialog-panel">
              {error ? <p className="manager-dialog-error create-folder-dialog-error">{error}</p> : null}
              <div className="manager-dialog-hero">
                <div className="manager-dialog-heading">
                  <h2>确认发送 {totalCount} 条书签？</h2>
                  <p>扩展会自动排队抓取，并在抓取完成后继续走同步流程。</p>
                </div>
              </div>
              <div className="create-folder-dialog-actions">
                <button className="create-folder-action-button is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="create-folder-action-button is-primary" type="button" onClick={onConfirm} disabled={busy}>
                  {busy ? "发送中..." : "发送到本地插件"}
                </button>
              </div>
            </div>
          ) : (
            <div className="archive-dialog-panel">
              <div className="archive-dialog-status">
                <p className="archive-dialog-status-text">
                  已提交 {state.acceptedCount} / {state.totalCount} 条到本地插件队列。
                </p>
                <p className="archive-dialog-note">
                  {state.skippedCount > 0
                    ? `其中 ${state.skippedCount} 条已在队列中，已自动跳过。`
                    : "没有检测到重复任务。"}
                </p>
                <p className="archive-dialog-note">当前队列剩余 {state.queueSize} 条待处理。</p>
              </div>
              <div className="create-folder-dialog-actions is-single">
                <button className="create-folder-action-button is-primary" type="button" onClick={onClose}>
                  我知道了
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function App({
  dataSourceKind = "live",
}: {
  dataSourceKind?: "live" | "demo";
}) {
  const appDataSource = useAppDataSource(dataSourceKind);
  const isDemoMode = appDataSource.kind === "demo";
  const [route, setRoute] = useState<ViewRoute>(() => parseRoute(window.location.hash));
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
  const [listTotal, setListTotal] = useState(0);
  const [sidebarFolderCounts, setSidebarFolderCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [preferredPreviewMode, setPreferredPreviewMode] = useState<ArchiveViewMode>("reader");
  const [privateSummary, setPrivateSummary] = useState<PrivateVaultSummary | null>(null);
  const [privateToken, setPrivateToken] = useState<string | null>(null);
  const [privateItems, setPrivateItems] = useState<Bookmark[]>([]);
  const [privateLoadState, setPrivateLoadState] = useState<LoadState>("idle");
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [privateSetupPassword, setPrivateSetupPassword] = useState("");
  const [privateSetupConfirm, setPrivateSetupConfirm] = useState("");
  const [privateUnlockPassword, setPrivateUnlockPassword] = useState("");
  const [privateBusy, setPrivateBusy] = useState(false);
  const [privateDetail, setPrivateDetail] = useState<BookmarkDetailResult | null>(null);
  const [privateDetailLoadState, setPrivateDetailLoadState] = useState<DetailLoadState>("idle");
  const [privateDetailError, setPrivateDetailError] = useState<string | null>(null);
  const [privateArchivePreview, setPrivateArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [privatePreferredPreviewMode, setPrivatePreferredPreviewMode] = useState<ArchiveViewMode>("reader");
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
  const [localArchiveDialog, setLocalArchiveDialog] = useState<LocalArchiveDialogState>({ step: "closed" });
  const [localArchiveBusy, setLocalArchiveBusy] = useState(false);
  const [localArchiveError, setLocalArchiveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);
  const authToken = session.status === "authenticated" ? session.token : null;
  const logoutLabel = appDataSource.logoutLabel;
  const isManagerDialogVisible = isManagerDialogOpen(managerDialog);
  const activeBookmarkContextId = contextMenu.kind === "bookmark" ? contextMenu.bookmark.id : null;
  const activeFolderContextId = contextMenu.kind === "folder" ? contextMenu.folder.id : null;
  const activeTagContextId = contextMenu.kind === "tag" ? contextMenu.tag.id : null;
  const hasMoreItems = items.length < listTotal;
  const importAdapter = appDataSource.importAdapter;

  function clearPrivateState() {
    setPrivateToken(null);
    setPrivateSummary(null);
    setPrivateItems([]);
    setPrivateLoadState("idle");
    setPrivateError(null);
    setPrivateSetupPassword("");
    setPrivateSetupConfirm("");
    setPrivateUnlockPassword("");
    setPrivateBusy(false);
    setPrivateDetail(null);
    setPrivateDetailLoadState("idle");
    setPrivateDetailError(null);
    setPrivateArchivePreview({ status: "idle" });
    setPrivatePreferredPreviewMode("reader");
  }

  function logout(message?: string) {
    if (isDemoMode) {
      const nextSession = appDataSource.resetSession();
      goToList();
      startTransition(() => {
        if (!nextSession) {
          return;
        }
        setSession({
          status: "authenticated",
          token: nextSession.token,
          user: nextSession.user,
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
        clearPrivateState();
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
      setSidebarFolderCounts({});
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
      clearPrivateState();
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

  const toggleSelected = useCallback((bookmarkId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId);
      } else {
        next.add(bookmarkId);
      }
      return next;
    });
  }, []);

  function selectAllBookmarks() {
    setSelectedIds(new Set(items.map((b) => b.id)));
  }

  function deselectAllBookmarks() {
    setSelectedIds(new Set());
  }

  function openLocalArchiveDialog(bookmarks: Bookmark[]) {
    setLocalArchiveError(null);
    setLocalArchiveBusy(false);
    setLocalArchiveDialog({
      step: "confirm",
      bookmarks,
    });
  }

  function closeLocalArchiveDialog() {
    if (localArchiveBusy) {
      return;
    }
    setLocalArchiveDialog({ step: "closed" });
    setLocalArchiveError(null);
  }

  function openManagerDialog(nextState: ManagerDialogState) {
    setManagerDialog(nextState);
    setManagerDialogError(null);
  }

  const openBookmarkContextMenuAt = useCallback((bookmark: Bookmark, x: number, y: number) => {
    setContextMenu({
      kind: "bookmark",
      bookmark,
      x,
      y,
    });
  }, []);

  const openBookmarkContextMenu = useCallback((bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openBookmarkContextMenuAt(bookmark, event.clientX, event.clientY);
  }, [openBookmarkContextMenuAt]);

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

  function handlePrivateModeApiError(error: unknown) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403) &&
      /(私密|密码|PrivateMode|locked)/i.test(error.message)
    ) {
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateDetail(null);
      setPrivateArchivePreview({ status: "idle" });
      setPrivateError("私密模式已锁定或会话已失效，请重新输入密码。");
      if (route.page === "private-detail") {
        goToPrivateMode();
      }
      return true;
    }
    return handleProtectedApiError(error);
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
    let cancelled = false;
    appDataSource.restoreSession(getStoredToken())
      .then((nextSession) => {
        if (cancelled) {
          return;
        }
        if (nextSession.status === "anonymous") {
          clearStoredToken();
        }
        setSession(nextSession);
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
  }, [appDataSource]);

  useEffect(() => {
    if (!authToken) {
      setPrivateSummary(null);
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateLoadState("idle");
      setPrivateError(null);
      return;
    }

    let cancelled = false;
    appDataSource.fetchPrivateModeStatus(authToken, privateToken ?? undefined)
      .then((summary) => {
        if (cancelled) {
          return;
        }
        setPrivateSummary(summary);
        if (!summary.unlocked) {
          setPrivateToken(null);
        }
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        setPrivateSummary(null);
        setPrivateError(toErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, privateToken]);

  useEffect(() => {
    if (!authToken) {
      setFolders([]);
      setTags([]);
      setManagerFeedback(null);
      return;
    }

    let cancelled = false;
    Promise.all([appDataSource.fetchFolders(authToken), appDataSource.fetchTags(authToken)])
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
  }, [appDataSource, authToken]);

  useEffect(() => {
    if (!authToken) {
      setSidebarFolderCounts({});
      return;
    }

    let cancelled = false;
    appDataSource.fetchBookmarkFolderCounts(authToken)
      .then((nextCounts) => {
        if (cancelled) {
          return;
        }
        setSidebarFolderCounts(nextCounts);
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, route.page]);

  useEffect(() => {
    if (!authToken) {
      setItems([]);
      setListTotal(0);
      setLoadState("idle");
      setListError(null);
      setLoadMoreError(null);
      setLoadingMore(false);
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    setListError(null);
    setLoadMoreError(null);
    setLoadingMore(false);

    appDataSource.searchBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        folderId: selectedFolderId || undefined,
        tagId: selectedTagId || undefined,
        limit: BOOKMARKS_PAGE_SIZE,
        offset: 0,
      },
      authToken,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setItems(result.items);
          setListTotal(result.total);
          setLoadState("ready");
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setListTotal(0);
          setLoadState("error");
          setListError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, bookmarkView, deferredSearch, qualityFilter, selectedFolderId, selectedTagId]);

  useEffect(() => {
    if (!authToken || route.page !== "detail") {
      setDetailLoadState("idle");
      setDetailError(null);
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoadState("loading");
    setDetailError(null);

    appDataSource.fetchBookmarkDetail(route.bookmarkId, authToken)
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
  }, [appDataSource, authToken, route]);

  useEffect(() => {
    if (!authToken || route.page !== "private-mode" || !privateToken) {
      setPrivateLoadState("idle");
      setPrivateError((current) => (
        route.page === "private-detail" ? current : null
      ));
      if (route.page !== "private-mode") {
        setPrivateItems([]);
      }
      return;
    }

    let cancelled = false;
    setPrivateLoadState("loading");
    setPrivateError(null);

    appDataSource.searchPrivateBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        limit: BOOKMARKS_PAGE_SIZE,
        offset: 0,
      },
      authToken,
      privateToken,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPrivateItems(result.items);
          setPrivateLoadState("ready");
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        startTransition(() => {
          setPrivateItems([]);
          setPrivateLoadState("error");
          setPrivateError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, bookmarkView, deferredSearch, privateToken, qualityFilter, route.page]);

  useEffect(() => {
    if (!authToken || route.page !== "private-detail" || !privateToken) {
      setPrivateDetailLoadState("idle");
      setPrivateDetailError(null);
      setPrivateDetail(null);
      return;
    }

    let cancelled = false;
    setPrivateDetailLoadState("loading");
    setPrivateDetailError(null);

    appDataSource.fetchPrivateBookmarkDetail(route.bookmarkId, authToken, privateToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPrivateDetail(result);
          setPrivateDetailLoadState(result ? "ready" : "not-found");
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        startTransition(() => {
          setPrivateDetail(null);
          setPrivateDetailLoadState("error");
          setPrivateDetailError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, privateToken, route]);

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

  const selectedPrivateVersion = useMemo(() => {
    if (!privateDetail || route.page !== "private-detail") {
      return null;
    }

    return (
      privateDetail.versions.find((version) => version.id === route.versionId) ??
      privateDetail.versions.find((version) => version.id === privateDetail.bookmark.latestVersionId) ??
      privateDetail.versions[0] ??
      null
    );
  }, [privateDetail, route]);

  const previewSourceUrl = detail
    ? (detail.bookmark.canonicalUrl ?? detail.bookmark.sourceUrl)
    : null;
  const previewSelection = useMemo(
    () => resolvePreviewSelection(selectedVersion, preferredPreviewMode),
    [preferredPreviewMode, selectedVersion],
  );
  const privatePreviewSourceUrl = privateDetail
    ? (privateDetail.bookmark.canonicalUrl ?? privateDetail.bookmark.sourceUrl)
    : null;
  const privatePreviewSelection = useMemo(
    () => resolvePreviewSelection(selectedPrivateVersion, privatePreferredPreviewMode),
    [privatePreferredPreviewMode, selectedPrivateVersion],
  );

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !previewSelection?.objectKey || !previewSourceUrl) {
      setArchivePreview({ status: "idle" });
      return;
    }

    setArchivePreview({ status: "loading" });

    appDataSource.createArchivePreviewUrl(
      selectedVersion?.id ?? null,
      previewSelection?.objectKey ?? null,
      previewSourceUrl,
      authToken,
    )
      .then((url) => {
        if (!url) {
          setArchivePreview({ status: "idle" });
          return;
        }
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
    appDataSource,
    authToken,
    previewSelection?.objectKey,
    previewSelection?.mode,
    previewSourceUrl,
    selectedVersion?.id,
  ]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !privateToken || !privatePreviewSelection?.objectKey || !privatePreviewSourceUrl) {
      setPrivateArchivePreview({ status: "idle" });
      return;
    }

    setPrivateArchivePreview({ status: "loading" });

    appDataSource.createArchivePreviewUrl(
      selectedPrivateVersion?.id ?? null,
      privatePreviewSelection?.objectKey ?? null,
      privatePreviewSourceUrl,
      authToken,
      privateToken,
    )
      .then((url) => {
        if (!url) {
          setPrivateArchivePreview({ status: "idle" });
          return;
        }
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokedUrl = url;
        setPrivateArchivePreview({
          status: "ready",
          url,
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          privatePreviewSelection?.mode === "reader" &&
          selectedPrivateVersion?.archiveAvailable
        ) {
          setPrivatePreferredPreviewMode("original");
          return;
        }
        setPrivateArchivePreview({
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
    appDataSource,
    authToken,
    privatePreviewSelection?.objectKey,
    privatePreviewSelection?.mode,
    privatePreviewSourceUrl,
    privateToken,
    selectedPrivateVersion?.id,
  ]);

  async function refreshSidebarFolderCounts(currentToken: string) {
    const nextCounts = await appDataSource.fetchBookmarkFolderCounts(currentToken);
    setSidebarFolderCounts(nextCounts);
  }

  async function refreshCatalogs(currentToken: string) {
    const [nextFolders, nextTags] = await Promise.all([
      appDataSource.fetchFolders(currentToken),
      appDataSource.fetchTags(currentToken),
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
    const limit = Math.max(items.length, BOOKMARKS_PAGE_SIZE);
    const result = await appDataSource.searchBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        folderId: selectedFolderId || undefined,
        tagId: selectedTagId || undefined,
        limit,
        offset: 0,
      },
      currentToken,
    );
    setListError(null);
    setLoadMoreError(null);
    setItems(result.items);
    setListTotal(result.total);
    setLoadingMore(false);
    setLoadState("ready");
  }

  async function loadMoreBookmarks() {
    if (loadingMore || loadState !== "ready" || !hasMoreItems) {
      return;
    }

    setLoadMoreError(null);
    setLoadingMore(true);

    if (!authToken) {
      setLoadingMore(false);
      return;
    }

    try {
      const result = await appDataSource.searchBookmarks(
        {
          search: deferredSearch,
          quality: qualityFilter,
          view: bookmarkView,
          folderId: selectedFolderId || undefined,
          tagId: selectedTagId || undefined,
          limit: BOOKMARKS_PAGE_SIZE,
          offset: items.length,
        },
        authToken,
      );
      setItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const nextItems = result.items.filter((item) => !existingIds.has(item.id));
        return [...current, ...nextItems];
      });
      setListTotal(result.total);
    } catch (error) {
      if (!handleProtectedApiError(error)) {
        setLoadMoreError(toErrorMessage(error));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshBookmarkDetail(currentToken: string, bookmarkId: string) {
    const result = await appDataSource.fetchBookmarkDetail(bookmarkId, currentToken);
    setDetailError(null);
    setDetail(result);
    setDetailLoadState(result ? "ready" : "not-found");
  }

  async function refreshPrivateSummary(currentToken: string, currentPrivateToken?: string | null) {
    const summary = await appDataSource.fetchPrivateModeStatus(currentToken, currentPrivateToken ?? undefined);
    setPrivateSummary(summary);
    if (!summary.unlocked) {
      setPrivateToken(null);
    }
    return summary;
  }

  async function refreshPrivateBookmarksList(currentToken: string, currentPrivateToken: string) {
    const limit = Math.max(privateItems.length, BOOKMARKS_PAGE_SIZE);
    const result = await appDataSource.searchPrivateBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        limit,
        offset: 0,
      },
      currentToken,
      currentPrivateToken,
    );
    setPrivateItems(result.items);
    setPrivateLoadState("ready");
    setPrivateError(null);
  }

  async function refreshPrivateBookmarkDetail(
    currentToken: string,
    currentPrivateToken: string,
    bookmarkId: string,
  ) {
    const result = await appDataSource.fetchPrivateBookmarkDetail(bookmarkId, currentToken, currentPrivateToken);
    setPrivateDetail(result);
    setPrivateDetailLoadState(result ? "ready" : "not-found");
    setPrivateDetailError(null);
  }

  async function handleSetupPrivateMode() {
    if (!authToken) {
      return;
    }
    const password = privateSetupPassword.trim();
    if (password.length < 8) {
      setPrivateError("私密密码至少需要 8 位。");
      return;
    }
    if (password !== privateSetupConfirm) {
      setPrivateError("两次输入的私密密码不一致。");
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const result = await appDataSource.setupPrivateMode(password, authToken);
      setPrivateSummary(result.summary);
      setPrivateToken(result.privateToken);
      setPrivateSetupPassword("");
      setPrivateSetupConfirm("");
      setPrivateUnlockPassword("");
      await refreshPrivateBookmarksList(authToken, result.privateToken);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function handleUnlockPrivateMode() {
    if (!authToken) {
      return;
    }
    if (!privateUnlockPassword) {
      setPrivateError("请输入私密密码。");
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const result = await appDataSource.unlockPrivateMode(privateUnlockPassword, authToken);
      setPrivateSummary(result.summary);
      setPrivateToken(result.privateToken);
      setPrivateUnlockPassword("");
      await refreshPrivateBookmarksList(authToken, result.privateToken);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function handleLockPrivateMode() {
    if (!authToken) {
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const summary = await appDataSource.lockPrivateMode(authToken);
      setPrivateSummary(summary);
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateDetail(null);
      setPrivateArchivePreview({ status: "idle" });
      setPrivateDetailLoadState("idle");
      setPrivateDetailError(null);
      setPrivateUnlockPassword("");
      if (route.page === "private-detail") {
        goToPrivateMode();
      }
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
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
      await refreshSidebarFolderCounts(authToken);
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
    await runManagerAction(async () => {
      await appDataSource.deleteBookmark(bookmark.id, authToken!);
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
      const results = await Promise.allSettled(
        [...ids].map((id) => appDataSource.deleteBookmark(id, authToken!)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        setManagerFeedback({
          kind: "error",
          message: `批量删除完成，但有 ${failed} 条失败。`,
        });
        await refreshSidebarFolderCounts(authToken!);
        await refreshBookmarksList(authToken!);
        exitSelectionMode();
        return;
      }
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
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
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { isFavorite }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
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

  function handleBatchLocalArchive(ids: Set<string>) {
    if (ids.size === 0) return;
    const selectedBookmarks = items.filter((bookmark) => ids.has(bookmark.id));
    openLocalArchiveDialog(selectedBookmarks);
  }

  async function confirmLocalArchiveDialog() {
    if (localArchiveDialog.step !== "confirm") {
      return;
    }
    setLocalArchiveBusy(true);
    setLocalArchiveError(null);
    try {
      if (!authToken) {
        throw new Error("当前未登录，无法发送本地存档任务。");
      }
      const result = await appDataSource.enqueueLocalArchive(localArchiveDialog.bookmarks);
      setLocalArchiveDialog({
        step: "done",
        totalCount: localArchiveDialog.bookmarks.length,
        acceptedCount: result.acceptedCount,
        skippedCount: result.skippedCount,
        queueSize: result.queueSize,
      });
      exitSelectionMode();
    } catch (error) {
      setLocalArchiveError(toErrorMessage(error));
    } finally {
      setLocalArchiveBusy(false);
    }
  }

  async function handleBatchMoveTo(ids: Set<string>, folderId: string | null) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { folderId }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
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
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { tagIds }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
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
    await runManagerAction(async () => {
      const folder = await appDataSource.createFolder({
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

    await runManagerAction(async () => {
      const updated = await appDataSource.updateFolder(folder.id, {
        name: nextName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已更新收藏夹路径：${updated.path}`;
    });
  }

  async function handleDeleteFolder(folder: Folder) {
    await runManagerAction(async () => {
      await appDataSource.deleteFolder(folder.id, authToken!);
      return `已删除收藏夹：${folder.path}`;
    });
  }

  async function handleCreateTag(name: string, color?: string) {
    const trimmedName = name.trim();
    await runManagerAction(async () => {
      const tag = await appDataSource.createTag({
        name: trimmedName,
        color,
      }, authToken!);
      return `已创建标签：#${tag.name}`;
    });
  }

  async function handleEditTag(tag: Tag, nextName: string, nextColorRaw: string) {
    await runManagerAction(async () => {
      const updated = await appDataSource.updateTag(tag.id, {
        name: nextName.trim(),
        color: nextColorRaw.trim() || null,
      }, authToken!);
      return `已更新标签：#${updated.name}`;
    });
  }

  async function handleDeleteTag(tag: Tag) {
    await runManagerAction(async () => {
      await appDataSource.deleteTag(tag.id, authToken!);
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

    try {
      const updated = await appDataSource.updateBookmarkMetadata(
        route.bookmarkId,
        {
          note: metadataNote,
          isFavorite: metadataIsFavorite,
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        },
        authToken,
      );
      await refreshSidebarFolderCounts(authToken);
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
      await appDataSource.updateBookmarkMetadata(bookmark.id, { isFavorite }, authToken);
      await refreshSidebarFolderCounts(authToken);
      await refreshBookmarksList(authToken);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) {
        await refreshBookmarkDetail(authToken, bookmark.id);
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
    contextMenu,
    managerBusy,
    selectedFolderId,
    selectedTagId,
  ]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      const sessionResult = authMode === "register"
        ? await appDataSource.register({
            name: authName.trim() || undefined,
            email: authEmail.trim(),
            password: authPassword,
          })
        : await appDataSource.login({
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
        folderItemCounts={sidebarFolderCounts}
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
        onOpenPrivateMode={goToPrivateMode}
        onOpenApiTokens={goToApiTokens}
        onOpenImportNew={goToImportNew}
        onOpenImportHistory={goToImportList}
        onLogout={() => logout()}
        contextMenuFolderId={activeFolderContextId}
        onFolderContextMenu={openFolderContextMenu}
        contextMenuTagId={activeTagContextId}
        onTagContextMenu={openTagContextMenu}
        logoutLabel={logoutLabel}
      >
        {route.page === "list" ? (
          <BookmarksListRoute
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            selectionBusy={selectionBusy}
            items={items}
            bookmarkView={bookmarkView}
            loadState={loadState}
            listError={listError}
            loadMoreError={loadMoreError}
            hasActiveFilters={Boolean(
              searchInput.trim()
              || bookmarkView !== "all"
              || qualityFilter !== "all"
              || selectedFolderId
              || selectedTagId
            )}
            hasMoreItems={hasMoreItems}
            loadingMore={loadingMore}
            managerFeedback={managerFeedback}
            contextMenuBookmarkId={activeBookmarkContextId}
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
            onExitSelection={exitSelectionMode}
            onOpenBookmark={openBookmark}
            onLoadMore={() => void loadMoreBookmarks()}
            onBookmarkContextMenu={openBookmarkContextMenu}
            onOpenBookmarkContextMenuAt={openBookmarkContextMenuAt}
            onToggleSelect={toggleSelected}
          />
        ) : route.page === "private-mode" ? (
          <PrivateModePage
            summary={privateSummary}
            privateToken={privateToken}
            items={privateItems}
            loadState={privateLoadState}
            error={privateError}
            setupPassword={privateSetupPassword}
            setupConfirm={privateSetupConfirm}
            unlockPassword={privateUnlockPassword}
            busy={privateBusy}
            onSetupPasswordChange={setPrivateSetupPassword}
            onSetupConfirmChange={setPrivateSetupConfirm}
            onUnlockPasswordChange={setPrivateUnlockPassword}
            onSetup={() => void handleSetupPrivateMode()}
            onUnlock={() => void handleUnlockPrivateMode()}
            onLock={() => void handleLockPrivateMode()}
            onOpenBookmark={(bookmarkId) => openPrivateBookmark(bookmarkId)}
          />
        ) : route.page === "private-detail" ? (
          privateToken && privateDetail && selectedPrivateVersion ? (
            <PrivateDetailPage
              detail={privateDetail}
              selectedVersion={selectedPrivateVersion}
              previewState={privateArchivePreview}
              preferredPreviewMode={privatePreferredPreviewMode}
              activePreviewMode={privatePreviewSelection?.mode ?? null}
              onGoBack={goToPrivateMode}
              onSelectVersion={openPrivateBookmark}
              onPreviewModeChange={setPrivatePreferredPreviewMode}
            />
          ) : privateToken && privateDetailLoadState === "loading" ? (
            <section className="detail-shell">
              <section className="loading preview-empty">正在加载私密详情...</section>
            </section>
          ) : privateToken && privateDetailLoadState === "not-found" ? (
            <section className="detail-shell">
              <section className="empty-state preview-empty">
                <h2>私密内容不存在</h2>
                <p>这条私密内容可能已被删除，或当前会话没有权限查看。</p>
              </section>
            </section>
          ) : (
            <PrivateModePage
              summary={privateSummary}
              privateToken={privateToken}
              items={privateItems}
              loadState={privateLoadState}
              error={privateDetailError ?? privateError}
              setupPassword={privateSetupPassword}
              setupConfirm={privateSetupConfirm}
              unlockPassword={privateUnlockPassword}
              busy={privateBusy}
              onSetupPasswordChange={setPrivateSetupPassword}
              onSetupConfirmChange={setPrivateSetupConfirm}
              onUnlockPasswordChange={setPrivateUnlockPassword}
              onSetup={() => void handleSetupPrivateMode()}
              onUnlock={() => void handleUnlockPrivateMode()}
              onLock={() => void handleLockPrivateMode()}
              onOpenBookmark={(bookmarkId) => openPrivateBookmark(bookmarkId)}
            />
          )
        ) : route.page === "detail" ? (
          <BookmarkDetailRoute
            detailLoadState={detailLoadState}
            detailError={detailError}
            detail={detail}
            selectedVersion={selectedVersion}
            previewState={archivePreview}
            preferredPreviewMode={preferredPreviewMode}
            activePreviewMode={previewSelection?.mode ?? null}
            folders={folders}
            tags={tags}
            metadataNote={metadataNote}
            metadataFolderId={metadataFolderId}
            metadataTagIds={metadataTagIds}
            metadataSaving={metadataSaving}
            metadataFeedback={metadataFeedback}
            isPending={isPending}
            onGoBack={goToList}
            onSelectVersion={openBookmark}
            onMetadataNoteChange={setMetadataNote}
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
          dataSource={appDataSource}
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
      <LocalArchiveDialog
        state={localArchiveDialog}
        busy={localArchiveBusy}
        error={localArchiveError}
        onConfirm={() => void confirmLocalArchiveDialog()}
        onClose={closeLocalArchiveDialog}
      />
      {contextMenu.kind !== "closed" ? (
        <ContextMenu state={contextMenu} groups={contextMenuGroups} onClose={closeContextMenu} />
      ) : null}
    </>
  );
}
