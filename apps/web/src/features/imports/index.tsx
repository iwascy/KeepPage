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
} from "../../api";
import { Icon } from "../../components/Icon";
import { formatWhen } from "../../lib/date-format";

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
  description: string;
}> = [
  { value: "url_list", title: "链接列表", description: "粘贴网址，每行一条" },
  { value: "csv_txt", title: "文本文件", description: "支持 CSV、TXT、Markdown" },
  { value: "browser_html", title: "书签 HTML", description: "导入浏览器导出的书签" },
  { value: "browser_extension", title: "浏览器扩展", description: "读取扩展导出的内容" },
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
          <h1>导入书签</h1>
          <p>选择导入来源，检查内容与分类，再将书签加入资料库。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>
          导入历史
        </button>
      </header>

      <form className="import-card import-form" onSubmit={handlePreview} aria-busy={previewLoading || submitting}>
        <section className="import-section" aria-labelledby="import-source-title">
          <h2 id="import-source-title">导入来源</h2>
          <div className="source-grid" role="group" aria-label="选择导入来源">
            {SOURCE_OPTIONS.map((source) => (
              <button
                key={source.value}
                className={`source-card${sourceType === source.value ? " is-active" : ""}`}
                type="button"
                aria-pressed={sourceType === source.value}
                disabled={previewLoading || submitting}
                onClick={() => setSourceType(source.value)}
              >
                <strong>{source.title}</strong>
                <small>{source.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="import-section" aria-labelledby="import-content-title">
          <h2 id="import-content-title">导入内容</h2>
          <label className="field">
            <span>任务名称 <small>可选</small></span>
            <input
              disabled={previewLoading || submitting}
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="例如：工作资料迁移"
            />
          </label>
          <label className="field">
            <span>链接或文件内容</span>
            <textarea
              disabled={previewLoading || submitting}
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
              <input type="file" aria-label="选择导入文件" accept=".txt,.md,.csv,.html,.htm" disabled={previewLoading || submitting} onChange={handleFileRead} />
            </label>
            <span>{fileName || "支持 .txt、.md、.csv 和书签 .html 文件"}</span>
          </div>
        </section>

        <section className="import-section" aria-labelledby="import-rules-title">
          <h2 id="import-rules-title">导入规则</h2>
          <label className="field">
            <span>导入方式</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)} disabled>
              <option value="links_only">仅导入链接</option>
            </select>
          </label>

          <p className="import-field-hint">导入后可在书签列表中选择条目，通过浏览器插件创建网页存档。</p>
          <details className="import-advanced">
            <summary>重复处理、标题与收藏夹</summary>
            <div className="import-advanced-body">
            <div className="import-config-grid">
              <label className="field">
                <span>重复书签</span>
                <select
                  disabled={previewLoading || submitting}
                  value={dedupeStrategy}
                  onChange={(event) => setDedupeStrategy(event.target.value as ImportPreviewRequest["dedupeStrategy"])}
                >
                  <option value="merge">重复时合并</option>
                  <option value="skip">重复时跳过</option>
                  <option value="update_meta">重复时更新元数据</option>
                </select>
              </label>
              <label className="field">
                <span>标题来源</span>
                <select
                  disabled={previewLoading || submitting}
                  value={titleStrategy}
                  onChange={(event) => setTitleStrategy(event.target.value as ImportPreviewRequest["titleStrategy"])}
                >
                  <option value="prefer_input">优先原始标题</option>
                  <option value="prefer_web">优先网页标题</option>
                  <option value="update_later">导入后再更新</option>
                </select>
              </label>
              <label className="field">
                <span>收藏夹结构</span>
                <select
                  disabled={previewLoading || submitting}
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
                <span>目标收藏夹路径</span>
                <input
                  disabled={previewLoading || submitting}
                  value={targetFolderPath}
                  onChange={(event) => setTargetFolderPath(event.target.value)}
                  placeholder="文件夹路径，例如：导入/2026-03"
                />
              </label>
            ) : null}
            </div>
          </details>
        </section>

        <div className="import-action-row">
          <button className="secondary-button" type="submit" disabled={!canPreview || previewLoading || submitting}>
            {previewLoading ? "检查中…" : "预览导入结果"}
          </button>
          <button className="primary-button" type="button" disabled={!canStartImport} onClick={handleStartImport}>
            {submitting ? "正在创建任务…" : "开始导入"}
          </button>
        </div>
        {previewError ? <p className="auth-error" role="alert">{previewError}</p> : null}
        {submitError ? <p className="auth-error" role="alert">{submitError}</p> : null}
      </form>

      {preview ? (
        <section className="import-card import-preview" aria-labelledby="import-preview-title">
          <header className="import-section-heading"><h2 id="import-preview-title">导入预览</h2><p>以下为预检结果，尚未写入书签。</p></header>
          <div className="summary import-summary">
            <article className="metric"><p>总数</p><h3>{getPreviewTotalCount(preview)}</h3></article>
            <article className="metric"><p>有效</p><h3>{preview.stats.validCount}</h3></article>
            <article className="metric"><p>新建</p><h3>{getPreviewCreateCount(preview)}</h3></article>
            <article className="metric"><p>重复</p><h3>{getPreviewDuplicateCount(preview)}</h3></article>
          </div>
          <div className="import-table-wrap">
            <table className="import-table">
              <caption>收藏夹分布</caption>
              <thead>
                <tr>
                  <th scope="col">收藏夹</th>
                  <th scope="col">数量</th>
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
            <table className="import-table is-samples">
              <caption>条目样本</caption>
              <thead>
                <tr>
                  <th scope="col">标题</th>
                  <th scope="col">URL</th>
                  <th scope="col">收藏夹</th>
                  <th scope="col">标签</th>
                  <th scope="col">状态</th>
                  <th scope="col">说明</th>
                </tr>
              </thead>
              <tbody>
                {preview.samples.length === 0 ? (
                  <tr><td colSpan={6}>暂无预览条目</td></tr>
                ) : (
                  preview.samples.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td><span className="ellipsis-cell" title={item.url}>{item.url}</span></td>
                      <td>{item.folderPath ?? "—"}</td>
                      <td>{item.sourceTags?.length ? item.sourceTags.join(", ") : "—"}</td>
                      <td>{({ valid: "可导入", invalid: "无效内容", duplicate_in_file: "文件内重复", duplicate_in_library: "资料库中已存在" })[item.status]}</td>
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
          <h1>导入历史</h1>
          <p>查看每个导入批次的解析状态、成功率和后续归档结果。</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenNew}>
          新建导入
        </button>
      </header>

      {loadState === "loading" ? (
        <section className="import-state-panel" role="status" aria-busy="true">正在读取导入记录…</section>
      ) : loadState === "error" ? (
        <section className="import-state-panel">
          <h2>加载失败</h2>
          <p>{error ?? "暂时无法读取导入任务。"}</p>
        </section>
      ) : tasks.length === 0 ? (
        <section className="import-state-panel">
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
                      <Icon name="arrow_outward" />
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
    return <section className="import-shell"><section className="import-state-panel" role="status" aria-busy="true">正在读取任务详情…</section></section>;
  }

  if (loadState === "error") {
    return (
      <section className="import-state-panel">
        <h2>导入详情加载失败</h2>
        <p>{error ?? "请稍后重试。"}</p>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>返回导入历史</button>
      </section>
    );
  }

  if (loadState === "not-found" || !detail) {
    return (
      <section className="import-state-panel">
        <h2>导入任务不存在</h2>
        <p>该任务可能已被删除，或当前账号无权限访问。</p>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>返回导入历史</button>
      </section>
    );
  }

  const { task } = detail;
  const successCount = getTaskSuccessCount(task);

  return (
    <section className="import-shell">
      <header className="import-header">
        <div className="import-header-copy">
          <h1>{task.name}</h1>
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
        <h2 className="import-section-title">任务概览</h2>
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

      <h2 className="import-section-title">条目明细 <small>{detail.items.length} 条</small></h2>
      <section className="import-item-grid" aria-label="导入条目明细">
        {detail.items.length === 0 ? (
          <section className="import-state-panel">
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
                <Icon name="link" />
                <span className="ellipsis-cell" title={item.url}>{item.url}</span>
              </div>

              <div className="import-item-meta">
                <div className="import-item-meta-row">
                  <span>处理结果</span>
                  <strong>{({ none: "未发生重复", created_bookmark: "新建书签", merged_existing: "合并已有书签", skipped_existing: "跳过已有书签", skipped_duplicate: "跳过重复条目", invalid_input: "无效内容" } as Record<string, string>)[item.dedupeResult ?? ""] ?? item.dedupeResult ?? "—"}</strong>
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
