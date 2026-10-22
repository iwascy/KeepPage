import type { CaptureTask } from "@keeppage/domain";
import { privateSyncStateLabel, qualityGradeLabel } from "../../../src/lib/ui-shared/capture-status";
import { SiteIcon, StatusChip, formatDateTime } from "./common";
import { ArchiveIcon, LockIcon } from "./icons";

type TaskListProps = {
  tasks: CaptureTask[];
  hideTaskContent: boolean;
  emptyText: string;
  onSelect: (id: string) => void;
};

export function TaskList({ tasks, hideTaskContent, emptyText, onSelect }: TaskListProps) {
  return (
    <section aria-labelledby="sp-task-list-title" className="sp-tasks">
      <div className="sp-section-head">
        <h2 id="sp-task-list-title">最近保存</h2>
        {tasks.length > 0 && <span>{tasks.length}</span>}
      </div>

      {tasks.length === 0 ? (
        <div className="sp-empty">
          <span className="sp-empty-icon"><ArchiveIcon size={20} /></span>
          <p>{emptyText}</p>
        </div>
      ) : (
        <ul className="sp-task-list">
          {tasks.map((task) => {
            const locked = hideTaskContent && task.isPrivate;
            const syncLabel = task.isPrivate ? privateSyncStateLabel(task.syncState) : null;
            return (
              <li key={task.id}>
                <button className="sp-task" onClick={() => onSelect(task.id)} type="button">
                  <div className="sp-task-main">
                    <strong className="sp-task-title">
                      {locked ? "私密条目" : task.source.title || "未命名网页"}
                    </strong>
                    {locked ? (
                      <span className="sp-site-icon is-sm" aria-hidden="true"><LockIcon size={14} /></span>
                    ) : (
                      <SiteIcon favIconUrl={task.source.faviconUrl} label={task.source.domain} size="sm" />
                    )}
                  </div>

                  {!locked && task.source.captureScope === "selection" && task.source.selectionText && (
                    <p className="sp-task-excerpt">{task.source.selectionText}</p>
                  )}

                  <div className="sp-task-meta">
                    <span className="sp-task-domain">{locked ? "解锁后可查看" : task.source.domain}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(task.updatedAt)}</span>
                  </div>

                  <div className="sp-task-foot">
                    <StatusChip task={task} />
                    {task.source.captureScope === "selection" && !locked && <span className="sp-chip">选区</span>}
                    {syncLabel && <span className="sp-chip">{syncLabel}</span>}
                    {!locked && task.quality && (
                      <span className="sp-task-quality">
                        质量 {qualityGradeLabel(task.quality.grade)} · {task.quality.score}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
