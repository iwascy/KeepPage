import type {
  Bookmark,
  PrivateVaultSummary,
} from "@keeppage/domain";
import type {
  BookmarkDetailResult,
  BookmarkViewerVersion,
} from "../../api";
import {
  formatRelativeWhen,
  formatWhen,
} from "../../lib/date-format";

type LoadState = "idle" | "loading" | "ready" | "error";
type ArchiveViewMode = "reader" | "original";
type ArchivePreviewState =
  | { status: "idle"; url?: undefined; error?: undefined }
  | { status: "loading"; url?: undefined; error?: undefined }
  | { status: "ready"; url: string; error?: undefined }
  | { status: "error"; url?: undefined; error: string };

export function PrivateModePage({
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
          <strong>{summary.totalItems ?? 0}</strong>
          <small>默认不会出现在普通首页和普通搜索中</small>
        </article>
        <article className="private-mode-stat-card">
          <span>最近更新</span>
          <strong>{summary.lastUpdatedAt ? formatRelativeWhen(summary.lastUpdatedAt) : "暂无"}</strong>
          <small>{summary.lastUpdatedAt ? formatWhen(summary.lastUpdatedAt) : "还没有私密内容"}</small>
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
            <div className="detail-skeleton private-mode-skeleton" aria-label="正在加载私密内容">
              <div className="detail-skeleton-block is-hero" />
              <div className="detail-skeleton-grid">
                <div className="detail-skeleton-block" />
                <div className="detail-skeleton-block" />
                <div className="detail-skeleton-block" />
              </div>
            </div>
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

export function PrivateDetailPage({
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
          <section className="detail-skeleton detail-skeleton--preview" aria-label="正在加载私密预览">
            <div className="detail-skeleton-block is-hero" />
            <div className="detail-skeleton-grid">
              <div className="detail-skeleton-block" />
              <div className="detail-skeleton-block" />
            </div>
          </section>
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
