import { useEffect, useState } from "react";
import type { CaptureProfile, CaptureTask } from "@keeppage/domain";
import { MESSAGE_TYPE, type TaskUpdatedEvent } from "../../src/lib/messages";

type AsyncState = "idle" | "capturing" | "error";
type SettingsState = "idle" | "saving" | "saved" | "error";
type ConnectionState = "idle" | "testing" | "ok" | "error";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";
const PROFILE_OPTIONS: Array<{
  value: CaptureProfile;
  label: string;
  description: string;
}> = [
  {
    value: "standard",
    label: "标准保真",
    description: "默认方案，平衡质量与体积。",
  },
  {
    value: "complete",
    label: "完整保留",
    description: "尽量少裁剪，适合复杂页面。",
  },
  {
    value: "dynamic",
    label: "动态增强",
    description: "更适合延迟内容和 SPA。",
  },
  {
    value: "lightweight",
    label: "轻量快照",
    description: "更快更小，优先搜索和快速归档。",
  },
];

export function App() {
  const [tasks, setTasks] = useState<CaptureTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [state, setState] = useState<AsyncState>("idle");
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>("standard");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [settingsState, setSettingsState] = useState<SettingsState>("idle");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([refreshTasks(), loadSettings()]);

    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void,
    ) => {
      const event = message as Partial<TaskUpdatedEvent>;
      if (event.type !== MESSAGE_TYPE.TaskUpdated || !event.task) {
        return;
      }
      setTasks((previous) => {
        const next = [event.task!, ...previous.filter((item) => item.id !== event.task!.id)];
        return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20);
      });
      setSelectedTaskId((current) => current ?? event.task!.id);
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  async function refreshTasks() {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.ListTasks,
      limit: 20,
    });
    if (!response?.ok) {
      setError(response?.error ?? "加载任务列表失败。");
      return;
    }
    const nextTasks = (response.tasks as CaptureTask[]) ?? [];
    setTasks(nextTasks);
    setSelectedTaskId((current) => current ?? nextTasks[0]?.id ?? null);
  }

  async function captureCurrentPage() {
    setState("capturing");
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.TriggerCaptureActiveTab,
      profile: captureProfile,
    });
    if (!response?.ok) {
      setState("error");
      setError(response?.error ?? "触发保存失败。");
      return;
    }
    setState("idle");
    await refreshTasks();
  }

  async function retryCurrentTask() {
    if (!selectedTask) {
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.RetryTask,
      taskId: selectedTask.id,
      profile: captureProfile,
    });
    if (!response?.ok) {
      setError(response?.error ?? "重试失败。");
      return;
    }
    await refreshTasks();
  }

  async function openPreviewInNewTab() {
    if (!selectedTask) {
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.OpenTaskPreview,
      taskId: selectedTask.id,
    });
    if (!response?.ok) {
      setError(response?.error ?? "打开预览失败。");
    }
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get([
      "apiBaseUrl",
      "captureProfilePreference",
    ]);
    if (typeof result.apiBaseUrl === "string" && result.apiBaseUrl.trim()) {
      setApiBaseUrl(result.apiBaseUrl.trim());
    }
    if (typeof result.captureProfilePreference === "string") {
      const matched = PROFILE_OPTIONS.find(
        (option) => option.value === result.captureProfilePreference,
      );
      if (matched) {
        setCaptureProfile(matched.value);
      }
    }
  }

  async function saveSettings() {
    setSettingsState("saving");
    setSettingsMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      await chrome.storage.local.set({
        apiBaseUrl: normalizedApiBaseUrl,
        captureProfilePreference: captureProfile,
      });
      setApiBaseUrl(normalizedApiBaseUrl);
      setSettingsState("saved");
      setSettingsMessage("已保存扩展侧设置。后续保存和同步会立即使用新配置。");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (saveError) {
      setSettingsState("error");
      setSettingsMessage(
        saveError instanceof Error ? saveError.message : "保存设置失败。",
      );
    }
  }

  async function resetApiBaseUrl() {
    setApiBaseUrl(DEFAULT_API_BASE_URL);
    setSettingsState("saving");
    setSettingsMessage(null);
    try {
      await chrome.storage.local.set({
        apiBaseUrl: DEFAULT_API_BASE_URL,
      });
      setSettingsState("saved");
      setSettingsMessage("已恢复默认 API 地址。");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (saveError) {
      setSettingsState("error");
      setSettingsMessage(
        saveError instanceof Error ? saveError.message : "重置 API 地址失败。",
      );
    }
  }

  async function testConnection() {
    setConnectionState("testing");
    setConnectionMessage(null);
    try {
      const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}/health`, {
        headers: {
          accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`服务返回 ${response.status}`);
      }
      const payload = (await response.json()) as {
        storage?: string;
        status?: string;
      };
      setConnectionState("ok");
      setConnectionMessage(
        `连接正常，后端状态 ${payload.status ?? "ok"}，存储驱动 ${payload.storage ?? "unknown"}。`,
      );
    } catch (testError) {
      setConnectionState("error");
      setConnectionMessage(
        testError instanceof Error ? testError.message : "无法连接到同步服务。",
      );
    }
  }

  const selectedProfileMeta = PROFILE_OPTIONS.find((option) => option.value === captureProfile);
  const canResumeSync = Boolean(
    selectedTask &&
      selectedTask.status === "upload_pending" &&
      selectedTask.artifacts?.archiveHtml &&
      typeof selectedTask.artifacts.extractedText === "string" &&
      selectedTask.quality &&
      selectedTask.localArchiveSha256,
  );
  const retryLabel = canResumeSync && selectedTask?.profile === captureProfile
    ? "继续同步"
    : "按当前 Profile 重抓";

  return (
    <div className="layout">
      <header className="header">
        <div className="header-copy">
          <p className="eyebrow">KeepPage Queue</p>
          <h1>Archive-First 保存队列</h1>
          <p className="header-subtitle">先拿到本地可预览归档，再异步上传、去重和建索引。</p>
        </div>
        <div className="header-actions">
          <label className="compact-field">
            <span>抓取 profile</span>
            <select
              value={captureProfile}
              onChange={(event) => setCaptureProfile(event.target.value as CaptureProfile)}
            >
              {PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="capture-btn"
            disabled={state === "capturing"}
            onClick={captureCurrentPage}
            type="button"
          >
            {state === "capturing" ? "保存中..." : "保存当前页"}
          </button>
        </div>
      </header>

      <section className="settings-strip">
        <div className="settings-copy">
          <p className="settings-title">同步配置</p>
          <p className="muted">
            当前保存会使用 <strong>{selectedProfileMeta?.label ?? "标准保真"}</strong>。
            {selectedProfileMeta?.description ? ` ${selectedProfileMeta.description}` : ""}
          </p>
        </div>
        <label className="field-inline">
          <span>API Base URL</span>
          <input
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            placeholder={DEFAULT_API_BASE_URL}
            spellCheck={false}
          />
        </label>
        <div className="settings-actions">
          <button onClick={saveSettings} type="button">
            {settingsState === "saving" ? "保存中..." : "保存设置"}
          </button>
          <button className="ghost-btn" onClick={testConnection} type="button">
            {connectionState === "testing" ? "测试中..." : "测试连接"}
          </button>
          <button className="ghost-btn" onClick={resetApiBaseUrl} type="button">
            恢复默认
          </button>
        </div>
      </section>
      {settingsMessage && (
        <section className={`settings-banner settings-${settingsState}`}>{settingsMessage}</section>
      )}
      {connectionMessage && (
        <section className={`settings-banner settings-${connectionState}`}>{connectionMessage}</section>
      )}

      <main className="main">
        <section className="task-list">
          {tasks.length === 0 && (
            <p className="muted">
              还没有保存记录。点击「保存当前页」，先生成本地归档，再异步进入上传队列。
            </p>
          )}
          {tasks.map((task) => {
            const active = task.id === selectedTaskId;
            return (
              <button
                className={`task-card ${active ? "active" : ""}`}
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                type="button"
              >
                <p className="task-title">{task.source.title}</p>
                <p className="task-url">{task.source.domain}</p>
                <div className="task-meta">
                  <span className={`status status-${task.status}`}>{task.status}</span>
                  <span className={`grade grade-${task.quality?.grade ?? "none"}`}>
                    {task.quality ? `${task.quality.grade.toUpperCase()} ${task.quality.score}` : "N/A"}
                  </span>
                </div>
              </button>
            );
          })}
        </section>

        <section className="preview-panel">
          {!selectedTask && <p className="muted">选择左侧记录以查看质量诊断和本地预览。</p>}
          {selectedTask && (
            <>
              <div className="preview-toolbar">
                <h2>{selectedTask.source.title}</h2>
                <div className="actions">
                  <button onClick={retryCurrentTask} type="button">
                    {retryLabel}
                  </button>
                  <button onClick={openPreviewInNewTab} type="button">
                    新标签预览
                  </button>
                </div>
              </div>
              <p className="muted">{selectedTask.source.url}</p>
              <div className="task-facts">
                <span>状态：{selectedTask.status}</span>
                <span>Profile：{selectedTask.profile}</span>
                {selectedTask.bookmarkId && <span>Bookmark：{selectedTask.bookmarkId}</span>}
              </div>
              <div className="quality-box">
                <p>
                  质量等级:{" "}
                  <strong>{selectedTask.quality?.grade ?? "unknown"}</strong>{" "}
                  {selectedTask.quality ? `(${selectedTask.quality.score})` : ""}
                </p>
                {(selectedTask.quality?.reasons ?? []).slice(0, 3).map((reason) => (
                  <p className="reason" key={reason.code}>
                    {reason.message}
                  </p>
                ))}
                {selectedTask.failureReason && (
                  <p className="reason error">{selectedTask.failureReason}</p>
                )}
              </div>
              <div className="preview-frame-wrap">
                {selectedTask.artifacts?.archiveHtml ? (
                  <iframe
                    className="preview-frame"
                    sandbox="allow-same-origin"
                    srcDoc={selectedTask.artifacts.archiveHtml}
                    title="archive-preview"
                  />
                ) : (
                  <div className="preview-placeholder">
                    <p>本地预览占位</p>
                    <p>归档 HTML 生成后会在这里直接渲染。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      {error && <footer className="error-banner">{error}</footer>}
    </div>
  );
}

function normalizeApiBaseUrl(input: string) {
  const normalized = input.trim();
  return (normalized || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}
