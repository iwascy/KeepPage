import { type ReactNode, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type { Bookmark, QualityGrade, QualityReport } from "@keeppage/domain";
import {
  type BookmarkDetailResult,
  type BookmarkViewerVersion,
  fetchBookmarkDetail,
  fetchBookmarks,
} from "./api";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found";
type ViewRoute =
  | { page: "list" }
  | { page: "detail"; bookmarkId: string; versionId?: string };

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

function BookmarkCard({ bookmark, onOpen }: { bookmark: Bookmark; onOpen: (bookmarkId: string) => void }) {
  return (
    <article className="bookmark-card">
      <header className="card-header">
        <p className="domain">{bookmark.domain}</p>
        <span className={qualityClass(bookmark.latestQuality?.grade)}>
          {qualityLabel(bookmark.latestQuality?.grade)}
        </span>
      </header>
      <h2 className="title">{bookmark.title}</h2>
      <a className="url" href={bookmark.sourceUrl} target="_blank" rel="noreferrer">
        {bookmark.sourceUrl}
      </a>
      <div className="meta-row">
        <span>{bookmark.versionCount} 个版本</span>
        <span>{bookmark.folder?.path ?? "未归档文件夹"}</span>
      </div>
      <div className="tags">
        {bookmark.tags.length > 0 ? (
          bookmark.tags.map((tag) => (
            <span className="tag" key={tag.id}>
              #{tag.name}
            </span>
          ))
        ) : (
          <span className="tag muted-tag">#未打标签</span>
        )}
      </div>
      <footer className="footer">
        <span>保存于：{formatWhen(bookmark.createdAt)}</span>
        <span>更新于：{formatWhen(bookmark.updatedAt)}</span>
      </footer>
      <button className="secondary-button card-action" type="button" onClick={() => onOpen(bookmark.id)}>
        查看归档
      </button>
    </article>
  );
}

function EmptyState({
  mode,
  action,
}: {
  mode: "empty" | "search-empty" | "missing-detail";
  action?: ReactNode;
}) {
  if (mode === "search-empty") {
    return (
      <section className="empty-state">
        <h2>没有匹配的归档</h2>
        <p>试试别的关键词，或者调整质量筛选条件。</p>
        {action}
      </section>
    );
  }
  if (mode === "missing-detail") {
    return (
      <section className="empty-state">
        <h2>没有找到这个归档</h2>
        <p>它可能还未同步完成，或者当前数据源里不存在该书签。</p>
        {action}
      </section>
    );
  }
  return (
    <section className="empty-state">
      <h2>还没有归档记录</h2>
      <p>当扩展开始同步后，你保存的页面会出现在这里。</p>
      {action}
    </section>
  );
}

function DetailPanel({
  detail,
  selectedVersion,
}: {
  detail: BookmarkDetailResult;
  selectedVersion: BookmarkViewerVersion;
}) {
  const quality: QualityReport = selectedVersion.quality;
  const previewUrl = selectedVersion.previewUrl ?? selectedVersion.downloadUrl;

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
            {previewUrl ? (
              <a
                className="primary-button"
                href={selectedVersion.downloadUrl ?? previewUrl}
                download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}.html`}
              >
                下载归档 HTML
              </a>
            ) : null}
          </div>
        </header>

        {selectedVersion.archiveAvailable && previewUrl ? (
          <iframe
            className="archive-frame"
            src={previewUrl}
            title={`${detail.bookmark.title} v${selectedVersion.versionNo}`}
          />
        ) : (
          <section className="empty-state preview-empty">
            <h2>当前版本缺少真实归档对象</h2>
            <p>版本元数据已经存在，但 `archive.html` 目前不可读，因此不展示 iframe 预览。</p>
          </section>
        )}
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
  const [searchInput, setSearchInput] = useState("");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [source, setSource] = useState<"api" | "mock">("api");
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);

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
    setLoadState("loading");

    fetchBookmarks({
      search: deferredSearch,
      quality: qualityFilter,
    }).then((result) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setItems(result.items);
        setSource(result.source);
        setLoadState("ready");
      });
    });

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, qualityFilter]);

  useEffect(() => {
    if (route.page !== "detail") {
      setDetailLoadState("idle");
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoadState("loading");

    fetchBookmarkDetail(route.bookmarkId).then((result) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setDetail(result);
        setDetailLoadState(result ? "ready" : "not-found");
      });
    });

    return () => {
      cancelled = true;
    };
  }, [route]);

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

  const activeSource = route.page === "detail" && detail ? detail.source : source;

  return (
    <main className="page-shell">
      <div className="texture" />
      <section className="topbar">
        <div>
          <p className="eyebrow">KeepPage Workspace</p>
          <h1>{route.page === "detail" ? "归档查看页" : "网页归档工作台"}</h1>
          <p className="subtitle">
            {route.page === "detail"
              ? "查看主档、切换版本，并直接核对质量诊断与 archive.html 是否真实可读。"
              : "以归档为先的收藏系统，先看得到保存质量，再谈同步、搜索和版本管理。"}
          </p>
        </div>
        <div className="sync-badge">
          数据源：<b>{activeSource === "api" ? "实时 API" : "Mock 回退"}</b>
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
        <DetailPanel detail={detail} selectedVersion={selectedVersion} />
      )}
    </main>
  );
}
