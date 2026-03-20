import {
  type FormEvent,
  type KeyboardEvent,
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
import { ImportDetailPanel, ImportHistoryPanel, ImportNewPanel } from "./imports";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready" | "error";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type AuthMode = "login" | "register";
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

function handleCardKeyDown(event: KeyboardEvent<HTMLElement>, onOpen: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onOpen();
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
  const summary = summarizeBookmark(bookmark);
  const hasPreview = bookmark.latestQuality?.archiveSignals.screenshotGenerated ?? false;
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
          <div className={`home-bookmark-cover is-${coverTone}`}>
            <span className="home-bookmark-chip home-bookmark-chip-cover">{folderLabel}</span>
            <div className="home-bookmark-paper">
              <div className="home-bookmark-paper-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
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
              退出登录
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
  onMetadataSave,
}: {
  detail: BookmarkDetailResult;
  selectedVersion: BookmarkViewerVersion;
  previewState: ArchivePreviewState;
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
  onMetadataSave: () => void;
}) {
  const quality: QualityReport = selectedVersion.quality;

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
            <strong>{formatFileSize(selectedVersion.archiveSizeBytes ?? quality.archiveSignals.fileSize)}</strong>
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
          <div className="preview-actions">
            <a className="secondary-button" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              原网页
            </a>
            {previewState.status === "ready" ? (
              <a
                className="primary-button"
                href={previewState.url}
                download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}.html`}
              >
                下载 HTML
              </a>
            ) : null}
          </div>
        </header>

        {!selectedVersion.archiveAvailable ? (
          <section className="empty-state preview-empty">
            <h2>归档对象不可用</h2>
            <p>版本元数据存在，但归档文件目前不可读。</p>
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

export function App() {
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
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerFeedback, setManagerFeedback] = useState<InlineFeedback | null>(null);
  const [metadataNote, setMetadataNote] = useState("");
  const [metadataFolderId, setMetadataFolderId] = useState("");
  const [metadataTagIds, setMetadataTagIds] = useState<string[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataFeedback, setMetadataFeedback] = useState<InlineFeedback | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);
  const authToken = session.status === "authenticated" ? session.token : null;

  function logout(message?: string) {
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
      setMetadataFeedback(null);
    });
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
  }, []);

  useEffect(() => {
    if (!authToken) {
      setFolders([]);
      setTags([]);
      setManagerFeedback(null);
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
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setItems([]);
      setLoadState("idle");
      setListError(null);
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
  }, [authToken, deferredSearch, qualityFilter, selectedFolderId, selectedTagId]);

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
  }, [authToken, route]);

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

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !selectedVersion?.archiveAvailable || !previewSourceUrl) {
      setArchivePreview({ status: "idle" });
      return;
    }

    setArchivePreview({ status: "loading" });
    createArchiveObjectUrl(
      authToken,
      selectedVersion.htmlObjectKey,
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
    previewSourceUrl,
    selectedVersion?.archiveAvailable,
    selectedVersion?.htmlObjectKey,
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
      return;
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

  async function handleCreateFolder(parent?: Folder) {
    const name = window.prompt(parent ? `新建 “${parent.path}” 下的子收藏夹` : "新建根收藏夹");
    if (!name?.trim()) {
      return;
    }

    await runManagerAction(async () => {
      const folder = await createFolder({
        name: name.trim(),
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已创建收藏夹：${folder.path}`;
    });
  }

  async function handleEditFolderPath(folder: Folder) {
    const nextPathInput = window.prompt("输入新的完整路径，例如：工作/研究", folder.path);
    if (!nextPathInput?.trim()) {
      return;
    }

    const nextPath = nextPathInput
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (nextPath.length === 0) {
      return;
    }

    const nextName = nextPath[nextPath.length - 1] ?? folder.name;
    const parentPath = nextPath.slice(0, -1).join("/");
    const parent = parentPath ? folders.find((item) => item.path === parentPath) : undefined;
    if (parentPath && !parent) {
      setManagerFeedback({
        kind: "error",
        message: `未找到父收藏夹路径：${parentPath}`,
      });
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
    const confirmed = window.confirm(
      `确认删除收藏夹“${folder.path}”？它自身会被删除，子收藏夹会自动上移一层，该文件夹下的网页会取消归档。`,
    );
    if (!confirmed) {
      return;
    }

    await runManagerAction(async () => {
      await deleteFolder(folder.id, authToken!);
      return `已删除收藏夹：${folder.path}`;
    });
  }

  async function handleCreateTag() {
    const name = window.prompt("新建标签名称");
    if (!name?.trim()) {
      return;
    }
    const color = window.prompt("可选：标签颜色说明（例如 blue、#1d4ed8）", "")?.trim() || undefined;

    await runManagerAction(async () => {
      const tag = await createTag({
        name: name.trim(),
        color,
      }, authToken!);
      return `已创建标签：#${tag.name}`;
    });
  }

  async function handleEditTag(tag: Tag) {
    const nextName = window.prompt("编辑标签名称", tag.name);
    if (!nextName?.trim()) {
      return;
    }
    const nextColorRaw = window.prompt("编辑标签颜色说明，留空表示清空", tag.color ?? "");
    if (nextColorRaw === null) {
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
    const confirmed = window.confirm(`确认删除标签“#${tag.name}”？已挂载到网页上的这个标签也会一起解除。`);
    if (!confirmed) {
      return;
    }

    await runManagerAction(async () => {
      await deleteTag(tag.id, authToken!);
      return `已删除标签：#${tag.name}`;
    });
  }

  async function handleSaveMetadata() {
    if (!authToken || route.page !== "detail") {
      return;
    }

    setMetadataSaving(true);
    setMetadataFeedback(null);
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
      onCreateRootFolder={() => void handleCreateFolder()}
      onCreateTag={() => void handleCreateTag()}
      onOpenImportNew={goToImportNew}
      onOpenImportHistory={goToImportList}
      onLogout={() => logout()}
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
          onCreateRootFolder={() => void handleCreateFolder()}
          onCreateChildFolder={(folder) => void handleCreateFolder(folder)}
          onEditFolderPath={(folder) => void handleEditFolderPath(folder)}
          onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
          onCreateTag={() => void handleCreateTag()}
          onEditTag={(tag) => void handleEditTag(tag)}
          onDeleteTag={(tag) => void handleDeleteTag(tag)}
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
          onMetadataSave={() => void handleSaveMetadata()}
        />
      ) : route.page === "imports-new" ? (
        <ImportNewPanel
          token={session.token}
          onApiError={handleProtectedApiError}
          onOpenHistory={goToImportList}
          onOpenTask={openImportTask}
        />
      ) : route.page === "imports-list" ? (
        <ImportHistoryPanel
          token={session.token}
          onApiError={handleProtectedApiError}
          onOpenTask={openImportTask}
          onOpenNew={goToImportNew}
        />
      ) : route.page === "imports-detail" ? (
        <ImportDetailPanel
          token={session.token}
          taskId={route.taskId}
          onApiError={handleProtectedApiError}
          onOpenHistory={goToImportList}
          onOpenBookmark={(bookmarkId) => openBookmark(bookmarkId)}
        />
      ) : null}
    </AppShell>
  );
}
