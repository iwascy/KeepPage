import type { FormEvent } from "react";
import type {
  Bookmark,
  Folder,
  Tag,
} from "@keeppage/domain";
import { Icon } from "../components/Icon";
import { DefaultSiteIcon } from "../features/bookmarks/shared/DefaultSiteIcon";
import { useBookmarkSiteIcon } from "../features/bookmarks/shared/site-icon";

export type ManagerDialogState =
  | { kind: "closed" }
  | { kind: "delete-bookmark"; bookmark: Bookmark }
  | { kind: "delete-bookmarks-batch"; bookmarkIds: string[]; count: number }
  | { kind: "create-folder"; parent?: Folder }
  | { kind: "edit-folder"; folder: Folder }
  | { kind: "delete-folder"; folder: Folder }
  | { kind: "create-tag" }
  | { kind: "edit-tag"; tag: Tag }
  | { kind: "delete-tag"; tag: Tag };

export function isManagerDialogOpen(state: ManagerDialogState) {
  return state.kind !== "closed";
}

function DialogCloseIcon() {
  return (
    <Icon name="close" />
  );
}

function BookmarkDeleteSiteIcon({ bookmark }: { bookmark: Bookmark }) {
  const {
    siteIconSrc,
    handleSiteIconError,
    handleSiteIconLoad,
  } = useBookmarkSiteIcon(bookmark, 64);

  return siteIconSrc ? (
    <img
      alt=""
      className="bookmark-delete-card-favicon"
      src={siteIconSrc}
      width={28}
      height={28}
      onError={handleSiteIconError}
      onLoad={(event) => handleSiteIconLoad(event.currentTarget)}
    />
  ) : (
    <DefaultSiteIcon className="bookmark-delete-card-favicon is-default-site-icon" />
  );
}

