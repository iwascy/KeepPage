import { useEffect, useMemo, useState } from "react";
import type { PublicShareItem, PublicShareResponse } from "@keeppage/domain";
import { ApiError } from "../../api";
import { Icon } from "../../components/Icon";
import { formatCompactRelativeWhen } from "../../lib/date-format";
import { getPublicShare } from "./share-api";

type LoadState = "loading" | "ready" | "error";

const COVER_TONES = ["peach", "mist", "sand", "sky", "rose", "slate"] as const;

function coverTone(domain: string) {
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COVER_TONES[hash % COVER_TONES.length];
}

function formatDomain(domain: string) {
  return domain.replace(/^www\./i, "");
}

function faviconFor(item: PublicShareItem) {
  if (item.faviconUrl) {
    return item.faviconUrl;
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.domain)}&sz=64`;
}

function ownerInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "K";
}

export function PublicSharePage({ token }: { token: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<PublicShareResponse | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = "分享 · KeepPage";
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
    setLoadState("loading");
    getPublicShare(token)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setData(payload);
        setLoadState("ready");
        document.title = `${payload.title} · KeepPage`;
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setData(null);
        setLoadState("error");
        if (!(error instanceof ApiError)) {
          console.error(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/s/${encodeURIComponent(token)}`;
  }, [token]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast("分享链接已复制");
    } catch {
      setToast("请手动复制地址栏链接");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="public-share-page">
        <div className="public-share-state">
          <div className="public-share-state-card">
            <div className="public-share-state-icon">
              <Icon name="hourglass_empty" />
            </div>
            <h1>正在打开分享</h1>
            <p>无需登录，稍候即可浏览。</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !data) {
    return (
      <div className="public-share-page">
        <div className="public-share-state">
          <div className="public-share-state-card">
            <div className="public-share-state-icon">
              <Icon name="link_off" />
            </div>
            <h1>链接无效或已取消分享</h1>
            <p>这份分享不存在、已被撤销，或链接已失效。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public-share-page">
      <header className="public-share-header">
        <div className="public-share-header-inner">
          <a className="public-share-brand" href="/">
            <span className="public-share-brand-mark" aria-hidden="true">
              <Icon name="bookmark" />
            </span>
            <span>
              <div className="public-share-brand-title">KeepPage</div>
              <div className="public-share-brand-sub">Shared Collection</div>
            </span>
          </a>
          <div className="public-share-header-actions">
            <button className="public-share-btn is-primary" type="button" onClick={handleCopy}>
              <Icon name="link" />
              <span className="btn-label">复制链接</span>
            </button>
            <span className="public-share-btn is-ghost" title="公开访问，无需登录">
              <Icon name="public" />
            </span>
          </div>
        </div>
      </header>

      <main className="public-share-main">
        <section className="public-share-hero">
          <div className="public-share-hero-inner">
            <div className="public-share-badges">
              <span className="public-share-badge">
                <Icon name="share" />
                Public Share
              </span>
              <span className="public-share-badge is-open">
                <Icon name="lock_open" />
                无需登录
              </span>
              <span className="public-share-badge">只读</span>
            </div>
            <h1 className="public-share-title">{data.title}</h1>
            {data.description.trim() ? (
              <p className="public-share-desc">{data.description}</p>
            ) : null}
            <div className="public-share-meta">
              <div className="public-share-owner">
                <div className="public-share-avatar" aria-hidden="true">
                  {ownerInitial(data.ownerDisplayName)}
                </div>
                <div>
                  <div className="public-share-meta-label">Shared by</div>
                  <div className="public-share-meta-value">{data.ownerDisplayName}</div>
                </div>
              </div>
              <div>
                <div className="public-share-meta-label">Items</div>
                <div className="public-share-meta-value">{data.itemCount} 条</div>
              </div>
              <div>
                <div className="public-share-meta-label">Updated</div>
                <div className="public-share-meta-value">{formatCompactRelativeWhen(data.updatedAt)}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="public-share-toolbar">
          <div className="public-share-toolbar-label">Shared Bookmarks</div>
          <div className="public-share-view-toggle">
            <button
              type="button"
              className={`public-share-view-btn${view === "grid" ? " is-active" : ""}`}
              aria-label="网格视图"
              onClick={() => setView("grid")}
            >
              <Icon name="grid_view" />
            </button>
            <button
              type="button"
              className={`public-share-view-btn${view === "list" ? " is-active" : ""}`}
              aria-label="列表视图"
              onClick={() => setView("list")}
            >
              <Icon name="view_list" />
            </button>
          </div>
        </div>

        {data.items.length === 0 ? (
          <div className="public-share-state">
            <div className="public-share-state-card">
              <div className="public-share-state-icon">
                <Icon name="inbox" />
              </div>
              <h1>这份分享里还没有内容</h1>
              <p>分享者尚未保留可用书签，或条目已被删除。</p>
            </div>
          </div>
        ) : view === "grid" ? (
          <div className="public-share-grid">
            {data.items.map((item, index) => (
              <a
                key={`grid-${index}-${item.domain}`}
                className="public-share-card"
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <div className={`public-share-card-cover is-${coverTone(item.domain)}`}>
                  <img
                    className="public-share-card-favicon"
                    src={faviconFor(item)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  {item.hasArchive ? (
                    <span className="public-share-card-archive">
                      <Icon name="inventory_2" />
                      已归档
                    </span>
                  ) : null}
                </div>
                <div className="public-share-card-body">
                  <div className="public-share-card-top">
                    <span>{formatDomain(item.domain)}</span>
                    <span>{formatCompactRelativeWhen(item.updatedAt)}</span>
                  </div>
                  <h2 className="public-share-card-title">{item.title}</h2>
                  {item.note.trim() ? <p className="public-share-card-note">{item.note}</p> : null}
                  {item.tags.length > 0 ? (
                    <div className="public-share-card-tags">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag.name}
                          className="public-share-tag"
                          style={tag.color ? { background: tag.color } : undefined}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="public-share-grid is-list">
            {data.items.map((item, index) => (
              <a
                key={`list-${index}-${item.domain}`}
                className="public-share-list-card"
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <div className={`public-share-list-thumb is-${coverTone(item.domain)} public-share-card-cover`}>
                  <img
                    className="public-share-card-favicon"
                    src={faviconFor(item)}
                    alt=""
                    loading="lazy"
                    width={28}
                    height={28}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                </div>
                <div className="public-share-list-body">
                  <div className="public-share-list-meta">
                    <span>{formatDomain(item.domain)}</span>
                    <span>·</span>
                    <span>{formatCompactRelativeWhen(item.updatedAt)}</span>
                    {item.hasArchive ? <span>已归档</span> : null}
                  </div>
                  <h2 className="public-share-list-title">{item.title}</h2>
                  {item.note.trim() ? <p className="public-share-list-note">{item.note}</p> : null}
                </div>
                <Icon name="open_in_new" />
              </a>
            ))}
          </div>
        )}

        <footer className="public-share-footer">
          <p>此页面为公开分享 · 浏览无需账号</p>
          <a className="public-share-btn is-ghost" href="/">
            <Icon name="rocket_launch" />
            用 KeepPage 整理你的网页
          </a>
          <p className="public-share-footer-note">KeepPage Share</p>
        </footer>
      </main>

      {toast ? (
        <div className="public-share-toast" role="status">
          <Icon name="check_circle" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
