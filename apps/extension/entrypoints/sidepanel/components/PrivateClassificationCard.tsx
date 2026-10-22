import { useEffect, useState, type FormEvent } from "react";
import type { Bookmark, Folder, Tag } from "@keeppage/domain";
import {
  PrivateModeLockedError,
  fetchPrivateBookmark,
  fetchPrivateFolders,
  fetchPrivateTags,
  updatePrivateBookmarkMetadata,
} from "../../../src/lib/bookmark-metadata-api";

type PrivateClassificationCardProps = {
  bookmarkId: string;
  /** Called when the server reports the private vault is locked. */
  onLocked?: () => void;
};

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

const NEW_FOLDER_VALUE = "__new__";

/** Folder and tag editor for a synced private bookmark (private taxonomy only). */
export function PrivateClassificationCard({ bookmarkId, onLocked }: PrivateClassificationCardProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folderChoice, setFolderChoice] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  function applyBookmark(bookmark: Bookmark, availableFolders: Folder[], availableTags: Tag[]) {
    const nextFolders = mergeById(availableFolders, bookmark.folder ? [bookmark.folder] : [], (folder) => folder.path);
    setFolders(nextFolders);
    setTags(mergeById(availableTags, bookmark.tags, (tag) => tag.name));
    setFolderChoice(bookmark.folder?.path ?? "");
    setNewFolderPath("");
    setSelectedTagNames(bookmark.tags.map((tag) => tag.name));
    setTagInput("");
  }

  function handleError(error: unknown, fallback: string) {
    if (error instanceof PrivateModeLockedError) {
      onLocked?.();
    }
    return error instanceof Error ? error.message : fallback;
  }

  async function load() {
    setLoadState("loading");
    setLoadError(null);
    try {
      const [bookmark, availableFolders, availableTags] = await Promise.all([
        fetchPrivateBookmark(bookmarkId),
        fetchPrivateFolders(),
        fetchPrivateTags(),
      ]);
      applyBookmark(bookmark, availableFolders, availableTags);
      setLoadState("ready");
    } catch (error) {
      setLoadError(handleError(error, "加载私密收藏夹和标签失败。"));
      setLoadState("error");
    }
  }

  useEffect(() => {
    void load();
    // Reload only when the bookmark changes.
  }, [bookmarkId]);

  function markDirty() {
    if (saveState === "saved" || saveState === "error") {
      setSaveState("idle");
      setSaveMessage(null);
    }
  }

  function toggleTag(name: string) {
    markDirty();
    setSelectedTagNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  function addDraftTags() {
    const names = parseTagNames(tagInput);
    if (names.length === 0) {
      return selectedTagNames;
    }
    const next = [...new Set([...selectedTagNames, ...names])];
    markDirty();
    setSelectedTagNames(next);
    setTagInput("");
    return next;
  }

  function handleAddTag(event: FormEvent) {
    event.preventDefault();
    addDraftTags();
  }

  async function handleSave() {
    const nextTagNames = addDraftTags();
    const folderPath = normalizeFolderPath(folderChoice === NEW_FOLDER_VALUE ? newFolderPath : folderChoice);
    const existingFolder = folders.find((folder) => folder.path === folderPath);
    setSaveState("saving");
    setSaveMessage(null);
    try {
      const bookmark = await updatePrivateBookmarkMetadata(bookmarkId, {
        ...(folderPath
          ? existingFolder
            ? { folderId: existingFolder.id }
            : { folderPath }
          : { folderId: null }),
        tags: nextTagNames,
      });
      applyBookmark(bookmark, folders, tags);
      setSaveState("saved");
      setSaveMessage("已保存。");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(handleError(error, "保存私密收藏夹和标签失败。"));
    }
  }

  // Tags typed in but not yet known to the server still need a chip.
  const tagNames = [...new Set([...tags.map((tag) => tag.name), ...selectedTagNames])];
  const saving = saveState === "saving";

  return (
    <section className="sp-card sp-detail-block sp-classify">
      <div className="sp-detail-block-head">
        <h3>分类</h3>
        {saveMessage && (
          <span className={`sp-classify-status ${saveState === "error" ? "is-error" : "is-success"}`} role={saveState === "error" ? "alert" : undefined}>
            {saveMessage}
          </span>
        )}
      </div>

      {loadState === "loading" ? (
        <p className="sp-muted">正在加载私密收藏夹和标签…</p>
      ) : loadState === "error" ? (
        <div className="sp-classify-error">
          <p className="sp-classify-status is-error" role="alert">{loadError}</p>
          <button className="sp-button is-secondary is-compact" onClick={() => void load()} type="button">
            重试
          </button>
        </div>
      ) : (
        <>
          <label className="sp-field-inline">
            收藏夹
            <select
              disabled={saving}
              onChange={(event) => {
                markDirty();
                setFolderChoice(event.target.value);
              }}
              value={folderChoice}
            >
              <option value="">未归档</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.path}>{folder.path}</option>
              ))}
              <option value={NEW_FOLDER_VALUE}>新建收藏夹…</option>
            </select>
          </label>
          {folderChoice === NEW_FOLDER_VALUE && (
            <input
              aria-label="新收藏夹路径"
              disabled={saving}
              onChange={(event) => {
                markDirty();
                setNewFolderPath(event.target.value);
              }}
              placeholder="收藏夹路径，如 阅读/技术"
              value={newFolderPath}
            />
          )}

          <div className="sp-classify-tags">
            {tagNames.length === 0 ? (
              <span className="sp-muted">还没有私密标签。</span>
            ) : (
              tagNames.map((name) => {
                const selected = selectedTagNames.includes(name);
                return (
                  <button
                    aria-pressed={selected}
                    className="sp-chip sp-tag-toggle"
                    disabled={saving}
                    key={name}
                    onClick={() => toggleTag(name)}
                    type="button"
                  >
                    {name}
                  </button>
                );
              })
            )}
          </div>
          <form className="sp-form is-inline sp-classify-tag-form" onSubmit={handleAddTag}>
            <input
              aria-label="新标签"
              disabled={saving}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="添加标签，逗号分隔"
              value={tagInput}
            />
            <button className="sp-button is-secondary is-compact" disabled={saving || !tagInput.trim()} type="submit">
              添加
            </button>
          </form>

          <div className="sp-button-row">
            <button className="sp-button is-primary is-compact" disabled={saving} onClick={() => void handleSave()} type="button">
              {saving ? "保存中…" : "保存分类"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function parseTagNames(input: string) {
  return [...new Set(
    input
      .split(/[,\n，]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeFolderPath(input: string) {
  return input
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function mergeById<T extends { id: string }>(items: T[], extra: T[], sortKey: (item: T) => string) {
  const merged = new Map<string, T>();
  for (const item of [...items, ...extra]) {
    merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => sortKey(left).localeCompare(sortKey(right), "zh-CN"));
}