export function ManagerDialog({
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

  if (state.kind === "create-folder" || state.kind === "create-tag") {
    const isCreateFolder = state.kind === "create-folder";
    const createTitle = isCreateFolder ? "New Collection" : "New Tag";
    const createDescription = isCreateFolder
      ? (state.parent
        ? "Organize your bookmarks inside a focused parent collection."
        : "Organize your bookmarks with a custom style.")
      : "Keep related bookmarks grouped under a concise label.";
    const fieldLabel = isCreateFolder ? "Collection Name" : "Tag Name";
    const placeholder = isCreateFolder ? "e.g. Design Inspiration" : "e.g. Read Later";
    const submitLabel = busy
      ? (isCreateFolder ? "Creating..." : "Saving...")
      : "Create";

    return (
      <div
        aria-hidden="true"
        className="manager-dialog-backdrop is-create-folder"
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      >
        <div
          aria-labelledby="manager-dialog-title"
          aria-modal="true"
          className="create-folder-dialog"
          role="dialog"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="create-folder-dialog-shell">
            <div className="create-folder-dialog-header">
              <div className="create-folder-dialog-heading">
                <h2 id="manager-dialog-title">{createTitle}</h2>
                <p>{createDescription}</p>
              </div>
              <button
                aria-label="关闭"
                className="create-folder-dialog-close"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                <DialogCloseIcon />
              </button>
            </div>

            <form className="create-folder-dialog-form" onSubmit={onSubmit}>
              {isCreateFolder && state.parent ? (
                <div className="create-folder-parent-pill">
                  <span>Parent</span>
                  <strong>{state.parent.path}</strong>
                </div>
              ) : null}

              <label className="create-folder-dialog-section">
                <span className="create-folder-dialog-label">{fieldLabel}</span>
                <input
                  autoFocus
                  className="create-folder-dialog-input"
                  maxLength={isCreateFolder ? 120 : 80}
                  placeholder={placeholder}
                  value={nameValue}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </label>

              {error ? <p className="manager-dialog-error create-folder-dialog-error">{error}</p> : null}

              <div className="create-folder-dialog-actions">
                <button className="create-folder-action-button is-secondary" type="button" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="create-folder-action-button is-primary" type="submit" disabled={busy}>
                  {submitLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const isDeleteDialog = state.kind === "delete-bookmark" || state.kind === "delete-bookmarks-batch" || state.kind === "delete-folder" || state.kind === "delete-tag";
  const isBookmarkDialog = state.kind === "delete-bookmark";
  const isBatchDeleteDialog = state.kind === "delete-bookmarks-batch";
  const isFolderDeleteDialog = state.kind === "delete-folder";
  const useBookmarkDeleteStyle = isBookmarkDialog || isBatchDeleteDialog || isFolderDeleteDialog;
  const bookmarkDeleteTarget = state.kind === "delete-bookmark" ? state.bookmark : null;
  const folderDeleteTarget = state.kind === "delete-folder" ? state.folder : null;
  const tagDeleteTarget = state.kind === "delete-tag" ? state.tag : null;
  const isFolderDialog = state.kind === "edit-folder" || state.kind === "delete-folder";
  const tagColor = colorValue.trim();

  let title = "";
  let description = "";
  let eyebrow = "";
  let submitLabel = "";

  if (state.kind === "edit-folder") {
    eyebrow = "Edit Folder Path";
    title = "调整收藏夹路径";
    description = "直接改完整路径，系统会自动识别父级并把它移动到正确位置。";
    submitLabel = "保存路径";
  } else if (state.kind === "delete-bookmark") {
    eyebrow = "Delete Bookmark";
    title = "删除这条书签？";
    description = "它会从归档列表中移除，关联的版本记录也会一起删除。";
    submitLabel = "删除";
  } else if (state.kind === "delete-bookmarks-batch") {
    eyebrow = "Batch Delete";
    title = `确认删除 ${state.count} 个书签？`;
    description = "所选书签将从归档列表中移除，关联的版本记录也会一起删除。此操作不可撤销。";
    submitLabel = `删除 ${state.count} 个`;
  } else if (state.kind === "delete-folder") {
    eyebrow = "Delete Folder";
    title = "删除这个收藏夹？";
    description = "它会从收藏夹列表中移除，子收藏夹会上移一层，当前文件夹下的网页会解除归档。";
    submitLabel = "删除";
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
      className={useBookmarkDeleteStyle ? "manager-dialog-backdrop is-bookmark-delete" : "manager-dialog-backdrop"}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="manager-dialog-title"
        aria-modal="true"
        className={useBookmarkDeleteStyle ? "manager-dialog bookmark-delete-dialog" : isDeleteDialog ? "manager-dialog is-danger" : "manager-dialog"}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        {isBatchDeleteDialog ? (
          <>
            <div className="bookmark-delete-dialog-shell">
              <div className="bookmark-delete-dialog-header">
                <div className="bookmark-delete-dialog-heading">
                  <p className="eyebrow">{eyebrow}</p>
                  <h2 id="manager-dialog-title">{title}</h2>
                  <p>{description}</p>
                </div>
                <button
                  aria-label="关闭"
                  className="bookmark-delete-dialog-close"
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <section className="bookmark-delete-card batch-delete-card">
                <div className="batch-delete-card-count" aria-hidden="true">
                  {state.count}
                </div>
                <div className="bookmark-delete-card-body batch-delete-card-body">
                  <strong>即将删除 {state.count} 条归档</strong>
                  <span className="bookmark-delete-card-domain">关联的版本记录也会一起清除</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，所选书签和它们的归档版本会一起从列表中移除。</p>
              </div>

              {error ? <p className="manager-dialog-error bookmark-delete-dialog-error">{error}</p> : null}

              <div className="bookmark-delete-dialog-actions">
                <button className="bookmark-delete-action is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="bookmark-delete-action is-danger" type="button" onClick={onConfirmDelete} disabled={busy}>
                  {busy ? "处理中..." : submitLabel}
                </button>
              </div>
            </div>
          </>
        ) : isBookmarkDialog && bookmarkDeleteTarget ? (
          <>
            <div className="bookmark-delete-dialog-shell">
              <div className="bookmark-delete-dialog-header">
                <div className="bookmark-delete-dialog-heading">
                  <p className="eyebrow">{eyebrow}</p>
                  <h2 id="manager-dialog-title">{title}</h2>
                  <p>{description}</p>
                </div>
                <button
                  aria-label="关闭"
                  className="bookmark-delete-dialog-close"
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <section className="bookmark-delete-card">
                <BookmarkDeleteSiteIcon bookmark={bookmarkDeleteTarget} />
                <div className="bookmark-delete-card-body">
                  <strong>{bookmarkDeleteTarget.title}</strong>
                  <span className="bookmark-delete-card-domain">{bookmarkDeleteTarget.domain}</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，这条书签和它的归档版本会一起从列表中移除。</p>
              </div>

              {error ? <p className="manager-dialog-error bookmark-delete-dialog-error">{error}</p> : null}

              <div className="bookmark-delete-dialog-actions">
                <button className="bookmark-delete-action is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="bookmark-delete-action is-danger" type="button" onClick={onConfirmDelete} disabled={busy}>
                  {busy ? "处理中..." : submitLabel}
                </button>
              </div>
            </div>
          </>
        ) : isFolderDeleteDialog && folderDeleteTarget ? (
          <>
            <div className="bookmark-delete-dialog-shell">
              <div className="bookmark-delete-dialog-header">
                <div className="bookmark-delete-dialog-heading">
                  <p className="eyebrow">{eyebrow}</p>
                  <h2 id="manager-dialog-title">{title}</h2>
                  <p>{description}</p>
                </div>
                <button
                  aria-label="关闭"
                  className="bookmark-delete-dialog-close"
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <section className="bookmark-delete-card">
                <div className="bookmark-delete-card-icon" aria-hidden="true">
                  <Icon name="folder_open" />
                </div>
                <div className="bookmark-delete-card-body">
                  <strong title={folderDeleteTarget.path}>{folderDeleteTarget.path}</strong>
                  <span className="bookmark-delete-card-domain">子收藏夹会自动上移一层</span>
                </div>
              </section>

              <div className="bookmark-delete-warning">
                <p>删除后，这个收藏夹会消失，当前文件夹里的网页会解除归档，但不会被删除。</p>
              </div>

              {error ? <p className="manager-dialog-error bookmark-delete-dialog-error">{error}</p> : null}

              <div className="bookmark-delete-dialog-actions">
                <button className="bookmark-delete-action is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="bookmark-delete-action is-danger" type="button" onClick={onConfirmDelete} disabled={busy}>
                  {busy ? "处理中..." : submitLabel}
                </button>
              </div>
            </div>
          </>
        ) : isDeleteDialog && tagDeleteTarget ? (
          <>
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

            <section className="manager-dialog-hero">
              <div className="manager-dialog-mark is-tag">TAG</div>
              <div className="manager-dialog-hero-copy">
                <strong>{`#${tagDeleteTarget.name}`}</strong>
                <span>删除后，这个标签会从所有相关网页上解绑。</span>
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
          <>
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

            <form className="manager-dialog-form" onSubmit={onSubmit}>
              <section className="manager-dialog-hero">
                <div className={isFolderDialog ? "manager-dialog-mark is-folder" : "manager-dialog-mark is-tag"}>
                  {isFolderDialog ? "DIR" : "TAG"}
                </div>
                <div className="manager-dialog-hero-copy">
                  <strong>
                    {state.kind === "edit-folder"
                      ? (pathValue.trim() || state.folder.path)
                      : `#${nameValue.trim() || "新标签"}`}
                  </strong>
                  <span>
                    {state.kind === "edit-folder"
                      ? "完整路径支持多层结构，例如：工作/研究/案例。"
                      : "先预览一下最终效果，不满意可以继续改。"}
                  </span>
                </div>
              </section>

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

              {state.kind === "edit-tag" ? (
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
          </>
        )}
      </div>
    </div>
  );
}
