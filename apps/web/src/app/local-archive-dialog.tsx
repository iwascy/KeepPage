import type { Bookmark } from "@keeppage/domain";
import { Icon } from "../components/Icon";

export type LocalArchiveDialogState =
  | { step: "closed" }
  | { step: "confirm"; bookmarks: Bookmark[] }
  | {
      step: "done";
      totalCount: number;
      acceptedCount: number;
      skippedCount: number;
      queueSize: number;
    };

function DialogCloseIcon() {
  return (
    <Icon name="close" />
  );
}

export function LocalArchiveDialog({
  state,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  state: LocalArchiveDialogState;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (state.step === "closed") {
    return null;
  }

  const totalCount = state.step === "confirm" ? state.bookmarks.length : state.totalCount;

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
        aria-labelledby="local-archive-title"
        aria-modal="true"
        className="create-folder-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="create-folder-dialog-shell">
          <div className="create-folder-dialog-header">
            <div className="create-folder-dialog-heading">
              <h2 id="local-archive-title">本地插件存档</h2>
              <p>
                {state.step === "confirm"
                  ? "任务会发送到本地浏览器插件，按队列顺序逐条存档，避免一次并发过多。"
                  : "任务已经提交到本地插件队列。"}
              </p>
            </div>
            <button
              className="create-folder-dialog-close"
              type="button"
              aria-label="关闭"
              onClick={onClose}
              disabled={busy}
            >
              <DialogCloseIcon />
            </button>
          </div>

          {state.step === "confirm" ? (
            <div className="archive-dialog-panel">
              {error ? <p className="manager-dialog-error create-folder-dialog-error">{error}</p> : null}
              <div className="manager-dialog-hero">
                <div className="manager-dialog-heading">
                  <h2>确认发送 {totalCount} 条书签？</h2>
                  <p>扩展会自动排队抓取，并在抓取完成后继续走同步流程。</p>
                </div>
              </div>
              <div className="create-folder-dialog-actions">
                <button className="create-folder-action-button is-secondary" type="button" onClick={onClose} disabled={busy}>
                  取消
                </button>
                <button className="create-folder-action-button is-primary" type="button" onClick={onConfirm} disabled={busy}>
                  {busy ? "发送中..." : "发送到本地插件"}
                </button>
              </div>
            </div>
          ) : (
            <div className="archive-dialog-panel">
              <div className="archive-dialog-status">
                <p className="archive-dialog-status-text">
                  已提交 {state.acceptedCount} / {state.totalCount} 条到本地插件队列。
                </p>
                <p className="archive-dialog-note">
                  {state.skippedCount > 0
                    ? `其中 ${state.skippedCount} 条已在队列中，已自动跳过。`
                    : "没有检测到重复任务。"}
                </p>
                <p className="archive-dialog-note">当前队列剩余 {state.queueSize} 条待处理。</p>
              </div>
              <div className="create-folder-dialog-actions is-single">
                <button className="create-folder-action-button is-primary" type="button" onClick={onClose}>
                  我知道了
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
