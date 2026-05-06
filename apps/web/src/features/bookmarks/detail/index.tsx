import { type ReactNode, useState } from "react";
import type {
  Folder,
  QualityReport,
  Tag,
} from "@keeppage/domain";
import type {
  BookmarkDetailResult,
  BookmarkViewerVersion,
} from "../../../api";
import { Icon } from "../../../components/Icon";
import { formatWhen } from "../../../lib/date-format";

type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type ArchiveViewMode = "reader" | "original";

type ArchivePreviewState =
  | { status: "idle"; url?: undefined; error?: undefined }
  | { status: "loading"; url?: undefined; error?: undefined }
  | { status: "ready"; url: string; error?: undefined }
  | { status: "error"; url?: undefined; error: string };

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

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
  onGoBack,
  onSelectVersion,
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
  onGoBack: () => void;
  onSelectVersion: (bookmarkId: string, versionId?: string) => void;
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
  const [notesEditing, setNotesEditing] = useState(false);
  const [tagsEditing, setTagsEditing] = useState(false);
  const selectedTags = tags.filter((tag) => metadataTagIds.includes(tag.id));
  const selectedFolder = folders.find((folder) => folder.id === metadataFolderId);

  return (
    <section className="detail-shell">
      <section className="detail-preview-panel">
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

      <aside className="detail-panel">
        <div className="detail-top-bar">
          <button className="detail-back-button" type="button" onClick={onGoBack}>
            <Icon name="arrow_back" />
          </button>
          <div className="preview-mode-switch preview-mode-switch--compact" role="tablist" aria-label="归档预览模式">
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
        </div>
        {previewFallbackMessage ? (
          <p className="preview-mode-note">{previewFallbackMessage}</p>
        ) : null}

        <div className="detail-block">
          <div className="detail-header-label">
            <span className="detail-header-label-text">Detail View</span>
            <span className="detail-header-label-id">#{detail.bookmark.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="detail-title-row">
            <h2 className="detail-title">{detail.bookmark.title}</h2>
            {detail.bookmark.isFavorite ? (
              <Icon className="detail-favorite" name="star" />
            ) : null}
          </div>
          <div className="detail-url-row">
            <Icon name="link" />
            <a href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
              {detail.bookmark.sourceUrl}
            </a>
            <Icon className="url-external-icon" name="open_in_new" />
          </div>
        </div>

        <div className="detail-primary-meta">
          <label className="detail-folder-field">
            <span className="detail-section-label">归档位置</span>
            <select
              value={metadataFolderId}
              onChange={(event) => onMetadataFolderChange(event.target.value)}
            >
              <option value="">未归档</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="detail-tags-section">
          <div className="detail-section-heading">
            <span className="detail-section-label">标签</span>
            <button
              className="detail-link-button"
              type="button"
              onClick={() => setTagsEditing((current) => !current)}
            >
              {tagsEditing ? "完成" : "管理标签"}
            </button>
          </div>
          <div className="detail-tags-wrap detail-tags-wrap--selected">
            {selectedTags.length ? (
              selectedTags.map((tag) => (
                <span className="detail-tag-pill is-active" key={tag.id}>#{tag.name}</span>
              ))
            ) : (
              <button className="detail-tag-empty" type="button" onClick={() => setTagsEditing(true)}>
                <Icon name="add" />
                <span>添加标签</span>
              </button>
            )}
          </div>
          {tagsEditing ? (
            <div className="detail-tag-editor">
              <div className="detail-tags-wrap">
                {tags.map((tag) => {
                  const checked = metadataTagIds.includes(tag.id);
                  return (
                    <label className={checked ? "detail-tag-pill is-active" : "detail-tag-pill"} key={tag.id}>
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
            </div>
          ) : null}
        </div>

        <details className="detail-collapsible">
          <summary>
            <span className="detail-summary-label">
              <Icon className="detail-summary-icon" name="history" />
              <span>版本</span>
            </span>
            <span className="detail-summary-value">v{selectedVersion.versionNo}</span>
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
              <div className="version-item version-item--source">
                <Icon className="version-item-icon" name="description" />
                <div>
                  <strong>Original Source</strong>
                  <span>{new URL(detail.bookmark.sourceUrl).hostname} {"\u2022"} {formatWhen(detail.bookmark.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </details>

        <details className="detail-collapsible">
          <summary>
            <span className="detail-summary-label">
              <Icon className="detail-summary-icon" name="description" />
              <span>更多信息</span>
            </span>
            <span className="detail-summary-value">{selectedFolder?.name ?? "未归档"}</span>
          </summary>
          <div className="detail-collapsible-body">
            <div className="detail-meta-list">
              <div className="detail-meta-row">
                <span>添加时间</span>
                <strong>{formatWhen(detail.bookmark.createdAt)}</strong>
              </div>
              <div className="detail-meta-row">
                <span>同步时间</span>
                <strong>{formatWhen(detail.bookmark.updatedAt)}</strong>
              </div>
              <div className="detail-meta-row">
                <span>文件大小</span>
                <strong>{formatFileSize(displayedArchiveSize)}</strong>
              </div>
              <div className="detail-meta-row">
                <span>书签 ID</span>
                <strong>#{detail.bookmark.id.slice(0, 8).toUpperCase()}</strong>
              </div>
            </div>
          </div>
        </details>

        {(notesEditing || metadataNote) ? (
          <div className="detail-notes-section">
            <div className="detail-section-heading">
              <span className="detail-section-label">备注</span>
              {!notesEditing ? (
                <button className="detail-link-button" type="button" onClick={() => setNotesEditing(true)}>
                  编辑
                </button>
              ) : null}
            </div>
            {notesEditing ? (
              <div className="detail-notes-edit">
                <textarea
                  value={metadataNote}
                  onChange={(event) => onMetadataNoteChange(event.target.value)}
                  rows={3}
                  placeholder="添加备注..."
                  autoFocus
                />
                <div className="detail-notes-edit-actions">
                  <button
                    className="primary-button compact-button"
                    type="button"
                    onClick={() => {
                      onMetadataSave();
                      setNotesEditing(false);
                    }}
                    disabled={metadataSaving}
                  >
                    {metadataSaving ? "保存中..." : "保存"}
                  </button>
                  <button className="ghost-button compact-button" type="button" onClick={() => setNotesEditing(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="detail-note-quote"
                role="button"
                tabIndex={0}
                onClick={() => setNotesEditing(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setNotesEditing(true);
                  }
                }}
              >
                <p>{metadataNote}</p>
              </div>
            )}
          </div>
        ) : null}

        {metadataFeedback ? (
          <p className={metadataFeedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
            {metadataFeedback.message}
          </p>
        ) : null}

        <div className="detail-actions-footer">
          <button
            className="detail-action-button"
            type="button"
            onClick={() => setNotesEditing(true)}
          >
            <Icon name="description" />
            Note
          </button>
          {previewState.status === "ready" && activePreviewMode ? (
            <a
              className="detail-action-button"
              href={previewState.url}
              download={`keeppage-${detail.bookmark.id}-v${selectedVersion.versionNo}-${activePreviewMode === "reader" ? "reader" : "original"}.html`}
            >
              <Icon name="download" />
              Export
            </a>
          ) : (
            <span className="detail-action-button" style={{ opacity: 0.4, cursor: "not-allowed" }}>
              <Icon name="download" />
              Export
            </span>
          )}
          <button className="detail-action-button is-danger" type="button">
            <Icon name="delete" />
            Delete
          </button>
        </div>
      </aside>
    </section>
  );
}

export function BookmarkDetailRoute({
  detailLoadState,
  detailError,
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
  isPending,
  onGoBack,
  onSelectVersion,
  onMetadataNoteChange,
  onMetadataFolderChange,
  onMetadataTagToggle,
  onPreviewModeChange,
  onMetadataSave,
}: {
  detailLoadState: DetailLoadState;
  detailError: string | null;
  detail: BookmarkDetailResult | null;
  selectedVersion: BookmarkViewerVersion | null;
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
  isPending: boolean;
  onGoBack: () => void;
  onSelectVersion: (bookmarkId: string, versionId?: string) => void;
  onMetadataNoteChange: (value: string) => void;
  onMetadataFolderChange: (value: string) => void;
  onMetadataTagToggle: (tagId: string) => void;
  onPreviewModeChange: (mode: ArchiveViewMode) => void;
  onMetadataSave: () => void;
}) {
  if (detailLoadState === "loading" || isPending) {
    return <section className="loading">正在加载归档详情...</section>;
  }

  if (detailLoadState === "error") {
    return (
      <EmptyState
        mode="missing-detail"
        title="归档详情加载失败"
        description={detailError ?? "暂时无法读取这条归档。"}
        action={
          <button className="primary-button" type="button" onClick={onGoBack}>
            返回列表
          </button>
        }
      />
    );
  }

  if (detailLoadState === "not-found" || !detail) {
    return (
      <EmptyState
        mode="missing-detail"
        action={
          <button className="primary-button" type="button" onClick={onGoBack}>
            返回列表
          </button>
        }
      />
    );
  }

  if (!selectedVersion) {
    return (
      <EmptyState
        mode="missing-detail"
        title="该书签尚未生成归档版本"
        description="这是轻导入生成的书签元数据，暂时没有 archive.html 版本可预览。"
        action={
          <a className="primary-button" href={detail.bookmark.sourceUrl} target="_blank" rel="noreferrer">
            打开原网页
          </a>
        }
      />
    );
  }

  return (
    <DetailPanel
      detail={detail}
      selectedVersion={selectedVersion}
      previewState={previewState}
      preferredPreviewMode={preferredPreviewMode}
      activePreviewMode={activePreviewMode}
      folders={folders}
      tags={tags}
      metadataNote={metadataNote}
      metadataFolderId={metadataFolderId}
      metadataTagIds={metadataTagIds}
      metadataSaving={metadataSaving}
      metadataFeedback={metadataFeedback}
      onGoBack={onGoBack}
      onSelectVersion={onSelectVersion}
      onMetadataNoteChange={onMetadataNoteChange}
      onMetadataFolderChange={onMetadataFolderChange}
      onMetadataTagToggle={onMetadataTagToggle}
      onPreviewModeChange={onPreviewModeChange}
      onMetadataSave={onMetadataSave}
    />
  );
}
