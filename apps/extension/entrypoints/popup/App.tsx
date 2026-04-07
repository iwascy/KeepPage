import { useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, CaptureTask, Folder, Tag } from "@keeppage/domain";
import {
  MESSAGE_TYPE,
  type TaskUpdatedEvent,
  type TriggerCaptureActiveTabResponse,
} from "../../src/lib/messages";
import {
  fetchBookmark,
  fetchFolders,
  fetchTags,
  updateBookmarkMetadata,
} from "../../src/lib/bookmark-metadata-api";
import {
  openExtensionAuthPage,
  openSidePanelForCurrentWindow,
} from "../../src/lib/auth-flow";

const NONE_FOLDER_VALUE = "__none__";
const TASK_MATCH_GRACE_MS = 10_000;

type MetadataState = "idle" | "loading" | "saving" | "saved" | "error";

export function App() {
  const captureStartedRef = useRef(false);
  const trackedTaskIdRef = useRef<string | null>(null);
  const captureContextRef = useRef<{
    sourceUrl: string | null;
    startedAt: number;
  }>({
    sourceUrl: null,
    startedAt: 0,
  });
  const metadataLoadedBookmarkIdRef = useRef<string | null>(null);

  const [captureTask, setCaptureTask] = useState<CaptureTask | null>(null);
  const [captureRequestDone, setCaptureRequestDone] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(NONE_FOLDER_VALUE);
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [customTagsInput, setCustomTagsInput] = useState("");
  const [metadataState, setMetadataState] = useState<MetadataState>("idle");
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);

  const captureState = useMemo(() => {
    if (captureError) {
      return "error" as const;
    }
    if (!captureTask) {
      return "saving" as const;
    }
    if (isSuccessStatus(captureTask.status)) {
      return "success" as const;
    }
    if (captureTask.status === "failed") {
      return "error" as const;
    }
    if (captureRequestDone && captureTask.status === "upload_pending" && captureTask.failureReason) {
      return "error" as const;
    }
    return "saving" as const;
  }, [captureError, captureRequestDone, captureTask]);

  useEffect(() => {
    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void,
    ) => {
      const event = message as Partial<TaskUpdatedEvent>;
      if (event.type !== MESSAGE_TYPE.TaskUpdated || !event.task) {
        return false;
      }

      if (!shouldTrackTask(event.task, trackedTaskIdRef.current, captureContextRef.current)) {
        return false;
      }

      trackedTaskIdRef.current = event.task.id;
      setCaptureTask(event.task);
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    if (captureStartedRef.current) {
      return;
    }
    captureStartedRef.current = true;
    void startCapture();
  }, []);

  useEffect(() => {
    const bookmarkId = captureTask?.bookmarkId;
    if (!bookmarkId || captureState !== "success") {
      return;
    }
    if (metadataLoadedBookmarkIdRef.current === bookmarkId) {
      return;
    }
    void loadMetadataOptions(bookmarkId);
  }, [captureTask?.bookmarkId, captureState]);

  const statusTitle = captureState === "success"
    ? "保存完成"
    : captureState === "error"
    ? "保存失败"
    : "保存中";
  const statusDescription = getStatusDescription(captureTask, captureState, captureError);
  const mergedTagNames = useMemo(
    () => dedupeTagNames([...selectedTagNames, ...parseTagNames(customTagsInput)]),
    [customTagsInput, selectedTagNames],
  );

  async function startCapture() {
    try {
      setCaptureError(null);
      setCaptureRequestDone(false);
      setMetadataState("idle");
      setMetadataMessage(null);

      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      captureContextRef.current = {
        sourceUrl: tab?.url ?? null,
        startedAt: Date.now(),
      };

      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.TriggerCaptureActiveTab,
        profile: "complete",
        saveMode: "standard",
        captureScope: "page",
      }) as TriggerCaptureActiveTabResponse;

      setCaptureRequestDone(true);
      if (!response.ok || !response.task) {
        setCaptureError(response.error ?? "保存失败，请稍后重试。");
        return;
      }

      trackedTaskIdRef.current = response.task.id;
      setCaptureTask(response.task);
    } catch (error) {
      setCaptureRequestDone(true);
      setCaptureError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
      return;
    }
  }

  async function loadMetadataOptions(bookmarkId: string) {
    setMetadataState("loading");
    setMetadataMessage(null);
    try {
      const [bookmark, availableFolders, availableTags] = await Promise.all([
        fetchBookmark(bookmarkId),
        fetchFolders(),
        fetchTags(),
      ]);
      applyBookmarkMetadata(bookmark, availableFolders, availableTags);
      metadataLoadedBookmarkIdRef.current = bookmarkId;
      setMetadataState("idle");
    } catch (error) {
      setMetadataState("error");
      setMetadataMessage(error instanceof Error ? error.message : "加载收藏夹和标签失败。");
    }
  }

  function applyBookmarkMetadata(bookmark: Bookmark, availableFolders: Folder[], availableTags: Tag[]) {
    setFolders(availableFolders);
    setTags(mergeTags(availableTags, bookmark.tags));
    setSelectedFolderId(bookmark.folder?.id ?? NONE_FOLDER_VALUE);
    setSelectedTagNames(bookmark.tags.map((tag) => tag.name));
    setCustomTagsInput("");
  }

  async function handleSubmitMetadata() {
    const bookmarkId = captureTask?.bookmarkId;
    if (!bookmarkId) {
      return;
    }

    setMetadataState("saving");
    setMetadataMessage(null);
    try {
      const bookmark = await updateBookmarkMetadata(bookmarkId, {
        folderId: selectedFolderId === NONE_FOLDER_VALUE ? null : selectedFolderId,
        tags: mergedTagNames,
      });
      applyBookmarkMetadata(bookmark, folders, tags);
      setMetadataState("saved");
      setMetadataMessage("已更新收藏夹和标签。");
    } catch (error) {
      setMetadataState("error");
      setMetadataMessage(error instanceof Error ? error.message : "更新收藏夹和标签失败。");
    }
  }

  async function handleOpenWorkspace() {
    await openSidePanelForCurrentWindow();
    window.close();
  }

  async function handleOpenLogin() {
    await openExtensionAuthPage("toolbar-popup");
    window.close();
  }

  function toggleTag(tagName: string) {
    setSelectedTagNames((current) => (
      current.includes(tagName)
        ? current.filter((item) => item !== tagName)
        : [...current, tagName]
    ));
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  return (
    <main className="popup-shell">
      <section className={`status-card ${captureState}`}>
        <div className="status-dot" aria-hidden="true" />
        <div className="status-copy">
          <p className="eyebrow">KeepPage</p>
          <h1>{statusTitle}</h1>
          <p className="status-description">{statusDescription}</p>
        </div>
      </section>

      <section className="summary-card">
        <div className="summary-row">
          <span>页面</span>
          <strong title={captureTask?.source.title ?? undefined}>
            {captureTask?.source.title ?? "正在识别当前页面..."}
          </strong>
        </div>
        <div className="summary-row">
          <span>状态</span>
          <strong>{captureTask ? getTaskStepLabel(captureTask.status) : "准备开始"}</strong>
        </div>
        {captureTask?.failureReason ? (
          <p className="inline-message error-text">{captureTask.failureReason}</p>
        ) : null}
      </section>

      {captureState === "success" && captureTask?.bookmarkId ? (
        <section className="editor-card">
          <div className="section-heading">
            <h2>保存后整理</h2>
            <p>成功后可直接归入收藏夹并补充 tag。</p>
          </div>

          <label className="field">
            <span>收藏夹</span>
            <select
              value={selectedFolderId}
              onChange={(event) => {
                setSelectedFolderId(event.target.value);
                setMetadataState("idle");
                setMetadataMessage(null);
              }}
              disabled={metadataState === "loading" || metadataState === "saving"}
            >
              <option value={NONE_FOLDER_VALUE}>不放入收藏夹</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.path}</option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>tag</span>
            <div className="tag-grid">
              {tags.length === 0 ? (
                <p className="empty-text">当前还没有可选 tag，可以直接输入新的 tag。</p>
              ) : (
                tags.map((tag) => (
                  <label key={tag.id} className={`tag-chip ${selectedTagNames.includes(tag.name) ? "selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedTagNames.includes(tag.name)}
                      onChange={() => toggleTag(tag.name)}
                      disabled={metadataState === "loading" || metadataState === "saving"}
                    />
                    <span>{tag.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <label className="field">
            <span>新增 tag</span>
            <input
              type="text"
              value={customTagsInput}
              onChange={(event) => {
                setCustomTagsInput(event.target.value);
                setMetadataState("idle");
                setMetadataMessage(null);
              }}
              placeholder="多个 tag 用逗号分隔"
              disabled={metadataState === "loading" || metadataState === "saving"}
            />
          </label>

          {mergedTagNames.length > 0 ? (
            <div className="selected-tags">
              {mergedTagNames.map((tagName) => (
                <span key={tagName} className="selected-tag">{tagName}</span>
              ))}
            </div>
          ) : null}

          {metadataMessage ? (
            <p className={`inline-message ${metadataState === "error" ? "error-text" : "success-text"}`}>
              {metadataMessage}
            </p>
          ) : null}

          <div className="actions">
            <button
              type="button"
              onClick={handleSubmitMetadata}
              disabled={metadataState === "loading" || metadataState === "saving"}
            >
              {metadataState === "saving" ? "保存中..." : "应用收藏夹和 tag"}
            </button>
            <button type="button" className="ghost" onClick={handleOpenWorkspace}>
              打开工作台
            </button>
          </div>
        </section>
      ) : null}

      {captureState !== "success" ? (
        <div className="actions">
          {captureState === "error" ? (
            <button type="button" onClick={() => window.location.reload()}>
              重新保存
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={handleOpenWorkspace}>
            打开工作台
          </button>
          {captureState === "error" && looksLikeAuthError(captureError ?? captureTask?.failureReason) ? (
            <button type="button" className="ghost" onClick={handleOpenLogin}>
              去登录
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function shouldTrackTask(
  task: CaptureTask,
  trackedTaskId: string | null,
  context: { sourceUrl: string | null; startedAt: number },
) {
  if ((task.saveMode ?? "standard") !== "standard") {
    return false;
  }
  if (trackedTaskId) {
    return task.id === trackedTaskId;
  }
  if (!context.sourceUrl || task.source.url !== context.sourceUrl) {
    return false;
  }
  const createdAt = Date.parse(task.createdAt);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  return createdAt >= context.startedAt - TASK_MATCH_GRACE_MS;
}

function isSuccessStatus(status: CaptureTask["status"]) {
  return status === "uploaded" || status === "indexed" || status === "synced";
}

function getStatusDescription(
  task: CaptureTask | null,
  captureState: "saving" | "success" | "error",
  captureError: string | null,
) {
  if (captureState === "error") {
    return captureError ?? task?.failureReason ?? "这次保存没有完成，请重试。";
  }
  if (!task) {
    return "正在准备当前标签页的归档任务。";
  }
  if (captureState === "success") {
    return "页面已保存到 KeepPage，现在可以继续整理收藏夹和 tag。";
  }
  return getTaskStepDescription(task.status);
}

function getTaskStepLabel(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "已入队";
    case "capturing":
      return "抓取中";
    case "validating":
      return "整理中";
    case "local_ready":
      return "本地归档完成";
    case "upload_pending":
      return "等待同步";
    case "uploading":
      return "同步中";
    case "uploaded":
      return "已上传";
    case "indexed":
      return "已索引";
    case "synced":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "处理中";
  }
}

function getTaskStepDescription(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "任务已创建，马上开始保存。";
    case "capturing":
      return "正在抓取页面内容和当前渲染结果。";
    case "validating":
      return "正在整理归档内容并生成质量信息。";
    case "local_ready":
      return "本地归档已完成，正在准备同步。";
    case "upload_pending":
      return "归档已就绪，正在排队同步到 KeepPage。";
    case "uploading":
      return "正在把归档上传到 KeepPage。";
    case "uploaded":
      return "归档已上传，正在完成最后确认。";
    case "indexed":
      return "归档已完成索引。";
    case "synced":
      return "页面已经成功保存到 KeepPage。";
    case "failed":
      return "保存过程失败。";
    default:
      return "正在处理当前页面。";
  }
}

function parseTagNames(input: string) {
  return input
    .split(/[,\n，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeTagNames(names: string[]) {
  return [...new Set(names.map((item) => item.trim()).filter(Boolean))];
}

function looksLikeAuthError(message?: string | null) {
  if (!message) {
    return false;
  }
  return message.includes("登录") || message.includes("未登录") || message.includes("账号");
}

function mergeTags(availableTags: Tag[], bookmarkTags: Tag[]) {
  const merged = new Map<string, Tag>();
  for (const tag of availableTags) {
    merged.set(tag.id, tag);
  }
  for (const tag of bookmarkTags) {
    merged.set(tag.id, tag);
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}
