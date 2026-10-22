import type { ReactNode } from "react";
import type { CaptureTask } from "@keeppage/domain";
import { ensureArchiveBaseHref } from "../../../src/lib/domain-runtime";
import {
  captureScopeLabel,
  privateSyncStateLabel,
  qualityGradeLabel,
} from "../../../src/lib/ui-shared/capture-status";
import { StatusChip, formatDateTime } from "./common";
import { PrivateClassificationCard } from "./PrivateClassificationCard";
import { BackIcon, ExternalIcon, LockIcon, RetryIcon } from "./icons";

type TaskDetailProps = {
  task: CaptureTask;
  locked: boolean;
  retryLabel: string;
  retryDisabled: boolean;
  onRetry: () => void;
  onOpenPreview: () => void;
  onBack: () => void;
  notice?: ReactNode;
  /** Private vault rejected the private token; the parent should refresh vault state. */
  onPrivateLocked?: () => void;
};

export function TaskDetail({ task, locked, retryLabel, retryDisabled, onRetry, onOpenPreview, onBack, notice, onPrivateLocked }: TaskDetailProps) {
  const syncLabel = task.isPrivate ? privateSyncStateLabel(task.syncState) : null;
  const canClassifyPrivate = Boolean(task.isPrivate && !locked && task.status === "synced" && task.bookmarkId);
  return (
    <div className="sp-detail">
      <div className="sp-subnav">
        <button className="sp-back" onClick={onBack} type="button">
          <BackIcon />
          最近保存
        </button>
      </div>

      {notice}

      {locked ? (
        <section className="sp-card sp-detail-locked">
          <span className="sp-empty-icon"><LockIcon size={20} /></span>
          <h2>私密条目已锁定</h2>
          <p>解锁私密模式后，可以查看标题、质量诊断和存档预览。</p>
          <div className="sp-detail-chips">
            <StatusChip task={task} />
            <span className="sp-detail-time">{formatDateTime(task.updatedAt)}</span>
          </div>
        </section>
      ) : (
        <>
          <header className="sp-detail-head">
            <h2>{task.source.title || "未命名网页"}</h2>
            <a className="sp-detail-url" href={task.source.url} rel="noreferrer" target="_blank" title={task.source.url}>
              <span>{task.source.url}</span>
              <ExternalIcon size={12} />
            </a>
            <div className="sp-detail-chips">
              <StatusChip task={task} />
              <span className="sp-chip">{captureScopeLabel(task.source.captureScope)}</span>
              {syncLabel && <span className="sp-chip">{syncLabel}</span>}
              <span className="sp-detail-time">{formatDateTime(task.updatedAt)}</span>
            </div>
          </header>

          <div className="sp-detail-actions">
            <button className="sp-button is-secondary is-grow" disabled={retryDisabled} onClick={onRetry} type="button">
              <RetryIcon />
              {retryLabel}
            </button>
            <button className="sp-button is-secondary is-grow" onClick={onOpenPreview} type="button">
              <ExternalIcon />
              新标签页打开
            </button>
          </div>

          {task.failureReason && (
            <div className="sp-notice is-error" role="alert">
              <span className="sp-notice-text">失败原因：{task.failureReason}</span>
            </div>
          )}

          {canClassifyPrivate && task.bookmarkId && (
            <PrivateClassificationCard bookmarkId={task.bookmarkId} key={task.bookmarkId} onLocked={onPrivateLocked} />
          )}

          {task.source.captureScope === "selection" && task.source.selectionText && (
            <section className="sp-card sp-detail-block">
              <h3>选区内容</h3>
              <p className="sp-selection-text">{task.source.selectionText}</p>
            </section>
          )}

          <section className="sp-card sp-detail-block">
            <div className="sp-detail-block-head">
              <h3>存档质量</h3>
              <span className={`sp-quality ${task.quality ? `is-${task.quality.grade}` : ""}`}>
                {task.quality ? `${qualityGradeLabel(task.quality.grade)} · ${task.quality.score} 分` : "待评估"}
              </span>
            </div>
            {task.quality?.reasons && task.quality.reasons.length > 0 ? (
              <ul className="sp-reasons">
                {task.quality.reasons.slice(0, 3).map((reason) => (
                  <li key={reason.code}>{reason.message}</li>
                ))}
              </ul>
            ) : (
              <p className="sp-muted">{task.quality ? "没有发现明显问题。" : "保存完成后会生成质量诊断。"}</p>
            )}
          </section>

          <section className="sp-card sp-preview">
            <div className="sp-detail-block-head">
              <h3>存档预览</h3>
            </div>
            {task.artifacts?.archiveHtml ? (
              <iframe
                className="sp-preview-frame"
                sandbox="allow-same-origin"
                srcDoc={ensureArchiveBaseHref(
                  task.artifacts.archiveHtml,
                  task.source.canonicalUrl ?? task.source.url,
                )}
                title="存档预览"
              />
            ) : (
              <p className="sp-preview-empty">存档生成后可在这里预览。</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
