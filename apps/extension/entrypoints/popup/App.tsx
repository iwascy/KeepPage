import { useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, Folder, Tag } from "@keeppage/domain";
import {
  MESSAGE_TYPE,
  type SaveActiveTabAsBookmarkResponse,
  type ToggleActiveTabBookmarkResponse,
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
import {
  looksLikeAuthError,
} from "../../src/lib/ui-shared/capture-status";
import { isMissingReceiverError } from "../../src/lib/extension-errors";

const FOLDER_SUGGESTION_LIMIT = 6;
const TAG_SUGGESTION_LIMIT = 12;

type MetadataState = "idle" | "loading" | "saving" | "saved" | "error";
type BookmarkSaveState = "saving" | "success" | "removed" | "error";

export function App() {
  const saveStartedRef = useRef(false);
  const folderPickerRef = useRef<HTMLDivElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);
  const metadataLoadedBookmarkIdRef = useRef<string | null>(null);

  const [saveState, setSaveState] = useState<BookmarkSaveState>("saving");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);

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

  useEffect(() => {
    if (saveStartedRef.current) {
      return;
    }
    saveStartedRef.current = true;
    void saveBookmark();
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
    if (!bookmarkId || saveState !== "success") {
      return;
    }
    if (metadataLoadedBookmarkIdRef.current === bookmarkId) {
      return;
    }
    void loadMetadataOptions(bookmarkId);
  }, [bookmarkId, saveState]);

  const statusTitle = saveState === "success"
    ? "书签保存完成"
    : saveState === "removed"
    ? "已取消收藏"
    : saveState === "error"
    ? "收藏操作失败"
    : "正在检查收藏状态";
  const statusDescription = getStatusDescription(saveState, saveError);
  const progressValue = saveState === "success" || saveState === "removed" ? 100 : saveState === "error" ? 0 : 45;
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

  async function saveBookmark() {
    try {
      setSaveState("saving");
      setSaveError(null);
      setBookmarkId(null);
      setMetadataState("idle");
      setMetadataMessage(null);

      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.url) {
        setPage({
          url: tab.url,
          title: tab.title?.trim() || tab.url,
        });
      }

      const response = await requestBookmarkToggle();

      if (!response?.ok || !response.action || (response.action === "saved" && !response.bookmarkId)) {
        setSaveState("error");
        setSaveError(response?.error ?? "扩展后台没有响应，请重新加载 KeepPage 扩展后再试。");
        return;
      }

      if (response.source) {
        setPage(response.source);
      }
      if (response.action === "removed") {
        setSaveState("removed");
        return;
      }
      setBookmarkId(response.bookmarkId ?? null);
      setSaveState("success");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "收藏操作失败，请稍后重试。");
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
      <section className={`status-card ${saveState}`}>
        <div className="status-copy">
          <p className="eyebrow">KeepPage</p>
          <div className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            <span>{saveState === "success" ? "书签已保存" : saveState === "removed" ? "已取消收藏" : saveState === "error" ? "保存失败" : "保存进行中"}</span>
          </div>
          <h1>{statusTitle}</h1>
          <p className="status-description">{statusDescription}</p>
          <div className="status-progress" aria-hidden="true">
            <div className="status-progress-track">
              <span style={{ width: `${progressValue}%` }} />
            </div>
            <div className="status-progress-meta">
              <span>{saveState === "success" ? "已写入书签" : saveState === "removed" ? "书签已移除" : saveState === "error" ? "写入失败" : "正在检查收藏状态"}</span>
              <span>{progressValue}%</span>
            </div>
          </div>
        </div>
      </section>

      <section className="summary-card">
        <div className="summary-row">
          <span>页面</span>
          <strong title={page?.title}>
            {page?.title ?? "正在识别当前页面..."}
          </strong>
        </div>
        <div className="summary-row">
          <span>模式</span>
          <strong>书签（不存档）</strong>
        </div>
        {saveError ? (
          <p className="inline-message error-text">{saveError}</p>
        ) : null}
      </section>

      {saveState === "success" && bookmarkId ? (
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

      {saveState !== "success" ? (
        <div className="actions">
          {saveState === "error" ? (
            <button type="button" onClick={() => window.location.reload()}>
              重新保存
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={handleOpenWorkspace}>
            打开工作台
          </button>
          {saveState === "error" && looksLikeAuthError(saveError) ? (
            <button type="button" className="ghost" onClick={handleOpenLogin}>
              去登录
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

async function requestBookmarkToggle(): Promise<ToggleActiveTabBookmarkResponse | undefined> {
  const response = await sendRuntimeMessage<ToggleActiveTabBookmarkResponse>({
    type: MESSAGE_TYPE.ToggleActiveTabBookmark,
  });
  if (response) {
    return response;
  }

  const legacyResponse = await sendRuntimeMessage<SaveActiveTabAsBookmarkResponse>({
    type: MESSAGE_TYPE.SaveActiveTabAsBookmark,
  });
  if (!legacyResponse) {
    return undefined;
  }
  return {
    ...legacyResponse,
    action: legacyResponse.ok ? "saved" : undefined,
  };
}

async function sendRuntimeMessage<TResponse>(message: unknown): Promise<TResponse | undefined> {
  try {
    return await chrome.runtime.sendMessage(message) as TResponse | undefined;
  } catch (error) {
    if (isMissingReceiverError(error)) {
      return undefined;
    }
    throw error;
  }
}

function getStatusDescription(
  saveState: BookmarkSaveState,
  saveError: string | null,
) {
  if (saveState === "error") {
    return saveError ?? "这次书签保存没有完成，请重试。";
  }
  if (saveState === "success") {
    return "网页链接已保存，不会生成页面存档；现在可以继续整理收藏夹和 tag。";
  }
  if (saveState === "removed") {
    return "当前网页已从 KeepPage 中移除，再点一次插件即可重新收藏。";
  }
  return "正在检查当前网页的收藏状态。";
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
