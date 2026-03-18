import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type { Bookmark, QualityGrade } from "@keeppage/domain";
import { fetchBookmarks } from "./api";

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready";

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

function BookmarkCard({ bookmark }: { bookmark: Bookmark }) {
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
    </article>
  );
}

function EmptyState({ mode }: { mode: "empty" | "search-empty" }) {
  if (mode === "search-empty") {
    return (
      <section className="empty-state">
        <h2>没有匹配的归档</h2>
        <p>试试别的关键词，或者调整质量筛选条件。</p>
      </section>
    );
  }
  return (
    <section className="empty-state">
      <h2>还没有归档记录</h2>
      <p>当扩展开始同步后，你保存的页面会出现在这里。</p>
    </section>
  );
}

export function App() {
  const [searchInput, setSearchInput] = useState("");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [source, setSource] = useState<"api" | "mock">("api");
  const [isPending, startTransition] = useTransition();

  const deferredSearch = useDeferredValue(searchInput);

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

  const summary = useMemo(() => {
    const high = items.filter((item) => item.latestQuality?.grade === "high").length;
    const medium = items.filter((item) => item.latestQuality?.grade === "medium").length;
    const low = items.filter((item) => item.latestQuality?.grade === "low").length;
    return { total: items.length, high, medium, low };
  }, [items]);

  return (
    <main className="page-shell">
      <div className="texture" />
      <section className="topbar">
        <div>
          <p className="eyebrow">KeepPage Workspace</p>
          <h1>网页归档工作台</h1>
          <p className="subtitle">
            以归档为先的收藏系统，先看得到保存质量，再谈同步、搜索和版本管理。
          </p>
        </div>
        <div className="sync-badge">
          数据源：<b>{source === "api" ? "实时 API" : "Mock 回退"}</b>
        </div>
      </section>

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
            <BookmarkCard key={bookmark.id} bookmark={bookmark} />
          ))}
        </section>
      )}
    </main>
  );
}
