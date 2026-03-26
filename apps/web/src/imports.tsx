import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  createImportTask as createImportTaskRequest,
  fetchImportTaskDetail as fetchImportTaskDetailRequest,
  fetchImportTasks as fetchImportTasksRequest,
  previewImport as previewImportRequest,
  type ImportItemStatus,
  type ImportMode,
  type ImportPreviewRequest,
  type ImportPreviewResult,
  type ImportSourceType,
  type ImportTaskDetailResult,
  type ImportTaskStatus,
  type ImportTaskSummary,
} from "./api";

export type ImportPanelAdapter = {
  previewImport?: (input: ImportPreviewRequest, token: string) => Promise<ImportPreviewResult>;
  createImportTask?: (input: ImportPreviewRequest & { name: string }, token: string) => Promise<{ taskId: string }>;
  fetchImportTasks?: (token: string) => Promise<ImportTaskSummary[]>;
  fetchImportTaskDetail?: (taskId: string, token: string) => Promise<ImportTaskDetailResult | null>;
};

type ImportSharedProps = {
  token: string;
  onApiError: (error: unknown) => boolean;
  adapter?: ImportPanelAdapter;
};

const SOURCE_OPTIONS: Array<{
  value: ImportSourceType;
  title: string;
}> = [
  { value: "url_list", title: "URL 列表" },
  { value: "csv_txt", title: "CSV / TXT / MD" },
  { value: "browser_html", title: "书签 HTML" },
  { value: "browser_extension", title: "浏览器扩展" },
];

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function formatWhen(input: string) {
  if (!input) {
    return "未知";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function importModeLabel(mode: ImportMode) {
  if (mode === "queue_archive") {
    return "导入后排队归档";
  }
  if (mode === "archive_now") {
    return "导入并立即归档";
  }
  return "仅导入链接";
}

function importSourceLabel(source: ImportSourceType) {
  if (source === "browser_html") {
    return "书签 HTML";
  }
  if (source === "csv_txt") {
    return "CSV/TXT/MD 文件";
  }
  if (source === "browser_extension") {
    return "浏览器扩展";
  }
  return "URL 列表";
}

function importTaskStatusLabel(status: ImportTaskStatus) {
  const map: Record<ImportTaskStatus, string> = {
    draft: "草稿",
    parsing: "解析中",
    ready: "已就绪",
    running: "执行中",
    paused: "已暂停",
    completed: "已完成",
    partial_failed: "部分失败",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status];
}

function importItemStatusLabel(status: ImportItemStatus) {
  const map: Record<ImportItemStatus, string> = {
    pending: "待处理",
    deduplicated: "已去重",
    created_bookmark: "已创建书签",
    queued_for_archive: "等待归档",
    archiving: "归档中",
    archived: "已归档",
    skipped: "已跳过",
    failed: "失败",
  };
  return map[status];
}

function getPreviewTotalCount(preview: ImportPreviewResult) {
  return preview.stats.totalCount ?? preview.stats.rawTotal ?? 0;
}

function getPreviewCreateCount(preview: ImportPreviewResult) {
  return preview.stats.estimatedCreateCount ?? preview.stats.willCreateCount ?? 0;
}

function getPreviewDuplicateCount(preview: ImportPreviewResult) {
  return preview.stats.duplicateExistingCount ?? preview.stats.duplicateInLibraryCount ?? 0;
}

function getTaskCreatedCount(task: ImportTaskSummary) {
  return task.createdCount ?? task.successCount ?? 0;
}

function getTaskSuccessCount(task: ImportTaskSummary) {
  return getTaskCreatedCount(task) + task.mergedCount + task.skippedCount;
}

function getItemReason(item: ImportTaskDetailResult["items"][number]) {
  return item.reason ?? item.errorReason ?? "—";
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "0%";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function ImportNewPanel({
  token,
  onApiError,
  adapter,
  onOpenHistory,
  onOpenTask,
}: ImportSharedProps & {
  onOpenHistory: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [sourceType, setSourceType] = useState<ImportSourceType>("url_list");
  const [taskName, setTaskName] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<ImportMode>("links_only");
  const [dedupeStrategy, setDedupeStrategy] = useState<ImportPreviewRequest["dedupeStrategy"]>("merge");
  const [titleStrategy, setTitleStrategy] = useState<ImportPreviewRequest["titleStrategy"]>("prefer_input");
  const [targetFolderMode, setTargetFolderMode] = useState<ImportPreviewRequest["targetFolderMode"]>("keep_source");
  const [targetFolderPath, setTargetFolderPath] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canPreview = rawInput.trim().length > 0;
  const canStartImport = canPreview && !submitting && !previewLoading;

  const requestBody: ImportPreviewRequest = {
    sourceType,
    rawInput,
    fileName: fileName || undefined,
    mode,
    dedupeStrategy,
    titleStrategy,
    targetFolderMode,
    targetFolderPath: targetFolderPath.trim() || undefined,
  };
  const runPreviewImport = adapter?.previewImport ?? previewImportRequest;
  const runCreateImportTask = adapter?.createImportTask ?? createImportTaskRequest;

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPreview) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setSubmitError(null);

    try {
      const result = await runPreviewImport(requestBody, token);
      setPreview(result);
    } catch (error) {
      if (onApiError(error)) {
        return;
      }
      setPreview(null);
      setPreviewError(toErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleStartImport() {
    if (!canStartImport) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await runCreateImportTask(
        {
          ...requestBody,
          name: taskName.trim() || `批量导入 ${new Date().toLocaleString("zh-CN")}`,
        },
        token,
      );
      if (!result.taskId) {
        throw new Error("导入任务创建成功，但返回了空任务 ID。");
      }
      onOpenTask(result.taskId);
    } catch (error) {
      if (onApiError(error)) {
        return;
      }
      setSubmitError(toErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileRead(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setFileName(file.name);
    const content = await file.text();
    setRawInput(content);
  }

  return (
    <section className="import-shell">
      <header className="import-header">
        <div className="import-header-copy">
          <p className="eyebrow">Bulk Import</p>
          <h2>新建导入</h2>
          <p>粘贴链接、浏览器书签导出文件或批量文本，先预检再按你的策略写入 KeepPage。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>
          导入历史
        </button>
      </header>

      <form className="import-card import-form" onSubmit={handlePreview}>
        <div className="import-section">
          <div className="source-grid">
            {SOURCE_OPTIONS.map((source) => (
              <button
                key={source.value}
                className={`source-card${sourceType === source.value ? " is-active" : ""}`}
                type="button"
                onClick={() => setSourceType(source.value)}
              >
                <strong>{source.title}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="import-section">
          <label className="field">
            <input
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="任务名称（可选）"
            />
          </label>
          <label className="field">
            <textarea
              className="input-textarea"
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              rows={7}
              placeholder="每行一个 URL，或粘贴书签 HTML / CSV 内容"
            />
          </label>
          <div className="upload-row">
            <label className="secondary-button upload-button">
              读取文件
              <input type="file" accept=".txt,.md,.csv,.html,.htm" onChange={handleFileRead} />
            </label>
            <span>{fileName || "未选择文件"}</span>
          </div>
        </div>

        <div className="import-section">
          <label className="field">
            <select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
              <option value="links_only">仅导入链接</option>
              <option value="queue_archive">导入后排队归档</option>
              <option value="archive_now">导入并立即归档</option>
            </select>
          </label>

          <details className="import-advanced">
            <summary>高级选项</summary>
            <div className="import-config-grid">
              <label className="field">
                <select
                  value={dedupeStrategy}
                  onChange={(event) => setDedupeStrategy(event.target.value as ImportPreviewRequest["dedupeStrategy"])}
                >
                  <option value="merge">重复时合并</option>
                  <option value="skip">重复时跳过</option>
                  <option value="update_meta">重复时更新元数据</option>
                </select>
              </label>
              <label className="field">
                <select
                  value={titleStrategy}
                  onChange={(event) => setTitleStrategy(event.target.value as ImportPreviewRequest["titleStrategy"])}
                >
                  <option value="prefer_input">优先原始标题</option>
                  <option value="prefer_web">优先网页标题</option>
                  <option value="update_later">导入后再更新</option>
                </select>
              </label>
              <label className="field">
                <select
                  value={targetFolderMode}
                  onChange={(event) =>
                    setTargetFolderMode(event.target.value as ImportPreviewRequest["targetFolderMode"])}
                >
                  <option value="keep_source">保留原路径</option>
                  <option value="specific_folder">指定文件夹</option>
                  <option value="flatten">扁平化导入</option>
                </select>
              </label>
            </div>
            {targetFolderMode === "specific_folder" ? (
              <label className="field">
                <input
                  value={targetFolderPath}
                  onChange={(event) => setTargetFolderPath(event.target.value)}
                  placeholder="文件夹路径，例如：导入/2026-03"
                />
              </label>
            ) : null}
          </details>
        </div>

        <div className="import-action-row">
          <button className="secondary-button" type="submit" disabled={!canPreview || previewLoading}>
            {previewLoading ? "预检中..." : "预检"}
          </button>
          <button className="primary-button" type="button" disabled={!canStartImport} onClick={handleStartImport}>
            {submitting ? "导入中..." : importModeLabel(mode)}
          </button>
        </div>
        {previewError ? <p className="auth-error">{previewError}</p> : null}
        {submitError ? <p className="auth-error">{submitError}</p> : null}
      </form>

      {preview ? (
        <section className="import-card import-preview">
          <div className="summary import-summary">
            <article className="metric"><p>总数</p><h3>{getPreviewTotalCount(preview)}</h3></article>
            <article className="metric"><p>有效</p><h3>{preview.stats.validCount}</h3></article>
            <article className="metric"><p>新建</p><h3>{getPreviewCreateCount(preview)}</h3></article>
            <article className="metric"><p>重复</p><h3>{getPreviewDuplicateCount(preview)}</h3></article>
          </div>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>收藏夹</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {preview.folders.length === 0 ? (
                  <tr><td colSpan={2}>未识别出收藏夹层级</td></tr>
                ) : (
                  preview.folders.map((folder) => (
                    <tr key={folder.path}>
                      <td>{folder.path}</td>
                      <td>{folder.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>URL</th>
                  <th>收藏夹</th>
                  <th>标签</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {preview.samples.length === 0 ? (
                  <tr><td colSpan={6}>暂无预览条目</td></tr>
                ) : (
                  preview.samples.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td><span className="ellipsis-cell">{item.url}</span></td>
                      <td>{item.folderPath ?? "—"}</td>
                      <td>{item.sourceTags?.length ? item.sourceTags.join(", ") : "—"}</td>
                      <td>{item.status}</td>
                      <td>{item.reason || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function ImportHistoryPanel({
  token,
  onApiError,
  adapter,
  onOpenTask,
  onOpenNew,
}: ImportSharedProps & {
  onOpenTask: (taskId: string) => void;
  onOpenNew: () => void;
}) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ImportTaskSummary[]>([]);
  const runFetchImportTasks = adapter?.fetchImportTasks ?? fetchImportTasksRequest;

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    runFetchImportTasks(token)
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setTasks(rows);
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled || onApiError(err)) {
          return;
        }
        setTasks([]);
        setLoadState("error");
        setError(toErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, runFetchImportTasks, onApiError]);

  const completedTaskCount = tasks.filter((task) => task.status === "completed").length;
  const activeTaskCount = tasks.filter((task) => (
    task.status === "draft"
    || task.status === "parsing"
    || task.status === "ready"
    || task.status === "running"
    || task.status === "paused"
  )).length;
  const archiveCount = tasks.reduce((sum, task) => sum + task.archiveSuccessCount, 0);

  return (
    <section className="import-shell">
      <header className="import-header">
        <div className="import-header-copy">
          <p className="eyebrow">Import Activity</p>
          <h2>导入历史</h2>
          <p>查看每个导入批次的解析状态、成功率和后续归档结果。</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenNew}>
          新建导入
        </button>
      </header>

      {loadState === "loading" ? (
        <section className="loading">正在加载...</section>
      ) : loadState === "error" ? (
        <section className="empty-state">
          <h2>加载失败</h2>
          <p>{error ?? "暂时无法读取导入任务。"}</p>
        </section>
      ) : tasks.length === 0 ? (
        <section className="empty-state">
          <h2>还没有导入任务</h2>
          <p>先创建一个导入任务开始吧。</p>
        </section>
      ) : (
        <>
          <section className="summary import-summary">
            <article className="metric"><p>任务数</p><h3>{tasks.length}</h3></article>
            <article className="metric"><p>已完成</p><h3>{completedTaskCount}</h3></article>
            <article className="metric"><p>进行中</p><h3>{activeTaskCount}</h3></article>
            <article className="metric"><p>已归档</p><h3>{archiveCount}</h3></article>
          </section>

          <section className="import-activity-grid" aria-label="导入任务列表">
            {tasks.map((task) => {
              const successCount = getTaskSuccessCount(task);
              const successRate = formatPercent(successCount, task.totalCount);
              const archiveRate = formatPercent(task.archiveSuccessCount, task.totalCount);

              return (
                <button
                  key={task.id}
                  className="import-activity-card"
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                >
                  <div className="import-activity-card-head">
                    <p className="eyebrow">{importSourceLabel(task.sourceType)}</p>
                    <span className={`task-status task-status-${task.status}`}>{importTaskStatusLabel(task.status)}</span>
                  </div>
                  <div className="import-activity-card-copy">
                    <h3>{task.name}</h3>
                    <p>{importModeLabel(task.mode)} · 创建于 {formatWhen(task.createdAt)}</p>
                  </div>
                  <div className="import-activity-stats">
                    <span>
                      <strong>{task.totalCount}</strong>
                      <small>总数</small>
                    </span>
                    <span>
                      <strong>{successCount}</strong>
                      <small>成功</small>
                    </span>
                    <span>
                      <strong>{task.failedCount}</strong>
                      <small>失败</small>
                    </span>
                    <span>
                      <strong>{task.archiveSuccessCount}</strong>
                      <small>归档</small>
                    </span>
                  </div>
                  <div className="import-activity-progress-grid">
                    <div className="import-activity-progress-block">
                      <div className="import-activity-progress-copy">
                        <span>导入成功率</span>
                        <strong>{successRate}</strong>
                      </div>
                      <span className="import-activity-progress-track" aria-hidden="true">
                        <span style={{ width: successRate }} />
                      </span>
                    </div>
                    <div className="import-activity-progress-block">
                      <div className="import-activity-progress-copy">
                        <span>归档覆盖率</span>
                        <strong>{archiveRate}</strong>
                      </div>
                      <span className="import-activity-progress-track is-archive" aria-hidden="true">
                        <span style={{ width: archiveRate }} />
                      </span>
                    </div>
                  </div>
                  <div className="import-activity-card-foot">
                    <span>最近更新 {formatWhen(task.updatedAt)}</span>
                    <span className="import-activity-link">
                      查看任务
                      <span className="material-symbols-outlined" aria-hidden="true">
                        arrow_outward
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </section>
        </>
      )}
    </section>
  );
}

export function ImportDetailPanel({
  token,
  taskId,
  onApiError,
  adapter,
  onOpenHistory,
  onOpenBookmark,
}: ImportSharedProps & {
  taskId: string;
  onOpenHistory: () => void;
  onOpenBookmark: (bookmarkId: string) => void;
}) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportTaskDetailResult | null>(null);
  const runFetchImportTaskDetail = adapter?.fetchImportTaskDetail ?? fetchImportTaskDetailRequest;

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    runFetchImportTaskDetail(taskId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setDetail(result);
        setLoadState(result ? "ready" : "not-found");
      })
      .catch((err) => {
        if (cancelled || onApiError(err)) {
          return;
        }
        setDetail(null);
        setLoadState("error");
        setError(toErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, token, runFetchImportTaskDetail, onApiError]);

  if (loadState === "loading") {
    return <section className="loading">正在加载导入详情...</section>;
  }

  if (loadState === "error") {
    return (
      <section className="empty-state">
        <h2>导入详情加载失败</h2>
        <p>{error ?? "请稍后重试。"}</p>
      </section>
    );
  }

  if (loadState === "not-found" || !detail) {
    return (
      <section className="empty-state">
        <h2>导入任务不存在</h2>
        <p>该任务可能已被删除，或当前账号无权限访问。</p>
      </section>
    );
  }

  const { task } = detail;
  const successCount = getTaskSuccessCount(task);

  return (
    <section className="import-shell">
      <header className="import-header">
        <div className="import-header-copy">
          <p className="eyebrow">Import Detail</p>
          <h2>{task.name}</h2>
          <p>
            当前状态为 {importTaskStatusLabel(task.status)}，来源类型是 {importSourceLabel(task.sourceType)}，
            执行模式为 {importModeLabel(task.mode)}。
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>
          返回历史
        </button>
      </header>

      <section className="summary import-summary">
        <article className="metric"><p>总数</p><h3>{task.totalCount}</h3></article>
        <article className="metric"><p>成功</p><h3>{successCount}</h3></article>
        <article className="metric"><p>失败</p><h3>{task.failedCount}</h3></article>
        <article className="metric"><p>归档</p><h3>{task.archiveSuccessCount}</h3></article>
      </section>

      <section className="import-card import-detail-meta-card">
        <div className="import-detail-meta-grid">
          <article className="import-detail-meta-item">
            <span>任务状态</span>
            <strong>{importTaskStatusLabel(task.status)}</strong>
            <small>最近更新 {formatWhen(task.updatedAt)}</small>
          </article>
          <article className="import-detail-meta-item">
            <span>来源类型</span>
            <strong>{importSourceLabel(task.sourceType)}</strong>
            <small>创建于 {formatWhen(task.createdAt)}</small>
          </article>
          <article className="import-detail-meta-item">
            <span>执行模式</span>
            <strong>{importModeLabel(task.mode)}</strong>
            <small>成功率 {formatPercent(successCount, task.totalCount)}</small>
          </article>
          <article className="import-detail-meta-item">
            <span>归档表现</span>
            <strong>{formatPercent(task.archiveSuccessCount, task.totalCount)}</strong>
            <small>{task.archiveSuccessCount} / {task.totalCount} 已生成归档</small>
          </article>
        </div>
      </section>

      <section className="import-item-grid" aria-label="导入条目明细">
        {detail.items.length === 0 ? (
          <section className="empty-state">
            <h2>暂无条目明细</h2>
            <p>当前任务还没有可展示的处理记录。</p>
          </section>
        ) : (
          detail.items.map((item) => (
            <article key={item.id} className="import-item-card">
              <div className="import-item-card-head">
                <div className="import-item-card-copy">
                  <p className="eyebrow">{item.domain}</p>
                  <h3>{item.title}</h3>
                </div>
                <span className={`task-status task-status-${item.status === "failed" ? "failed" : item.status === "archived" ? "completed" : "running"}`}>
                  {importItemStatusLabel(item.status)}
                </span>
              </div>

              <div className="import-item-url">
                <span className="material-symbols-outlined" aria-hidden="true">
                  link
                </span>
                <span className="ellipsis-cell">{item.url}</span>
              </div>

              <div className="import-item-meta">
                <div className="import-item-meta-row">
                  <span>处理结果</span>
                  <strong>{item.dedupeResult ?? "—"}</strong>
                </div>
                <div className="import-item-meta-row">
                  <span>收藏夹</span>
                  <strong>{item.folderPath ?? item.sourceFolderPath ?? "—"}</strong>
                </div>
              </div>

              <div className="import-item-reason">
                <span>说明</span>
                <p>{getItemReason(item)}</p>
              </div>

              <div className="import-item-card-foot">
                <div className="import-item-flags">
                  {item.hasArchive ? <span className="tag">已归档</span> : <span className="tag muted-tag">未归档</span>}
                  {item.bookmarkId ? <span className="tag">已入库</span> : <span className="tag muted-tag">未入库</span>}
                </div>
                {item.bookmarkId ? (
                  <button
                    className="secondary-button import-item-action"
                    type="button"
                    onClick={() => onOpenBookmark(item.bookmarkId!)}
                  >
                    查看书签
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
