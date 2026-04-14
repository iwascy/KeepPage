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

const TASK_MATCH_GRACE_MS = 10_000;
const FOLDER_SUGGESTION_LIMIT = 6;
const TAG_SUGGESTION_LIMIT = 12;

type MetadataState = "idle" | "loading" | "saving" | "saved" | "error";

export function App() {
  const captureStartedRef = useRef(false);
  const trackedTaskIdRef = useRef<string | null>(null);
  const folderPickerRef = useRef<HTMLDivElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);
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
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isFolderMenuOpen, setIsFolderMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
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
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (folderPickerRef.current && !folderPickerRef.current.contains(target)) {
        setIsFolderMenuOpen(false);
      }
      if (tagPickerRef.current && !tagPickerRef.current.contains(target)) {
        setIsTagMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
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
  const progressValue = getTaskProgressValue(captureTask, captureState);
  const normalizedFolderInput = normalizeFolderPath(folderInput);
  const suggestedFolders = useMemo(
    () => filterFolders(folders, folderInput).slice(0, FOLDER_SUGGESTION_LIMIT),
    [folderInput, folders],
  );
  const canCreateFolder = normalizedFolderInput.length > 0
    && !folders.some((folder) => folder.path === normalizedFolderInput);
  const tagDraftNames = useMemo(() => parseTagNames(tagInput), [tagInput]);
  const filteredTagSuggestions = useMemo(
    () => filterTagSuggestions(tags, selectedTagNames, tagInput).slice(0, TAG_SUGGESTION_LIMIT),
    [selectedTagNames, tagInput, tags],
  );
  const normalizedSingleTagDraft = getSingleDraftTagName(tagInput);
  const canCreateTag = Boolean(
    normalizedSingleTagDraft
      && !selectedTagNames.includes(normalizedSingleTagDraft)
      && !tags.some((tag) => tag.name === normalizedSingleTagDraft),
  );
  const showFolderMenu = isFolderMenuOpen && (suggestedFolders.length > 0 || canCreateFolder || folderInput.trim().length > 0);
  const showTagMenu = isTagMenuOpen && (filteredTagSuggestions.length > 0 || canCreateTag || tagInput.trim().length > 0);

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
    setFolders(mergeFolders(availableFolders, bookmark.folder));
    setTags(mergeTags(availableTags, bookmark.tags));
    setSelectedFolderId(bookmark.folder?.id ?? null);
    setFolderInput(bookmark.folder?.path ?? "");
    setSelectedTagNames(bookmark.tags.map((tag) => tag.name));
    setTagInput("");
  }

  async function handleSubmitMetadata() {
    const bookmarkId = captureTask?.bookmarkId;
    if (!bookmarkId) {
      return;
    }

    const nextTagNames = commitPendingTags();
    const nextFolderPath = normalizeFolderPath(folderInput);
    setMetadataState("saving");
    setMetadataMessage(null);
    try {
      const bookmark = await updateBookmarkMetadata(bookmarkId, {
        ...(nextFolderPath
          ? selectedFolderId
            ? { folderId: selectedFolderId }
            : { folderPath: nextFolderPath }
          : { folderId: null }),
        tags: nextTagNames,
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
    if (getSingleDraftTagName(tagInput) === tagName) {
      setTagInput("");
    }
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function handleFolderInputChange(value: string) {
    setFolderInput(value);
    const normalizedValue = normalizeFolderPath(value);
    const matchedFolder = folders.find((folder) => folder.path === normalizedValue);
    setSelectedFolderId(matchedFolder?.id ?? null);
    setIsFolderMenuOpen(true);
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function selectFolder(folder: Folder) {
    setSelectedFolderId(folder.id);
    setFolderInput(folder.path);
    setIsFolderMenuOpen(false);
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function clearFolderSelection() {
    setSelectedFolderId(null);
    setFolderInput("");
    setIsFolderMenuOpen(false);
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function createFolderFromInput() {
    if (!normalizedFolderInput) {
      return;
    }
    setSelectedFolderId(null);
    setFolderInput(normalizedFolderInput);
    setIsFolderMenuOpen(false);
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function addTag(tagName: string) {
    const normalizedName = tagName.trim();
    if (!normalizedName) {
      return;
    }
    setSelectedTagNames((current) => dedupeTagNames([...current, normalizedName]));
    if (tagInput.trim()) {
      setTagInput("");
    }
    setIsTagMenuOpen(false);
    setMetadataState("idle");
    setMetadataMessage(null);
  }

  function commitPendingTags() {
    const next = dedupeTagNames([...selectedTagNames, ...tagDraftNames]);
    if (next.length !== selectedTagNames.length) {
      setSelectedTagNames(next);
    }
    if (tagDraftNames.length > 0) {
      setTagInput("");
    }
    return next;
  }

  function handleAddDraftTags() {
    const next = commitPendingTags();
    if (next.length === selectedTagNames.length && tagDraftNames.length === 0 && normalizedSingleTagDraft) {
      addTag(normalizedSingleTagDraft);
      return;
    }
    setIsTagMenuOpen(false);
  }

  function handleTagInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }
    event.preventDefault();
    handleAddDraftTags();
  }

  return (
    <main className="popup-shell">
      <section className={`status-card ${captureState}`}>
        <div className="status-copy">
          <p className="eyebrow">KeepPage</p>
          <div className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            <span>{captureState === "success" ? "保存成功" : captureState === "error" ? "保存失败" : "保存进行中"}</span>
          </div>
          <h1>{statusTitle}</h1>
          <p className="status-description">{statusDescription}</p>
          <div className="status-progress" aria-hidden="true">
            <div className="status-progress-track">
              <span style={{ width: `${progressValue}%` }} />
            </div>
            <div className="status-progress-meta">
              <span>{captureTask ? getTaskStepLabel(captureTask.status) : "准备开始"}</span>
              <span>{progressValue}%</span>
            </div>
          </div>
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
            <p>现在就可以选择已有收藏夹、直接新建路径，并把 tag 一次补齐。</p>
          </div>

          <label className="field">
            <span>收藏夹</span>
            <div className="picker-shell" ref={folderPickerRef}>
              <div className="picker-input">
                <span className="picker-icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  value={folderInput}
                  onFocus={() => setIsFolderMenuOpen(true)}
                  onChange={(event) => handleFolderInputChange(event.target.value)}
                  placeholder="搜索或选择收藏夹，留空则不加入"
                  disabled={metadataState === "loading" || metadataState === "saving"}
                />
                {folderInput ? (
                  <button
                    type="button"
                    className="picker-clear"
                    onClick={clearFolderSelection}
                    disabled={metadataState === "loading" || metadataState === "saving"}
                  >
                    清空
                  </button>
                ) : null}
              </div>
              {showFolderMenu ? (
                <div className="picker-menu">
                  {canCreateFolder ? (
                    <button
                      type="button"
                      className="folder-create-card"
                      onClick={createFolderFromInput}
                      disabled={metadataState === "loading" || metadataState === "saving"}
                    >
                      <span className="folder-create-icon" aria-hidden="true">
                        <PlusIcon />
                      </span>
                      <span className="folder-create-copy">
                        <strong>新建并加入 “{normalizedFolderInput}”</strong>
                      </span>
                    </button>
                  ) : null}
                  {suggestedFolders.length > 0 ? (
                    <div className="picker-list">
                      {suggestedFolders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          className={`picker-list-item ${selectedFolderId === folder.id ? "selected" : ""}`}
                          onClick={() => selectFolder(folder)}
                          disabled={metadataState === "loading" || metadataState === "saving"}
                        >
                          <span className="picker-list-icon" aria-hidden="true">
                            <FolderIcon />
                          </span>
                          <span className="picker-list-copy">
                            <strong>{folder.path}</strong>
                          </span>
                          {selectedFolderId === folder.id ? (
                            <span className="picker-list-check" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </label>

          <div className="field">
            <span>tag</span>
            <div className="tag-chip-list">
              {selectedTagNames.map((tagName) => (
                <button
                  key={tagName}
                  type="button"
                  className="selected-tag"
                  onClick={() => toggleTag(tagName)}
                  disabled={metadataState === "loading" || metadataState === "saving"}
                >
                  <span>{tagName}</span>
                  <strong>x</strong>
                </button>
              ))}
            </div>

            <div className="picker-shell" ref={tagPickerRef}>
              <div className="picker-input tag-input-shell">
                <input
                  type="text"
                  value={tagInput}
                  onFocus={() => setIsTagMenuOpen(true)}
                  onChange={(event) => {
                    setTagInput(event.target.value);
                    setIsTagMenuOpen(true);
                    setMetadataState("idle");
                    setMetadataMessage(null);
                  }}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="输入 tag，回车或点击 + 添加"
                  disabled={metadataState === "loading" || metadataState === "saving"}
                />
                <button
                  type="button"
                  className="tag-add-button"
                  onClick={handleAddDraftTags}
                  disabled={metadataState === "loading" || metadataState === "saving" || tagInput.trim().length === 0}
                >
                  <PlusIcon />
                </button>
              </div>
              {showTagMenu ? (
                <div className="picker-menu">
                  {canCreateTag ? (
                    <button
                      type="button"
                      className="picker-list-item create"
                      onClick={() => addTag(normalizedSingleTagDraft!)}
                      disabled={metadataState === "loading" || metadataState === "saving"}
                    >
                      <span className="picker-list-icon" aria-hidden="true">
                        <PlusIcon />
                      </span>
                      <span className="picker-list-copy">
                        <strong>新增 tag “{normalizedSingleTagDraft}”</strong>
                      </span>
                    </button>
                  ) : null}
                  {filteredTagSuggestions.length > 0 ? (
                    <div className="picker-list">
                      {filteredTagSuggestions.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="picker-list-item"
                          onClick={() => addTag(tag.name)}
                          disabled={metadataState === "loading" || metadataState === "saving"}
                        >
                          <span className="picker-list-icon tag" aria-hidden="true">
                            #
                          </span>
                          <span className="picker-list-copy">
                            <strong>{tag.name}</strong>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {tagDraftNames.length > 0 ? (
              <p className="inline-message">待添加：{tagDraftNames.join("、")}</p>
            ) : null}
          </div>

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

function getTaskProgressValue(
  task: CaptureTask | null,
  captureState: "saving" | "success" | "error",
): number {
  if (captureState === "success") {
    return 100;
  }
  if (captureState === "error") {
    return task ? getTaskProgressValue(task, "saving") : 0;
  }
  if (!task) {
    return 8;
  }
  switch (task.status) {
    case "queued":
      return 16;
    case "capturing":
      return 32;
    case "validating":
      return 54;
    case "local_ready":
      return 70;
    case "upload_pending":
      return 78;
    case "uploading":
      return 88;
    case "uploaded":
      return 95;
    case "indexed":
      return 98;
    case "synced":
      return 100;
    case "failed":
      return 0;
    default:
      return 24;
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

function getSingleDraftTagName(input: string) {
  if (/[,\n，]/.test(input)) {
    return "";
  }
  return input.trim();
}

function looksLikeAuthError(message?: string | null) {
  if (!message) {
    return false;
  }
  return message.includes("登录") || message.includes("未登录") || message.includes("账号");
}

function normalizeFolderPath(input: string) {
  return input
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function filterFolders(folders: Folder[], keyword: string) {
  const normalizedKeyword = normalizeFolderPath(keyword).toLocaleLowerCase("zh-CN");
  if (!normalizedKeyword) {
    return folders;
  }
  return folders.filter((folder) => folder.path.toLocaleLowerCase("zh-CN").includes(normalizedKeyword));
}

function filterTagSuggestions(tags: Tag[], selectedTagNames: string[], keyword: string) {
  const selected = new Set(selectedTagNames);
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  const available = tags.filter((tag) => !selected.has(tag.name));
  if (!normalizedKeyword) {
    return available;
  }
  return available.filter((tag) => tag.name.toLocaleLowerCase("zh-CN").includes(normalizedKeyword));
}

function mergeFolders(availableFolders: Folder[], bookmarkFolder?: Bookmark["folder"]) {
  const merged = new Map<string, Folder>();
  for (const folder of availableFolders) {
    merged.set(folder.id, folder);
  }
  if (bookmarkFolder) {
    merged.set(bookmarkFolder.id, bookmarkFolder);
  }
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12.5 12.5L17 17" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.5 6.5C2.5 5.4 3.4 4.5 4.5 4.5H8L9.5 6H15.5C16.6 6 17.5 6.9 17.5 8V13.5C17.5 14.6 16.6 15.5 15.5 15.5H4.5C3.4 15.5 2.5 14.6 2.5 13.5V6.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6V14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M6 10H14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      <path
        d="M6.6 10.2L8.8 12.4L13.4 7.8"
        fill="none"
        stroke="#f8f4ec"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
