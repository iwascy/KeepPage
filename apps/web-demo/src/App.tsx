import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import type { AuthUser, Bookmark, Folder, QualityGrade, QualityReport, Tag } from "@keeppage/domain";
import {
  ApiError,
  type BookmarkDetailResult,
  type BookmarkViewerVersion,
  createFolder,
  createTag,
  createArchiveObjectUrl,
  deleteFolder,
  deleteTag,
  fetchBookmarkDetail,
  fetchBookmarks,
  fetchCurrentUser,
  fetchFolders,
  fetchTags,
  loginAccount,
  registerAccount,
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
  | { page: "imports-detail"; taskId: string };

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
  | { kind: "create-folder"; parent?: Folder }
  | { kind: "edit-folder"; folder: Folder }
  | { kind: "delete-folder"; folder: Folder }
  | { kind: "create-tag" }
  | { kind: "edit-tag"; tag: Tag }
  | { kind: "delete-tag"; tag: Tag };

const AUTH_TOKEN_STORAGE_KEY = "keeppage.auth-token";

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

function folderDepth(path: string) {
  return Math.max(0, path.split("/").length - 1);
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

function buildFolderPreviewPath(name: string, parentPath?: string | null) {
  const normalizedName = name.trim() || "新收藏夹";
  return parentPath ? `${parentPath}/${normalizedName}` : normalizedName;
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.25 9.75 4.5 11.5a2.12 2.12 0 0 1-3-3l2.25-2.25a2.12 2.12 0 0 1 3 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path
        d="m9.75 6.25 1.75-1.75a2.12 2.12 0 1 1 3 3l-2.25 2.25a2.12 2.12 0 0 1-3 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path
        d="m5.75 10.25 4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path
        d="M8 4.8v3.45l2.2 1.35"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
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
}: {
  bookmark: Bookmark;
  onOpen: (bookmarkId: string) => void;
}) {
  const [coverImageFailed, setCoverImageFailed] = useState(false);

  useEffect(() => {
    setCoverImageFailed(false);
  }, [bookmark.id, bookmark.coverImageUrl]);

  const summary = summarizeBookmark(bookmark);
  const hasCoverImage = Boolean(bookmark.coverImageUrl) && !coverImageFailed;
  const hasPreview = hasCoverImage || (bookmark.latestQuality?.archiveSignals.screenshotGenerated ?? false);
  const folderLabel = bookmark.folder?.name ?? "未归类";
  const coverTone = homeCoverTone(bookmark.domain);

  return (
    <article className={`home-bookmark-card${hasPreview ? " has-preview" : ""}`}>
      <button
        className="home-bookmark-hitarea"
        type="button"
        onClick={() => onOpen(bookmark.id)}
        aria-label={`打开归档：${bookmark.title}`}
      >
        {hasPreview ? (
          <div className={`home-bookmark-cover is-${coverTone}${hasCoverImage ? " has-image" : ""}`}>
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
            ) : null}
            <span className="home-bookmark-chip home-bookmark-chip-cover">{folderLabel}</span>
            {!hasCoverImage ? (
              <div className="home-bookmark-paper">
                <div className="home-bookmark-paper-lines">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="home-bookmark-body">
          {!hasPreview ? (
            <span className="home-bookmark-chip home-bookmark-chip-inline">{folderLabel}</span>
          ) : null}
          <h2>{bookmark.title}</h2>
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

function HomeBookmarkSkeleton({
  withPreview,
}: {
  withPreview: boolean;
}) {
  return (
    <article className={`home-bookmark-card home-bookmark-card-skeleton${withPreview ? " has-preview" : ""}`}>
      <div className="home-bookmark-hitarea is-skeleton">
        {withPreview ? <div className="home-skeleton-cover" /> : null}
        <div className="home-bookmark-body">
          {!withPreview ? <span className="home-skeleton-chip" /> : null}
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
  folders,
  tags,
  selectedFolderId,
  selectedTagId,
  searchInput,
  onSearchChange,
  managerBusy,
  onSelectFolder,
  onSelectTag,
  onCreateRootFolder,
  onCreateTag,
  onOpenImportNew,
  onOpenImportHistory,
  onLogout,
  children,
  logoutLabel = "退出登录",
}: {
  user: AuthUser;
  items: Bookmark[];
  folders: Folder[];
  tags: Tag[];
  selectedFolderId: string;
  selectedTagId: string;
  searchInput: string;
  onSearchChange: (value: string) => void;
  managerBusy: boolean;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tagId: string) => void;
  onCreateRootFolder: () => void;
  onCreateTag: () => void;
  onOpenImportNew: () => void;
  onOpenImportHistory: () => void;
  onLogout: () => void;
  children: ReactNode;
  logoutLabel?: string;
}) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());

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
      for (const item of items) {
        const folderId = item.folder?.id;
        if (folderId && descendantIds.has(folderId)) {
          count += 1;
        }
      }
      mapping.set(folder.id, count);
    }
    return mapping;
  }, [descendantIdsByFolder, items, sortedFolders]);

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
        <div className="home-brand">
          <div className="home-brand-mark">{userInitials(user).slice(0, 1)}</div>
          <div>
            <h1>KeepPage</h1>
            <p>Your Archive Space</p>
          </div>
        </div>

        <label className="home-search">
          <span className="home-search-icon" aria-hidden="true" />
          <input
            className="home-search-input"
            type="search"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索标题、域名、标签..."
          />
        </label>

        <section className="home-sidebar-section">
          <header className="home-sidebar-section-head">
            <span>Collections</span>
            <button className="home-section-action" type="button" onClick={onCreateRootFolder} disabled={managerBusy}>
              新建
            </button>
          </header>
          <div className="home-folder-list">
            <div className="home-folder-row">
              <button
                className={selectedFolderId ? "home-folder-main" : "home-folder-main is-active"}
                type="button"
                onClick={() => onSelectFolder("")}
              >
                <span className="home-folder-name">全部归档</span>
                <span className="home-folder-count">{items.length}</span>
              </button>
              <span className="home-folder-toggle-spacer" aria-hidden="true" />
            </div>
            {visibleFolderRows.map(({ folder, depth, hasChildren }) => (
              <div className="home-folder-row" key={folder.id}>
                <button
                  className={[
                    "home-folder-main",
                    selectedFolderId === folder.id ? "is-active" : "",
                    depth > 0 ? "is-child" : "",
                  ].filter(Boolean).join(" ")}
                  type="button"
                  style={{ paddingLeft: `${12 + depth * 14}px` }}
                  onClick={() => onSelectFolder(selectedFolderId === folder.id ? "" : folder.id)}
                >
                  <span className="home-folder-name">{folder.name}</span>
                  <span className="home-folder-count">{folderCounts.get(folder.id) ?? 0}</span>
                </button>
                {hasChildren ? (
                  <button
                    className={
                      collapsedFolderIds.has(folder.id)
                        ? "home-folder-toggle is-collapsed"
                        : "home-folder-toggle"
                    }
                    type="button"
                    onClick={() => handleToggleFolder(folder)}
                    aria-label={`${collapsedFolderIds.has(folder.id) ? "展开" : "收起"} ${folder.name}`}
                  >
                    ▾
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
            <button className="home-section-action" type="button" onClick={onCreateTag} disabled={managerBusy}>
              新建
            </button>
          </header>
          <div className="home-tag-list">
            {tags.map((tag) => {
              const active = selectedTagId === tag.id;
              return (
                <button
                  key={tag.id}
                  className={active ? "home-tag-chip is-active" : "home-tag-chip"}
                  type="button"
                  onClick={() => onSelectTag(active ? "" : tag.id)}
                >
                  #{tag.name}
                </button>
              );
            })}
          </div>
        </section>

        <div className="home-sidebar-footer">
          <button className="home-cta-button" type="button" onClick={onOpenImportNew}>
            + 新建导入
          </button>
          <div className="home-sidebar-links">
            <button className="home-sidebar-link" type="button" onClick={onOpenImportHistory}>
              导入历史
            </button>
            <button className="home-sidebar-link" type="button" onClick={onLogout}>
              {logoutLabel}
            </button>
          </div>
        </div>
      </aside>

      <div className="home-shell">
        <header className="home-topbar">
          <div className="home-profile">
            <div className="home-profile-copy">
              <strong>{displayName}</strong>
            </div>
            <div className="home-avatar">{userInitials(user)}</div>
          </div>
        </header>

        <section className="home-content">
          {children}
        </section>
      </div>
    </main>
  );
}

function HomePage({
  items,
  loadState,
  listError,
  hasActiveFilters,
  managerBusy,
  managerFeedback,
  folders,
  tags,
  selectedFolderId,
  selectedTagId,
  onSelectFolder,
  onSelectTag,
  onOpenBookmark,
  onCreateRootFolder,
  onCreateChildFolder,
  onEditFolderPath,
  onDeleteFolder,
  onCreateTag,
  onEditTag,
  onDeleteTag,
}: {
  items: Bookmark[];
  loadState: LoadState;
  listError: string | null;
  hasActiveFilters: boolean;
  managerBusy: boolean;
  managerFeedback: InlineFeedback | null;
  folders: Folder[];
  tags: Tag[];
  selectedFolderId: string;
  selectedTagId: string;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tagId: string) => void;
  onOpenBookmark: (bookmarkId: string) => void;
  onCreateRootFolder: () => void;
  onCreateChildFolder: (folder: Folder) => void;
  onEditFolderPath: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onCreateTag: () => void;
  onEditTag: (tag: Tag) => void;
  onDeleteTag: (tag: Tag) => void;
}) {
  const showLoading = loadState === "loading";
  const showError = loadState === "error";
  const showEmpty = !showLoading && !showError && items.length === 0;

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
            <HomeBookmarkSkeleton key={index} withPreview={index % 3 !== 1} />
          ))}
        </section>
      ) : showError ? (
        <section className="home-empty-panel">
          <h2>归档列表加载失败</h2>
          <p>{listError ?? "暂时无法读取当前账号的归档列表。"}</p>
        </section>
      ) : showEmpty ? (
        <section className="home-empty-panel">
          <h2>{hasActiveFilters ? "当前筛选下没有匹配的归档" : "还没有归档记录"}</h2>
          <p>{hasActiveFilters ? "换个关键词，或者切换收藏夹和标签试试。" : "扩展同步的网页归档会优先显示在这里。"}</p>
        </section>
      ) : (
        <section className="home-grid">
          {items.map((bookmark) => (
            <HomeBookmarkCard key={bookmark.id} bookmark={bookmark} onOpen={onOpenBookmark} />
          ))}
        </section>
      )}

      <details className="home-manager">
        <summary>高级管理</summary>
        <div className="home-manager-body">
          <p className="home-manager-note">需要新建子收藏夹、改路径、删除标签时，在这里处理。</p>
          <LibraryManager
            folders={folders}
            tags={tags}
            selectedFolderId={selectedFolderId}
            selectedTagId={selectedTagId}
            busy={managerBusy}
            feedback={null}
            onSelectFolderFilter={onSelectFolder}
            onSelectTagFilter={onSelectTag}
            onCreateRootFolder={onCreateRootFolder}
            onCreateChildFolder={onCreateChildFolder}
            onEditFolderPath={onEditFolderPath}
            onDeleteFolder={onDeleteFolder}
            onCreateTag={onCreateTag}
            onEditTag={onEditTag}
            onDeleteTag={onDeleteTag}
          />
        </div>
      </details>

      <footer className="home-footer">
        <span>Privacy</span>
        <span>Terms</span>
        <span>Support</span>
        <span>KeepPage</span>
      </footer>
    </>
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

  const isDeleteDialog = state.kind === "delete-folder" || state.kind === "delete-tag";
  const isFolderDialog = state.kind === "create-folder" || state.kind === "edit-folder" || state.kind === "delete-folder";
  const isTagDialog = state.kind === "create-tag" || state.kind === "edit-tag" || state.kind === "delete-tag";
  const tagColor = colorValue.trim();

  let title = "";
  let description = "";
  let eyebrow = "";
  let submitLabel = "";

  if (state.kind === "create-folder") {
    eyebrow = state.parent ? "New Child Folder" : "New Folder";
    title = state.parent ? "给当前目录加一个新分支" : "新建一个收藏夹";
    description = state.parent
      ? `会创建在“${state.parent.path}”下面，适合继续往下分层。`
      : "给归档库起一个清晰入口，后续筛选和整理都会轻松很多。";
    submitLabel = "创建收藏夹";
  } else if (state.kind === "edit-folder") {
    eyebrow = "Edit Folder Path";
    title = "调整收藏夹路径";
    description = "直接改完整路径，系统会自动识别父级并把它移动到正确位置。";
    submitLabel = "保存路径";
  } else if (state.kind === "delete-folder") {
    eyebrow = "Delete Folder";
    title = "确认删除这个收藏夹";
    description = "它自己会被删除，子收藏夹会上移一层，当前文件夹下的网页会解除归档。";
    submitLabel = "删除收藏夹";
  } else if (state.kind === "create-tag") {
    eyebrow = "New Tag";
    title = "新建一个标签";
    description = "做一个好记的主题标签，后续筛选、批量整理都会更顺手。";
    submitLabel = "创建标签";
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
      className="manager-dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="manager-dialog-title"
        aria-modal="true"
        className={isDeleteDialog ? "manager-dialog is-danger" : "manager-dialog"}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
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

        {isDeleteDialog ? (
          <>
            <section className="manager-dialog-hero">
              <div className={isFolderDialog ? "manager-dialog-mark is-folder" : "manager-dialog-mark is-tag"}>
                {isFolderDialog ? "DIR" : "TAG"}
              </div>
              <div className="manager-dialog-hero-copy">
                <strong>
                  {state.kind === "delete-folder" ? state.folder.path : `#${state.tag.name}`}
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
          <form className="manager-dialog-form" onSubmit={onSubmit}>
            <section className="manager-dialog-hero">
              <div className={isFolderDialog ? "manager-dialog-mark is-folder" : "manager-dialog-mark is-tag"}>
                {isFolderDialog ? "DIR" : "TAG"}
              </div>
              <div className="manager-dialog-hero-copy">
                <strong>
                  {state.kind === "create-folder"
                    ? buildFolderPreviewPath(nameValue, state.parent?.path)
                    : state.kind === "edit-folder"
                      ? (pathValue.trim() || state.folder.path)
                      : `#${nameValue.trim() || "新标签"}`}
                </strong>
                <span>
                  {state.kind === "create-folder"
                    ? (state.parent ? "会自动挂到当前父级下面。" : "会作为新的根目录出现。")
                    : state.kind === "edit-folder"
                      ? "完整路径支持多层结构，例如：工作/研究/案例。"
                      : "先预览一下最终效果，不满意可以继续改。"}
                </span>
              </div>
            </section>

            {state.kind === "create-folder" ? (
              <label className="field">
                <span>收藏夹名称</span>
                <input
                  autoFocus
                  maxLength={120}
                  placeholder={state.parent ? "例如：灵感池" : "例如：工作台"}
                  value={nameValue}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </label>
            ) : null}

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

            {state.kind === "create-tag" || state.kind === "edit-tag" ? (
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
        )}
      </div>
    </div>
  );
}

function LibraryManager({
  folders,
  tags,
  selectedFolderId,
  selectedTagId,
  busy,
  feedback,
  onSelectFolderFilter,
  onSelectTagFilter,
  onCreateRootFolder,
  onCreateChildFolder,
  onEditFolderPath,
  onDeleteFolder,
  onCreateTag,
  onEditTag,
  onDeleteTag,
}: {
  folders: Folder[];
  tags: Tag[];
  selectedFolderId: string;
  selectedTagId: string;
  busy: boolean;
  feedback: InlineFeedback | null;
  onSelectFolderFilter: (folderId: string) => void;
  onSelectTagFilter: (tagId: string) => void;
  onCreateRootFolder: () => void;
  onCreateChildFolder: (parent: Folder) => void;
  onEditFolderPath: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onCreateTag: () => void;
  onEditTag: (tag: Tag) => void;
  onDeleteTag: (tag: Tag) => void;
}) {
  return (
    <>
      <section className="library-manager">
        <article className="manager-card">
          <div className="panel-header-inline">
            <div>
              <p className="eyebrow">Folders</p>
              <h2 className="manager-title">多层收藏夹</h2>
            </div>
            <button className="secondary-button" type="button" onClick={onCreateRootFolder} disabled={busy}>
              新建收藏夹
            </button>
          </div>
          <p className="detail-note">删除当前收藏夹时会保留子收藏夹，并自动上移一层。</p>
          <div className="folder-list">
            {folders.length > 0 ? (
              folders.map((folder) => (
                <article className="folder-row" key={folder.id} style={{ paddingLeft: `${folderDepth(folder.path) * 18}px` }}>
                  <div className="folder-row-main">
                    <strong>{folder.name}</strong>
                    <span>{folder.path}</span>
                  </div>
                  <div className="folder-row-actions">
                    <button
                      className={selectedFolderId === folder.id ? "primary-button compact-button" : "secondary-button compact-button"}
                      type="button"
                      onClick={() => onSelectFolderFilter(selectedFolderId === folder.id ? "" : folder.id)}
                      disabled={busy}
                    >
                      {selectedFolderId === folder.id ? "取消筛选" : "筛选"}
                    </button>
                    <button className="ghost-button compact-button" type="button" onClick={() => onCreateChildFolder(folder)} disabled={busy}>
                      子收藏夹
                    </button>
                    <button className="ghost-button compact-button" type="button" onClick={() => onEditFolderPath(folder)} disabled={busy}>
                      改路径
                    </button>
                    <button className="ghost-button compact-button danger-button" type="button" onClick={() => onDeleteFolder(folder)} disabled={busy}>
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="detail-note">还没有收藏夹，先建一个根目录也可以。</p>
            )}
          </div>
        </article>

        <article className="manager-card">
          <div className="panel-header-inline">
            <div>
              <p className="eyebrow">Tags</p>
              <h2 className="manager-title">标签管理</h2>
            </div>
            <button className="secondary-button" type="button" onClick={onCreateTag} disabled={busy}>
              新建标签
            </button>
          </div>
          <div className="tag-manager-list">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <article className="tag-manager-row" key={tag.id}>
                  <div className="tag-manager-main">
                    <span className="tag">
                      #{tag.name}
                      {tag.color ? <small>{tag.color}</small> : null}
                    </span>
                  </div>
                  <div className="folder-row-actions">
                    <button
                      className={selectedTagId === tag.id ? "primary-button compact-button" : "secondary-button compact-button"}
                      type="button"
                      onClick={() => onSelectTagFilter(selectedTagId === tag.id ? "" : tag.id)}
                      disabled={busy}
                    >
                      {selectedTagId === tag.id ? "取消筛选" : "筛选"}
                    </button>
                    <button className="ghost-button compact-button" type="button" onClick={() => onEditTag(tag)} disabled={busy}>
                      编辑
                    </button>
                    <button className="ghost-button compact-button danger-button" type="button" onClick={() => onDeleteTag(tag)} disabled={busy}>
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="detail-note">还没有标签，先建几个常用主题会更方便筛选。</p>
            )}
          </div>
        </article>
      </section>
      {feedback ? (
        <p className={feedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
          {feedback.message}
        </p>
      ) : null}
    </>
  );
}

function AuthPanel({
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
              placeholder="邮箱"
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={isRegister ? "密码（至少 8 位）" : "密码"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
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
  metadataNote,
  metadataFolderId,
  metadataTagIds,
  metadataSaving,
  metadataFeedback,
  onMetadataNoteChange,
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
  metadataNote: string;
  metadataFolderId: string;
  metadataTagIds: string[];
  metadataSaving: boolean;
  metadataFeedback: InlineFeedback | null;
  onMetadataNoteChange: (value: string) => void;
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

  return (
    <section className="detail-shell">
      <aside className="detail-panel">
        <button className="ghost-button" type="button" onClick={goToList}>
          ← 返回列表
        </button>

        <div className="detail-block">
          <h2 className="detail-title">{detail.bookmark.title}</h2>
          <a className="url" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
            {detail.bookmark.sourceUrl}
          </a>
        </div>

        <div className="detail-block compact-gap">
          <div className="panel-header-inline">
            <p className="panel-title">编辑</p>
            <button className="primary-button compact-button" type="button" onClick={onMetadataSave} disabled={metadataSaving}>
              {metadataSaving ? "保存中..." : "保存"}
            </button>
          </div>
          <label className="field">
            <textarea
              value={metadataNote}
              onChange={(event) => onMetadataNoteChange(event.target.value)}
              rows={3}
              placeholder="备注"
            />
          </label>
          <label className="field">
            <select value={metadataFolderId} onChange={(event) => onMetadataFolderChange(event.target.value)}>
              <option value="">未归档</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </label>
          {tags.length > 0 ? (
            <div className="tag-selector">
              {tags.map((tag) => {
                const checked = metadataTagIds.includes(tag.id);
                return (
                  <label className={checked ? "tag-check is-active" : "tag-check"} key={tag.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onMetadataTagToggle(tag.id)}
                    />
                    <span>#{tag.name}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {metadataFeedback ? (
            <p className={metadataFeedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
              {metadataFeedback.message}
            </p>
          ) : null}
        </div>

        <div className="detail-block">
          <div className="detail-meta-row">
            <span>创建</span>
            <strong>{formatWhen(detail.bookmark.createdAt)}</strong>
          </div>
          <div className="detail-meta-row">
            <span>更新</span>
            <strong>{formatWhen(detail.bookmark.updatedAt)}</strong>
          </div>
          <div className="detail-meta-row">
            <span>体积</span>
            <strong>{formatFileSize(displayedArchiveSize)}</strong>
          </div>
        </div>

        <div className="detail-block">
          <div className="panel-header-inline">
            <p className="panel-title">版本</p>
            <span className="panel-subtle">{detail.versions.length}</span>
          </div>
          <div className="version-list">
            {detail.versions.map((version) => {
              const active = version.id === selectedVersion.id;
              return (
                <button
                  key={version.id}
                  className={`version-item${active ? " is-active" : ""}`}
                  type="button"
                  onClick={() => openBookmark(detail.bookmark.id, version.id)}
                >
                  <strong>v{version.versionNo}</strong>
                  <span>{formatWhen(version.createdAt)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <details className="detail-quality-toggle">
          <summary>质量报告 · {quality.score}分</summary>
          <div className="detail-block compact-gap">
            <div className="signal-grid">
              <article className="signal-card">
                <span>文本保留</span>
                <strong>
                  {retentionLabel(
                    quality.archiveSignals.textLength,
                    quality.liveSignals.textLength,
                  )}
                </strong>
              </article>
              <article className="signal-card">
                <span>图片保留</span>
                <strong>
                  {retentionLabel(
                    quality.archiveSignals.imageCount,
                    quality.liveSignals.imageCount,
                  )}
                </strong>
              </article>
            </div>
            {quality.reasons.length > 0 ? (
              <div className="reason-list">
                {quality.reasons.map((reason) => (
                  <article className="reason-card" key={`${selectedVersion.id}-${reason.code}`}>
                    <strong>{reason.code}</strong>
                    <p>{reason.message}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="detail-note">无质量告警。</p>
            )}
          </div>
        </details>
      </aside>

      <section className="detail-preview-panel">
        <header className="preview-header">
          <div className="preview-controls">
            <div className="preview-mode-switch" role="tablist" aria-label="归档预览模式">
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
            {previewFallbackMessage ? (
              <p className="preview-mode-note">{previewFallbackMessage}</p>
            ) : null}
          </div>
          <div className="preview-actions">
            <a className="secondary-button" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              原网页
            </a>
            {previewState.status === "ready" && activePreviewMode ? (
              <a
                className="primary-button"
                href={previewState.url}
                download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}-${activePreviewMode === "reader" ? "reader" : "original"}.html`}
              >
                下载{previewModeLabel(activePreviewMode)}
              </a>
            ) : null}
          </div>
        </header>

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
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [items, setItems] = useState<Bookmark[]>([]);
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
  const [metadataFolderId, setMetadataFolderId] = useState("");
  const [metadataTagIds, setMetadataTagIds] = useState<string[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataFeedback, setMetadataFeedback] = useState<InlineFeedback | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);
  const authToken = session.status === "authenticated" ? session.token : null;
  const logoutLabel = isDemoMode ? "重置 Mock 数据" : "退出登录";
  const isManagerDialogVisible = isManagerDialogOpen(managerDialog);

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
      setFolders([]);
      setTags([]);
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
      setManagerDialogError(null);
      setMetadataFeedback(null);
    });
  }

  function closeManagerDialog() {
    setManagerDialog({ kind: "closed" });
    setManagerDialogError(null);
  }

  function openManagerDialog(nextState: ManagerDialogState) {
    setManagerDialog(nextState);
    setManagerDialogError(null);
  }

  function handleProtectedApiError(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      logout(error.message);
      return true;
    }
    return false;
  }

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
  }, [authToken, deferredSearch, demoState, isDemoMode, qualityFilter, selectedFolderId, selectedTagId]);

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
      setMetadataFolderId("");
      setMetadataTagIds([]);
      setMetadataFeedback(null);
      return;
    }
    setMetadataNote(detail.bookmark.note);
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
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        });
        setDemoState(result.workspace);
        setMetadataFeedback({
          kind: "success",
          message: "Mock 数据中的书签元数据已更新。",
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
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        },
        authToken,
      );
      await refreshBookmarksList(authToken);
      await refreshBookmarkDetail(authToken, updated.id);
      setMetadataFeedback({
        kind: "success",
        message: "书签的收藏夹、标签和备注已经保存。",
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

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
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
        folders={folders}
        tags={tags}
        selectedFolderId={selectedFolderId}
        selectedTagId={selectedTagId}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        managerBusy={managerBusy}
        onSelectFolder={setSelectedFolderId}
        onSelectTag={setSelectedTagId}
        onCreateRootFolder={() => openManagerDialog({ kind: "create-folder" })}
        onCreateTag={() => openManagerDialog({ kind: "create-tag" })}
        onOpenImportNew={goToImportNew}
        onOpenImportHistory={goToImportList}
        onLogout={() => logout()}
        logoutLabel={logoutLabel}
      >
        {route.page === "list" ? (
          <HomePage
            items={items}
            loadState={loadState}
            listError={listError}
            hasActiveFilters={Boolean(searchInput.trim() || qualityFilter !== "all" || selectedFolderId || selectedTagId)}
            managerBusy={managerBusy}
            managerFeedback={managerFeedback}
            folders={folders}
            tags={tags}
            selectedFolderId={selectedFolderId}
            selectedTagId={selectedTagId}
            onSelectFolder={setSelectedFolderId}
            onSelectTag={setSelectedTagId}
            onOpenBookmark={openBookmark}
            onCreateRootFolder={() => openManagerDialog({ kind: "create-folder" })}
            onCreateChildFolder={(folder) => openManagerDialog({ kind: "create-folder", parent: folder })}
            onEditFolderPath={(folder) => openManagerDialog({ kind: "edit-folder", folder })}
            onDeleteFolder={(folder) => openManagerDialog({ kind: "delete-folder", folder })}
            onCreateTag={() => openManagerDialog({ kind: "create-tag" })}
            onEditTag={(tag) => openManagerDialog({ kind: "edit-tag", tag })}
            onDeleteTag={(tag) => openManagerDialog({ kind: "delete-tag", tag })}
          />
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
          metadataNote={metadataNote}
          metadataFolderId={metadataFolderId}
          metadataTagIds={metadataTagIds}
          metadataSaving={metadataSaving}
          metadataFeedback={metadataFeedback}
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
    </>
  );
}
