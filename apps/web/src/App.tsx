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
import type { AuthUser, Bookmark, QualityGrade, QualityReport } from "@keeppage/domain";
import {
  ApiError,
  type BookmarkDetailResult,
  type BookmarkViewerVersion,
  createArchiveObjectUrl,
  fetchBookmarkDetail,
  fetchBookmarks,
  fetchCurrentUser,
  loginAccount,
  registerAccount,
} from "./api";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready" | "error";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type AuthMode = "login" | "register";
type ViewRoute =
  | { page: "list" }
  | { page: "detail"; bookmarkId: string; versionId?: string };

type SessionState =
  | { status: "booting"; token: null; user: null; error: string | null }
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

type ArchivePreviewState =
  | { status: "idle"; url?: undefined; error?: undefined }
  | { status: "loading"; url?: undefined; error?: undefined }
  | { status: "ready"; url: string; error?: undefined }
  | { status: "error"; url?: undefined; error: string };

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

function BookmarkCard({
  bookmark,
  onOpen,
}: {
  bookmark: Bookmark;
  onOpen: (bookmarkId: string) => void;
}) {
  const summary = summarizeBookmark(bookmark);
  const hasPreview = bookmark.latestQuality?.archiveSignals.screenshotGenerated ?? false;
  const openDetail = () => onOpen(bookmark.id);

  return (
    <article className="bookmark-card">
      <div
        className="bookmark-card-hitarea"
        role="button"
        tabIndex={0}
        aria-label={`打开归档：${bookmark.title}`}
        onClick={openDetail}
        onKeyDown={(event) => handleCardKeyDown(event, openDetail)}
      >
        <span className="bookmark-card-accent" aria-hidden="true" />
        <h2 className="bookmark-card-title">{bookmark.title}</h2>
        <div className="bookmark-card-summary">
          {hasPreview ? (
            <div className="bookmark-card-media" aria-hidden="true">
              <span>{getDomainMonogram(bookmark.domain)}</span>
            </div>
          ) : null}
          <p className="bookmark-card-description">{summary}</p>
        </div>
        <footer className="bookmark-card-footer">
          <a
            className="bookmark-card-domain"
            href={bookmark.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <LinkIcon />
            <span>{bookmark.domain}</span>
          </a>
          <span className="bookmark-card-time">
            <ClockIcon />
            <span>{formatRelativeWhen(bookmark.updatedAt)}</span>
          </span>
        </footer>
      </div>
    </article>
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
        <p className="eyebrow">KeepPage Account</p>
        <h1>{isRegister ? "注册你的归档空间" : "登录 KeepPage"}</h1>
        <p className="subtitle">
          {isRegister
            ? "注册后，每个账号会拥有独立的网页归档列表、详情和版本记录。"
            : "登录后才能查看自己的归档，并继续让扩展把页面同步到当前账号。"}
        </p>

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
              <span>昵称</span>
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="给自己起个名字，可选"
              />
            </label>
          ) : null}
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={isRegister ? "至少 8 位" : "输入密码"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : isRegister ? "注册并进入工作台" : "登录进入工作台"}
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
}: {
  detail: BookmarkDetailResult;
  selectedVersion: BookmarkViewerVersion;
  previewState: ArchivePreviewState;
}) {
  const quality: QualityReport = selectedVersion.quality;

  return (
    <section className="detail-shell">
      <aside className="detail-panel">
        <button className="ghost-button" type="button" onClick={goToList}>
          ← 返回列表
        </button>
        <div className="detail-block">
          <p className="eyebrow">Archive Detail</p>
          <h2 className="detail-title">{detail.bookmark.title}</h2>
          <a className="url" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
            {detail.bookmark.sourceUrl}
          </a>
          <p className="detail-note">{detail.bookmark.note || "暂无备注。"}</p>
        </div>

        <div className="detail-block">
          <div className="detail-meta-row">
            <span>文件夹</span>
            <strong>{detail.bookmark.folder?.path ?? "未归档文件夹"}</strong>
          </div>
          <div className="detail-meta-row">
            <span>创建时间</span>
            <strong>{formatWhen(detail.bookmark.createdAt)}</strong>
          </div>
          <div className="detail-meta-row">
            <span>更新时间</span>
            <strong>{formatWhen(detail.bookmark.updatedAt)}</strong>
          </div>
        </div>

        <div className="detail-block">
          <p className="panel-title">标签</p>
          <div className="tags">
            {detail.bookmark.tags.length > 0 ? (
              detail.bookmark.tags.map((tag) => (
                <span className="tag" key={tag.id}>
                  #{tag.name}
                </span>
              ))
            ) : (
              <span className="tag muted-tag">#未打标签</span>
            )}
          </div>
        </div>

        <div className="detail-block">
          <div className="panel-header-inline">
            <p className="panel-title">版本列表</p>
            <span className="panel-subtle">共 {detail.versions.length} 个版本</span>
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
                  <div>
                    <strong>v{version.versionNo}</strong>
                    <span>{formatWhen(version.createdAt)}</span>
                  </div>
                  <div>
                    <span className={qualityClass(version.quality.grade)}>
                      {qualityLabel(version.quality.grade)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="detail-preview-panel">
        <header className="preview-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h3>归档预览 · v{selectedVersion.versionNo}</h3>
          </div>
          <div className="preview-actions">
            <a className="secondary-button" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              打开原网页
            </a>
            {previewState.status === "ready" ? (
              <a
                className="primary-button"
                href={previewState.url}
                download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}.html`}
              >
                下载归档 HTML
              </a>
            ) : null}
          </div>
        </header>

        {!selectedVersion.archiveAvailable ? (
          <section className="empty-state preview-empty">
            <h2>当前版本缺少真实归档对象</h2>
            <p>版本元数据已经存在，但 `archive.html` 目前不可读，因此不展示预览。</p>
          </section>
        ) : previewState.status === "loading" ? (
          <section className="loading preview-empty">正在拉取归档 HTML...</section>
        ) : previewState.status === "error" ? (
          <section className="empty-state preview-empty">
            <h2>归档对象加载失败</h2>
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
        <div className="detail-block compact-gap">
          <div className="panel-header-inline">
            <p className="panel-title">质量概览</p>
            <span className={qualityClass(quality.grade)}>{qualityLabel(quality.grade)}</span>
          </div>
          <div className="score-card">
            <strong>{quality.score}</strong>
            <span>质量分 / 100</span>
          </div>
          <div className="detail-meta-row">
            <span>Capture Profile</span>
            <strong>{selectedVersion.captureProfile}</strong>
          </div>
          <div className="detail-meta-row">
            <span>对象状态</span>
            <strong>{selectedVersion.archiveAvailable ? "可读取" : "缺失"}</strong>
          </div>
          <div className="detail-meta-row">
            <span>归档体积</span>
            <strong>{formatFileSize(selectedVersion.archiveSizeBytes ?? quality.archiveSignals.fileSize)}</strong>
          </div>
          <div className="detail-meta-row">
            <span>对象键</span>
            <code className="inline-code">{selectedVersion.htmlObjectKey}</code>
          </div>
        </div>

        <div className="detail-block compact-gap">
          <p className="panel-title">质量诊断</p>
          {quality.reasons.length > 0 ? (
            <div className="reason-list">
              {quality.reasons.map((reason) => (
                <article className="reason-card" key={`${selectedVersion.id}-${reason.code}`}>
                  <strong>{reason.code}</strong>
                  <p>{reason.message}</p>
                  <span>影响分：-{reason.impact}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="detail-note">当前版本没有明显质量告警。</p>
          )}
        </div>

        <div className="detail-block compact-gap">
          <p className="panel-title">信号摘要</p>
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
            <article className="signal-card">
              <span>iframe</span>
              <strong>
                {quality.archiveSignals.iframeCount} / {quality.liveSignals.iframeCount}
              </strong>
            </article>
            <article className="signal-card">
              <span>正文长度</span>
              <strong>{quality.archiveSignals.textLength.toLocaleString()}</strong>
            </article>
          </div>
        </div>
      </aside>
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
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
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
      setDetail(null);
      setLoadState("idle");
      setListError(null);
      setDetailLoadState("idle");
      setDetailError(null);
      setArchivePreview({ status: "idle" });
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
  }, [authToken, deferredSearch, qualityFilter]);

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

  const summary = useMemo(() => {
    const high = items.filter((item) => item.latestQuality?.grade === "high").length;
    const medium = items.filter((item) => item.latestQuality?.grade === "medium").length;
    const low = items.filter((item) => item.latestQuality?.grade === "low").length;
    return { total: items.length, high, medium, low };
  }, [items]);

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

  const isDetailRoute = route.page === "detail";

  return (
    <main className={`page-shell${isDetailRoute ? " is-detail-route" : ""}`}>
      <div className="texture" />
      <section className={`topbar${isDetailRoute ? " is-detail-route" : ""}`}>
        <div>
          <p className="eyebrow">KeepPage Workspace</p>
          <h1>{route.page === "detail" ? "归档查看页" : "网页归档工作台"}</h1>
          <p className="subtitle">
            {route.page === "detail"
              ? "查看主档、切换版本，并直接核对质量诊断与 archive.html 是否真实可读。"
              : "每个账号独立保存自己的网页归档、版本和详情预览。"}
          </p>
        </div>
        <div className="topbar-actions">
          <div className="user-chip">
            <strong>{session.user.name || session.user.email}</strong>
            <span>{session.user.email}</span>
          </div>
          <div className="sync-badge">
            数据源：<b>实时 API</b>
          </div>
          <button className="ghost-button" type="button" onClick={() => logout()}>
            退出登录
          </button>
        </div>
      </section>

      {route.page === "list" ? (
        <>
          <section className="control-panel">
            <label className="field">
              <span>搜索</span>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="标题、域名、标签、备注、文件夹"
              />
            </label>
            <label className="field">
              <span>质量</span>
              <select
                value={qualityFilter}
                onChange={(event) => setQualityFilter(event.target.value as QualityFilter)}
              >
                <option value="all">全部</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
          </section>

          <section className="summary">
            <article className="metric">
              <p>总归档数</p>
              <h3>{summary.total}</h3>
            </article>
            <article className="metric">
              <p>高质量</p>
              <h3>{summary.high}</h3>
            </article>
            <article className="metric">
              <p>中质量</p>
              <h3>{summary.medium}</h3>
            </article>
            <article className="metric">
              <p>低质量</p>
              <h3>{summary.low}</h3>
            </article>
          </section>

          {loadState === "loading" || isPending ? (
            <section className="loading">正在刷新归档列表...</section>
          ) : loadState === "error" ? (
            <EmptyState
              mode="empty"
              title="归档列表加载失败"
              description={listError ?? "暂时无法读取当前账号的归档列表。"}
            />
          ) : items.length === 0 ? (
            <EmptyState mode={searchInput.trim() || qualityFilter !== "all" ? "search-empty" : "empty"} />
          ) : (
            <section className="card-grid">
              {items.map((bookmark) => (
                <BookmarkCard key={bookmark.id} bookmark={bookmark} onOpen={openBookmark} />
              ))}
            </section>
          )}
        </>
      ) : detailLoadState === "loading" || isPending ? (
        <section className="loading">正在加载归档详情...</section>
      ) : detailLoadState === "error" ? (
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
      ) : detailLoadState === "not-found" || !detail || !selectedVersion ? (
        <EmptyState
          mode="missing-detail"
          action={
            <button className="primary-button" type="button" onClick={goToList}>
              返回列表
            </button>
          }
        />
      ) : (
        <DetailPanel detail={detail} selectedVersion={selectedVersion} previewState={archivePreview} />
      )}
    </main>
  );
}
