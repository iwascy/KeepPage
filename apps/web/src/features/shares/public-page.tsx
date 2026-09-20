import { useEffect, useMemo, useState } from "react";
import type { PublicShareItem, PublicShareResponse } from "@keeppage/domain";
import { ApiError } from "../../api";
import { Icon } from "../../components/Icon";
import { domainMonogram, formatDisplayDomain } from "../../lib/brand-cover";
import { formatCompactRelativeWhen } from "../../lib/date-format";
import { getPublicShare } from "./share-api";

type LoadState = "loading" | "ready" | "error";

function SharedBookmark({ item }: { item: PublicShareItem }) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [item.faviconUrl]);

  return (
    <a className="shared-bookmark" href={item.sourceUrl} target="_blank" rel="noreferrer">
      <span className="shared-bookmark-icon" aria-hidden="true">
        {item.faviconUrl && !iconFailed ? (
          <img src={item.faviconUrl} alt="" loading="lazy" onError={() => setIconFailed(true)} />
        ) : domainMonogram(item.domain)}
      </span>
      <div className="shared-bookmark-content">
        <h3 title={item.title}>{item.title}</h3>
        <div className="shared-bookmark-meta">
          <span>{formatDisplayDomain(item.domain)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatCompactRelativeWhen(item.updatedAt)}</span>
        </div>
        {item.note.trim() ? <p className="shared-bookmark-note">{item.note}</p> : null}
        <div className="shared-bookmark-labels">
          <span className={`shared-bookmark-status${item.hasArchive ? " is-archived" : ""}`}>
            {item.hasArchive ? "已归档" : "仅链接"}
          </span>
          {item.tags.slice(0, 3).map((tag) => (
            <span className="shared-bookmark-tag" key={tag.name}>
              {tag.color ? <i aria-hidden="true" style={{ backgroundColor: tag.color }} /> : null}
              {tag.name}
            </span>
          ))}
          {item.tags.length > 3 ? <span className="shared-bookmark-tag">+{item.tags.length - 3}</span> : null}
        </div>
      </div>
      <span className="shared-bookmark-open">打开原网页 <Icon name="arrow_outward" /></span>
    </a>
  );
}

export function PublicSharePage({ token }: { token: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<PublicShareResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.append(robots);
    return () => {
      document.title = previous;
      robots.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    document.title = "分享 · KeepPage";
    setLoadState("loading");
    setData(null);
    setUnavailable(false);
    getPublicShare(token)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoadState("ready");
        document.title = `${payload.title} · KeepPage`;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUnavailable(error instanceof ApiError && (error.status === 404 || error.status === 410));
        setLoadState("error");
      });
    return () => { cancelled = true; };
  }, [token, attempt]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const shareUrl = useMemo(
    () => `${window.location.origin}/s/${encodeURIComponent(token)}`,
    [token],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast("分享链接已复制");
    } catch {
      setToast("请手动复制地址栏链接");
    }
  }

  return (
    <div className="public-share-page">
      <header className="public-share-header">
        <div className="public-share-header-inner">
          <a className="public-share-brand" href="/" aria-label="KeepPage 首页">KeepPage</a>
          <span className="public-share-header-label">分享收藏</span>
          <span className="public-share-access"><Icon name="public" />只读分享</span>
        </div>
      </header>

      <main className="public-share-main" aria-busy={loadState === "loading"}>
        {loadState === "ready" && data ? (
          <>
            <section className="public-share-heading" aria-labelledby="share-title">
              <div className="public-share-heading-copy">
                <p className="public-share-eyebrow">来自 {data.ownerDisplayName} 的收藏</p>
                <h1 id="share-title">{data.title}</h1>
                {data.description.trim() ? <p className="public-share-description">{data.description}</p> : null}
                <div className="public-share-meta">
                  <span>{data.itemCount} 条书签</span>
                  <span>更新于 {formatCompactRelativeWhen(data.updatedAt)}</span>
                  <span>无需登录即可浏览</span>
                </div>
              </div>
              <button className="primary-button public-share-copy" type="button" onClick={handleCopy}>
                <Icon name="link" />复制链接
              </button>
            </section>

            <section className="public-share-bookmarks" aria-labelledby="shared-bookmarks-title">
              <div className="public-share-toolbar">
                <div>
                  <h2 id="shared-bookmarks-title">分享的书签</h2>
                  <p>点击书签，打开原网页。</p>
                </div>
                <div className="library-view-switch" role="group" aria-label="书签显示方式">
                  <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                    <Icon name="grid_view" />紧凑
                  </button>
                  <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
                    <Icon name="view_list" />列表
                  </button>
                </div>
              </div>
              {data.items.length ? (
                <div className={`public-share-grid${view === "list" ? " is-list" : ""}`}>
                  {data.items.map((item, index) => (
                    <SharedBookmark key={`${index}-${item.sourceUrl}`} item={item} />
                  ))}
                </div>
              ) : (
                <div className="public-share-empty">
                  <Icon name="inbox" />
                  <h3>这份分享里还没有内容</h3>
                  <p>分享者尚未保留可用书签，或条目已被删除。</p>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="public-share-state" role="status">
            <div className="public-share-state-card">
              <span className="public-share-state-icon"><Icon name={loadState === "loading" ? "hourglass_empty" : unavailable ? "link_off" : "info"} /></span>
              <h1>{loadState === "loading" ? "正在打开分享" : unavailable ? "链接无效或已取消分享" : "暂时无法打开分享"}</h1>
              <p>{loadState === "loading" ? "正在读取这份收藏，请稍候。" : unavailable ? "这份分享不存在、已被撤销，或链接已失效。" : "网络或服务暂时不可用，请稍后重试。"}</p>
              {loadState === "error" && !unavailable ? (
                <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}><Icon name="refresh" />重新加载</button>
              ) : null}
            </div>
          </div>
        )}
        <footer className="public-share-footer">
          <span>由 KeepPage 分享 · 只读浏览</span>
          <a href="/">打开 KeepPage <Icon name="arrow_outward" /></a>
        </footer>
      </main>
      {toast ? <div className="public-share-toast" role="status">{toast}</div> : null}
    </div>
  );
}
