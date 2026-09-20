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
import { Icon } from "../../components/Icon";

type LoadState = "idle" | "loading" | "ready" | "error";
type ArchiveViewMode = "reader" | "original";
type ArchivePreviewState =
  | { status: "idle"; url?: undefined; error?: undefined }
  | { status: "loading"; url?: undefined; error?: undefined }
  | { status: "ready"; url: string; error?: undefined }
  | { status: "error"; url?: undefined; error: string };

export function PrivateModePage({
  summary,
  onRetryStatus,
  privateToken,
  searchInput,
  onSearchChange,
  items,
  loadState,
  error,
  setupPassword,
  setupConfirm,
  unlockPassword,
  passwordChangeLogin,
  passwordChangeNew,
  passwordChangeConfirm,
  passwordChangeMessage,
  busy,
  onSetupPasswordChange,
  onSetupConfirmChange,
  onUnlockPasswordChange,
  onPasswordChangeLoginChange,
  onPasswordChangeNewChange,
  onPasswordChangeConfirmChange,
  onSetup,
  onUnlock,
  onChangePassword,
  onLock,
  onOpenBookmark,
}: {
  summary: PrivateVaultSummary | null;
  onRetryStatus: () => void;
  privateToken: string | null;
  searchInput: string;
  onSearchChange: (value: string) => void;
  items: Bookmark[];
  loadState: LoadState;
  error: string | null;
  setupPassword: string;
  setupConfirm: string;
  unlockPassword: string;
  passwordChangeLogin: string;
  passwordChangeNew: string;
  passwordChangeConfirm: string;
  passwordChangeMessage: string | null;
  busy: boolean;
  onSetupPasswordChange: (value: string) => void;
  onSetupConfirmChange: (value: string) => void;
  onUnlockPasswordChange: (value: string) => void;
  onPasswordChangeLoginChange: (value: string) => void;
  onPasswordChangeNewChange: (value: string) => void;
  onPasswordChangeConfirmChange: (value: string) => void;
  onSetup: () => void;
  onUnlock: () => void;
  onChangePassword: () => void;
  onLock: () => void;
  onOpenBookmark: (bookmarkId: string) => void;
}) {
  const enabled = Boolean(summary?.enabled);
  const unlocked = Boolean(privateToken);

  return (
    <section className="private-mode-page" aria-labelledby="private-mode-title">
      <header className="private-mode-header settings-page-heading">
        <div>
          <p className="settings-kicker">资料库</p>
          <h1 id="private-mode-title">私密模式</h1>
          <p>为私密收藏设置独立密码，普通列表和搜索中不显示这些内容。</p>
        </div>
        {enabled && unlocked ? (
          <button className="secondary-button" type="button" onClick={onLock} disabled={busy}>
            <Icon name="lock" />{busy ? "处理中…" : "锁定私密空间"}
          </button>
        ) : null}
      </header>

      {error ? <p className="private-mode-feedback is-error" role="alert">{error}</p> : null}
      {!summary ? (
        <div className="private-mode-state" role="status" aria-busy={!error}>
          <Icon name={error ? "lock" : "refresh"} />
          <h2>{error ? "暂时无法读取私密设置" : "正在加载私密设置…"}</h2>
          <p>{error ? "请检查连接后重试。" : "正在确认当前状态和私密内容数量。"}</p>
          {error ? <button className="secondary-button" type="button" onClick={onRetryStatus}>重新加载</button> : null}
        </div>
      ) : (
        <>
          <section className="private-mode-card" aria-labelledby="private-overview-title">
            <div className="private-mode-section-heading">
              <h2 id="private-overview-title">空间概览</h2>
              <span className="private-mode-status"><span aria-hidden="true" />{!enabled ? "未启用" : unlocked ? "已解锁" : "已锁定"}</span>
            </div>
            <dl className="private-mode-overview">
              <div><dt>私密收藏</dt><dd>{summary.totalItems ?? 0}<span> 条</span></dd></div>
              <div><dt>最近更新</dt><dd title={summary.lastUpdatedAt ? formatWhen(summary.lastUpdatedAt) : undefined}>{summary.lastUpdatedAt ? formatRelativeWhen(summary.lastUpdatedAt) : "暂无内容"}</dd></div>
              <div><dt>访问方式</dt><dd>独立密码</dd></div>
            </dl>
            <p className="private-mode-boundary"><Icon name="info" />私密模式提供密码访问控制和内容隔离，不是端到端加密保险箱。</p>
          </section>

          {!enabled ? (
            <section className="private-mode-card" aria-labelledby="private-enable-title">
              <div className="private-mode-section-copy"><h2 id="private-enable-title">启用私密空间</h2><p>设置独立密码后，即可从浏览器扩展保存私密收藏。</p></div>
              <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onSetup(); }}>
                <label><span>私密密码</span><input type="password" value={setupPassword} onChange={(event) => onSetupPasswordChange(event.target.value)} placeholder="至少 8 位" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                <label><span>确认私密密码</span><input type="password" value={setupConfirm} onChange={(event) => onSetupConfirmChange(event.target.value)} placeholder="再次输入私密密码" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}>{busy ? "启用中…" : "启用私密模式"}</button></div>
              </form>
            </section>
          ) : !unlocked ? (
            <section className="private-mode-card" aria-labelledby="private-unlock-title">
              <div className="private-mode-section-copy"><h2 id="private-unlock-title">解锁私密空间</h2><p>本次页面会话内保持解锁。刷新或关闭页面后需要重新输入密码。</p></div>
              <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onUnlock(); }}>
                <label><span>私密密码</span><input type="password" value={unlockPassword} onChange={(event) => onUnlockPasswordChange(event.target.value)} placeholder="输入私密密码" autoComplete="current-password" required disabled={busy} /></label>
                <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}><Icon name="lock_open" />{busy ? "解锁中…" : "解锁私密空间"}</button></div>
              </form>
            </section>
          ) : (
            <section className="private-mode-card" aria-labelledby="private-content-title">
              <div className="private-mode-section-copy"><h2 id="private-content-title">私密收藏</h2><p>点击条目查看存档。搜索仅查询私密收藏。</p></div>
              <label className="private-mode-search"><Icon name="search" /><input type="search" aria-label="搜索私密收藏" placeholder="搜索私密收藏" value={searchInput} onChange={(event) => onSearchChange(event.target.value)} /></label>
              {loadState === "loading" ? (
                <div className="private-mode-state is-compact" role="status" aria-busy="true"><Icon name="refresh" /><p>正在加载私密收藏…</p></div>
              ) : loadState === "error" ? (
                <div className="private-mode-empty"><h3>私密收藏加载失败</h3><p>请检查连接后重新进入私密空间。</p></div>
              ) : items.length === 0 ? (
                <div className="private-mode-empty"><Icon name="bookmark" /><h3>{summary.totalItems ? "没有匹配的私密收藏" : "还没有私密收藏"}</h3><p>{summary.totalItems ? "试试其他关键词，或清空搜索后查看全部私密收藏。" : "在浏览器扩展中选择“保存到 KP 私密模式”，即可将网页加入这里。"}</p></div>
              ) : (
                <div className="private-mode-list">
                  {items.map((bookmark) => (
                    <button className="private-mode-item" key={bookmark.id} type="button" onClick={() => onOpenBookmark(bookmark.id)}>
                      <div><strong>{bookmark.title}</strong><p>{bookmark.domain}</p></div>
                      <span>{formatRelativeWhen(bookmark.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {enabled ? (
            <section className="private-mode-card private-mode-security" aria-labelledby="private-password-title">
              <details className="private-mode-password-settings">
                <summary><span><strong id="private-password-title">修改或重设私密密码</strong><span>忘记私密密码时，也可通过账号登录密码完成验证。</span></span><Icon name="keyboard_arrow_right" /></summary>
                <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onChangePassword(); }}>
                  <p>验证通过后将设置新密码，并重新解锁当前私密空间。</p>
                  <label><span>账号登录密码</span><input type="password" value={passwordChangeLogin} onChange={(event) => onPasswordChangeLoginChange(event.target.value)} placeholder="输入当前账号的登录密码" autoComplete="current-password" required disabled={busy} /></label>
                  <label><span>新的私密密码</span><input type="password" value={passwordChangeNew} onChange={(event) => onPasswordChangeNewChange(event.target.value)} placeholder="至少 8 位" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                  <label><span>确认新密码</span><input type="password" value={passwordChangeConfirm} onChange={(event) => onPasswordChangeConfirmChange(event.target.value)} placeholder="再次输入新的私密密码" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                  <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}>{busy ? "更新中…" : "更新私密密码"}</button></div>
                  {passwordChangeMessage ? <p className="private-mode-feedback" role="status">{passwordChangeMessage}</p> : null}
                </form>
              </details>
            </section>
          ) : null}
        </>
      )}
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
            <Icon name="arrow_back" />
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
            <Icon name="link" />
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
              <Icon className="detail-summary-icon" name="history" />
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
                    <Icon className="version-item-icon" name="refresh" />
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
