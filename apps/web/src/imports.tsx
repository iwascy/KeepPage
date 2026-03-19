import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  createImportTask,
  fetchImportTaskDetail,
  fetchImportTasks,
  previewImport,
  type ImportMode,
  type ImportPreviewRequest,
  type ImportPreviewResult,
  type ImportSourceType,
  type ImportTaskDetailResult,
  type ImportTaskStatus,
  type ImportTaskSummary,
} from "./api";

type ImportSharedProps = {
  token: string;
  onApiError: (error: unknown) => boolean;
};

const SOURCE_OPTIONS: Array<{
  value: ImportSourceType;
  title: string;
  desc: string;
  hint: string;
}> = [
  {
    value: "url_list",
    title: "粘贴 URL 列表",
    desc: "适合从笔记、文档、聊天记录直接粘贴链接。",
    hint: "支持后续批量归档",
  },
  {
    value: "csv_txt",
    title: "上传 CSV / TXT / MD",
    desc: "适合已有链接清单文件，自动提取可导入 URL。",
    hint: "可保留原始文本行",
  },
  {
    value: "browser_html",
    title: "导入书签 HTML",
    desc: "适合浏览器导出的书签文件，可预览结构。",
    hint: "可保留文件夹路径",
  },
  {
    value: "browser_extension",
    title: "从浏览器扩展导入",
    desc: "适合已安装扩展后直连读取书签树。",
    hint: "依赖扩展能力",
  },
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

export function ImportNewPanel({
  token,
  onApiError,
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
  const [addBatchTag, setAddBatchTag] = useState(true);
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
    addBatchTag,
  };

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPreview) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setSubmitError(null);

    try {
      const result = await previewImport(requestBody, token);
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
      const result = await createImportTask(
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
        <div>
          <p className="eyebrow">Import</p>
          <h2>新建导入</h2>
          <p className="subtitle">先轻导入链接，再按需归档，降低首次迁移阻力。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>
          查看导入历史
        </button>
      </header>

      <form className="import-card import-form" onSubmit={handlePreview}>
        <div className="import-section">
          <h3>来源选择</h3>
          <div className="source-grid">
            {SOURCE_OPTIONS.map((source) => (
              <button
                key={source.value}
                className={`source-card${sourceType === source.value ? " is-active" : ""}`}
                type="button"
                onClick={() => setSourceType(source.value)}
              >
                <strong>{source.title}</strong>
                <p>{source.desc}</p>
                <span>{source.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="import-section">
          <h3>输入内容</h3>
          <label className="field">
            <span>任务名称</span>
            <input
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="例如：Chrome 旧书签迁移"
            />
          </label>
          <label className="field">
            <span>粘贴链接或原始文本</span>
            <textarea
              className="input-textarea"
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              rows={9}
              placeholder="每行一个 URL，或粘贴书签 HTML / CSV / TXT 内容。"
            />
          </label>
          <div className="upload-row">
            <label className="secondary-button upload-button">
              读取本地文件
              <input type="file" accept=".txt,.md,.csv,.html,.htm" onChange={handleFileRead} />
            </label>
            <span>{fileName || "未选择文件"}</span>
          </div>
        </div>

        <div className="import-section">
          <h3>导入配置</h3>
          <div className="import-config-grid">
            <label className="field">
              <span>导入模式</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
                <option value="links_only">仅导入链接</option>
                <option value="queue_archive">导入后排队归档</option>
                <option value="archive_now">导入并立即归档</option>
              </select>
            </label>
            <label className="field">
              <span>去重策略</span>
              <select
                value={dedupeStrategy}
                onChange={(event) => setDedupeStrategy(event.target.value as ImportPreviewRequest["dedupeStrategy"])}
              >
                <option value="merge">命中重复时合并</option>
                <option value="skip">命中重复时跳过</option>
                <option value="update_meta">命中重复时更新元数据</option>
              </select>
            </label>
            <label className="field">
              <span>标题策略</span>
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
              <span>目标位置</span>
              <select
                value={targetFolderMode}
                onChange={(event) =>
                  setTargetFolderMode(event.target.value as ImportPreviewRequest["targetFolderMode"])}
              >
                <option value="keep_source">保留原路径</option>
                <option value="specific_folder">导入到指定文件夹</option>
                <option value="flatten">扁平化导入</option>
              </select>
            </label>
          </div>
          {targetFolderMode === "specific_folder" ? (
            <label className="field">
              <span>指定文件夹路径</span>
              <input
                value={targetFolderPath}
                onChange={(event) => setTargetFolderPath(event.target.value)}
                placeholder="例如：导入/2026-03"
              />
            </label>
          ) : null}
          <label className="check-row">
            <input
              type="checkbox"
              checked={addBatchTag}
              onChange={(event) => setAddBatchTag(event.target.checked)}
            />
            <span>追加导入批次标签</span>
          </label>
        </div>

        <div className="import-action-row">
          <button className="secondary-button" type="submit" disabled={!canPreview || previewLoading}>
            {previewLoading ? "预检中..." : "预检查并预览"}
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
          <div className="panel-header-inline">
            <h3>预检结果</h3>
            <span className="panel-subtle">来源：{importSourceLabel(preview.sourceType)}</span>
          </div>
          <div className="summary import-summary">
            <article className="metric"><p>原始总数</p><h3>{preview.stats.rawTotal}</h3></article>
            <article className="metric"><p>有效条目</p><h3>{preview.stats.validCount}</h3></article>
            <article className="metric"><p>无效条目</p><h3>{preview.stats.invalidCount}</h3></article>
            <article className="metric"><p>文件内重复</p><h3>{preview.stats.duplicateInFileCount}</h3></article>
            <article className="metric"><p>站内重复</p><h3>{preview.stats.duplicateInLibraryCount}</h3></article>
            <article className="metric"><p>预计新建</p><h3>{preview.stats.willCreateCount}</h3></article>
            <article className="metric"><p>预计合并</p><h3>{preview.stats.willMergeCount}</h3></article>
            <article className="metric"><p>预计跳过</p><h3>{preview.stats.willSkipCount}</h3></article>
          </div>
          <div className="domain-row">
            {preview.domains.slice(0, 8).map((entry) => (
              <span key={entry.domain} className="tag">#{entry.domain} · {entry.count}</span>
            ))}
          </div>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>URL</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {preview.samples.length === 0 ? (
                  <tr><td colSpan={4}>暂无预览条目</td></tr>
                ) : (
                  preview.samples.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td><span className="ellipsis-cell">{item.url}</span></td>
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
  onOpenTask,
  onOpenNew,
}: ImportSharedProps & {
  onOpenTask: (taskId: string) => void;
  onOpenNew: () => void;
}) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ImportTaskSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    fetchImportTasks(token)
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
  }, [token]);

  return (
    <section className="import-shell">
      <header className="import-header">
        <div>
          <p className="eyebrow">Import</p>
          <h2>导入历史</h2>
          <p className="subtitle">查看每次导入的状态、结果统计和失败明细入口。</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenNew}>
          新建导入
        </button>
      </header>

      {loadState === "loading" ? (
        <section className="loading">正在加载导入历史...</section>
      ) : loadState === "error" ? (
        <section className="empty-state">
          <h2>导入历史加载失败</h2>
          <p>{error ?? "暂时无法读取导入任务。"}</p>
        </section>
      ) : tasks.length === 0 ? (
        <section className="empty-state">
          <h2>还没有导入任务</h2>
          <p>建议先做“仅导入链接”，把旧资产快速迁入。</p>
        </section>
      ) : (
        <section className="import-card">
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>任务名</th>
                  <th>来源</th>
                  <th>模式</th>
                  <th>状态</th>
                  <th>总数</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="row-clickable" onClick={() => onOpenTask(task.id)}>
                    <td>{task.name}</td>
                    <td>{importSourceLabel(task.sourceType)}</td>
                    <td>{importModeLabel(task.mode)}</td>
                    <td>
                      <span className={`task-status task-status-${task.status}`}>{importTaskStatusLabel(task.status)}</span>
                    </td>
                    <td>{task.totalCount}</td>
                    <td>{task.successCount + task.mergedCount + task.skippedCount}</td>
                    <td>{task.failedCount}</td>
                    <td>{formatWhen(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

export function ImportDetailPanel({
  token,
  taskId,
  onApiError,
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

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    fetchImportTaskDetail(taskId, token)
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
  }, [taskId, token]);

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

  return (
    <section className="import-shell">
      <header className="import-header">
        <div>
          <p className="eyebrow">Import Detail</p>
          <h2>{task.name}</h2>
          <p className="subtitle">
            {importSourceLabel(task.sourceType)} · {importModeLabel(task.mode)} · {formatWhen(task.createdAt)}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenHistory}>
          返回导入历史
        </button>
      </header>

      <section className="summary import-summary">
        <article className="metric"><p>状态</p><h3>{importTaskStatusLabel(task.status)}</h3></article>
        <article className="metric"><p>总条目</p><h3>{task.totalCount}</h3></article>
        <article className="metric"><p>成功</p><h3>{task.successCount}</h3></article>
        <article className="metric"><p>合并</p><h3>{task.mergedCount}</h3></article>
        <article className="metric"><p>跳过</p><h3>{task.skippedCount}</h3></article>
        <article className="metric"><p>失败</p><h3>{task.failedCount}</h3></article>
        <article className="metric"><p>归档成功</p><h3>{task.archiveSuccessCount}</h3></article>
        <article className="metric"><p>归档失败</p><h3>{task.archiveFailedCount}</h3></article>
      </section>

      <section className="import-card">
        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>URL</th>
                <th>状态</th>
                <th>去重结果</th>
                <th>错误原因</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.length === 0 ? (
                <tr><td colSpan={6}>暂无条目明细</td></tr>
              ) : (
                detail.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td><span className="ellipsis-cell">{item.url}</span></td>
                    <td>{item.status}</td>
                    <td>{item.dedupeResult ?? "—"}</td>
                    <td>{item.errorReason ?? "—"}</td>
                    <td>
                      {item.bookmarkId ? (
                        <button
                          className="secondary-button table-action-button"
                          type="button"
                          onClick={() => onOpenBookmark(item.bookmarkId!)}
                        >
                          打开书签
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
