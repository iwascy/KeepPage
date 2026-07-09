import { useCallback, useEffect, useMemo, useState } from "react";
import type { Share, ShareDetail, ShareOwnerItem } from "@keeppage/domain";
import { ApiError, fetchBookmarks } from "../../api";
import { Icon } from "../../components/Icon";
import { formatRelativeWhen } from "../../lib/date-format";
import { PublicSharePage } from "./public-page";
import { CreateShareDialog } from "./create-dialog";
import {
  getShareDetail,
  listShares,
  revokeShareById,
  updateShareItems,
} from "./share-api";
import { isDemoShareToken } from "./demo-store";

export { PublicSharePage, CreateShareDialog };

type LoadState = "idle" | "loading" | "ready" | "error";
type InlineFeedback = { kind: "success" | "error"; message: string };

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) {
    return list;
  }
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function SharesPanel({
  token,
  onBack,
  onApiError,
}: {
  token: string;
  onBack: () => void;
  onApiError?: (error: unknown) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [items, setItems] = useState<Share[]>([]);
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShareDetail | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editItems, setEditItems] = useState<ShareOwnerItem[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addCandidates, setAddCandidates] = useState<ShareOwnerItem[]>([]);
  const [addLoading, setAddLoading] = useState(false);

  const selectedIds = useMemo(
    () => new Set(editItems.map((item) => item.bookmarkId)),
    [editItems],
  );

  const load = useCallback(async () => {
    setLoadState("loading");
    setFeedback(null);
    try {
      const list = await listShares(token);
      setItems(list);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      onApiError?.(error);
    }
  }, [onApiError, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCopy(share: Share) {
    try {
      await navigator.clipboard.writeText(share.publicUrl);
      setFeedback({ kind: "success", message: "链接已复制" });
    } catch {
      setFeedback({ kind: "error", message: "复制失败，请手动复制" });
    }
  }

  async function handleRevoke(share: Share) {
    if (share.status === "revoked") {
      return;
    }
    const confirmed = window.confirm(`确定撤销「${share.title}」？链接将立即失效。`);
    if (!confirmed) {
      return;
    }
    setBusyId(share.id);
    try {
      const updated = await revokeShareById(share.id, token);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback({ kind: "success", message: "已撤销分享" });
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      onApiError?.(error);
    } finally {
      setBusyId(null);
    }
  }

  async function openEdit(share: Share) {
    if (share.status !== "active") {
      return;
    }
    setBusyId(share.id);
    try {
      const detail = await getShareDetail(share.id, token);
      setEditing(detail);
      setEditTitle(detail.title);
      setEditDescription(detail.description);
      setEditItems(detail.items.slice().sort((a, b) => a.position - b.position));
      setAddQuery("");
      setAddCandidates([]);
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      onApiError?.(error);
    } finally {
      setBusyId(null);
    }
  }

  async function searchAddCandidates(query: string) {
    setAddQuery(query);
    if (isDemoShareToken(token)) {
      // Demo has no full library API here; keep empty picker with guidance.
      setAddCandidates([]);
      return;
    }
    setAddLoading(true);
    try {
      const result = await fetchBookmarks({
        search: query,
        quality: "all",
        view: "all",
        limit: 20,
        offset: 0,
      }, token);
      setAddCandidates(
        result.items
          .filter((item) => !selectedIds.has(item.id))
          .map((item, index) => ({
            bookmarkId: item.id,
            position: index,
            title: item.title,
            domain: item.domain.replace(/^www\./i, ""),
            sourceUrl: item.sourceUrl,
          })),
      );
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      onApiError?.(error);
    } finally {
      setAddLoading(false);
    }
  }

  function addCandidate(item: ShareOwnerItem) {
    if (selectedIds.has(item.bookmarkId)) {
      return;
    }
    if (editItems.length >= 100) {
      setFeedback({ kind: "error", message: "单个分享最多 100 条书签。" });
      return;
    }
    setEditItems((current) => [
      ...current,
      {
        ...item,
        position: current.length,
      },
    ]);
    setAddCandidates((current) => current.filter((row) => row.bookmarkId !== item.bookmarkId));
  }

  async function saveEdit() {
    if (!editing) {
      return;
    }
    if (editItems.length === 0) {
      setFeedback({ kind: "error", message: "至少保留 1 条书签。" });
      return;
    }
    setEditBusy(true);
    try {
      const updated = await updateShareItems(
        editing.id,
        {
          title: editTitle.trim(),
          description: editDescription.trim(),
          bookmarkIds: editItems.map((item) => item.bookmarkId),
        },
        token,
        editItems,
      );
      setItems((current) => current.map((item) => (
        item.id === updated.id
          ? {
              id: updated.id,
              title: updated.title,
              description: updated.description,
              status: updated.status,
              publicToken: updated.publicToken,
              publicUrl: updated.publicUrl,
              itemCount: updated.itemCount,
              createdAt: updated.createdAt,
              updatedAt: updated.updatedAt,
              revokedAt: updated.revokedAt,
            }
          : item
      )));
      setEditing(null);
      setFeedback({ kind: "success", message: "分享已更新" });
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      onApiError?.(error);
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <section className="shares-panel">
      <div className="shares-panel-header">
        <div>
          <h1>我的分享</h1>
          <p>管理公开只读链接。持有链接的人无需登录即可查看。</p>
        </div>
        <button className="public-share-btn is-ghost" type="button" onClick={onBack}>
          <Icon name="arrow_back" />
          返回
        </button>
      </div>

      {feedback ? (
        <p className={`home-feedback${feedback.kind === "error" ? " is-error" : ""}`} role="status">
          {feedback.message}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="home-loading-note">正在加载分享列表...</p>
      ) : null}

      {loadState === "ready" && items.length === 0 ? (
        <div className="shares-empty">
          <p>还没有分享。在首页进入多选，勾选书签后点击「分享」即可创建。</p>
        </div>
      ) : null}

      <div className="shares-list">
        {items.map((share) => (
          <article key={share.id} className="shares-card">
            <div className="shares-card-top">
              <h2 className="shares-card-title">{share.title}</h2>
              <span className={`shares-status is-${share.status}`}>
                {share.status === "active" ? "活跃" : "已撤销"}
              </span>
            </div>
            {share.description.trim() ? (
              <p style={{ margin: "0 0 0.65rem", color: "#71717a", fontSize: "0.9rem" }}>
                {share.description}
              </p>
            ) : null}
            <div className="shares-card-meta">
              <span>{share.itemCount} 条</span>
              <span>更新于 {formatRelativeWhen(share.updatedAt)}</span>
            </div>
            <div className="shares-card-actions">
              {share.status === "active" ? (
                <>
                  <button
                    className="public-share-btn is-primary"
                    type="button"
                    disabled={busyId === share.id}
                    onClick={() => handleCopy(share)}
                  >
                    复制链接
                  </button>
                  <a
                    className="public-share-btn is-ghost"
                    href={share.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开
                  </a>
                  <button
                    className="public-share-btn is-ghost"
                    type="button"
                    disabled={busyId === share.id}
                    onClick={() => openEdit(share)}
                  >
                    编辑
                  </button>
                  <button
                    className="public-share-btn is-ghost"
                    type="button"
                    disabled={busyId === share.id}
                    onClick={() => handleRevoke(share)}
                  >
                    撤销
                  </button>
                </>
              ) : (
                <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>链接已失效</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <div className="manager-dialog-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <div
            className="share-create-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="share-create-dialog-shell">
              <h2>编辑分享</h2>
              <p className="share-create-hint">
                可修改标题、描述、条目顺序，并从书签库追加条目。公开页将实时反映当前书签内容。
              </p>
              <div className="share-create-field">
                <label htmlFor="edit-share-title">标题</label>
                <input
                  id="edit-share-title"
                  value={editTitle}
                  maxLength={80}
                  onChange={(event) => setEditTitle(event.target.value)}
                  disabled={editBusy}
                />
              </div>
              <div className="share-create-field">
                <label htmlFor="edit-share-desc">描述</label>
                <textarea
                  id="edit-share-desc"
                  rows={3}
                  maxLength={500}
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  disabled={editBusy}
                />
              </div>
              <div className="share-create-field">
                <label>条目（{editItems.length}）· 可排序 / 移除 / 追加</label>
                <div className="shares-edit-items">
                  {editItems.map((item, index) => (
                    <div key={item.bookmarkId} className="share-create-item">
                      <div className="share-create-item-copy">
                        <div className="share-create-item-title">{item.title}</div>
                        <div className="share-create-item-domain">{item.domain}</div>
                      </div>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        title="上移"
                        disabled={editBusy || index === 0}
                        onClick={() => setEditItems((list) => moveItem(list, index, index - 1))}
                      >
                        <Icon name="keyboard_arrow_right" style={{ transform: "rotate(-90deg)" }} />
                      </button>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        title="下移"
                        disabled={editBusy || index === editItems.length - 1}
                        onClick={() => setEditItems((list) => moveItem(list, index, index + 1))}
                      >
                        <Icon name="keyboard_arrow_right" style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        disabled={editBusy}
                        onClick={() => setEditItems((list) => list.filter((row) => row.bookmarkId !== item.bookmarkId))}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="share-create-field">
                <label htmlFor="edit-share-add">从书签库追加</label>
                <input
                  id="edit-share-add"
                  value={addQuery}
                  placeholder={isDemoShareToken(token) ? "演示模式请在首页多选创建新分享" : "搜索标题或域名..."}
                  onChange={(event) => void searchAddCandidates(event.target.value)}
                  disabled={editBusy || isDemoShareToken(token)}
                />
                {addLoading ? <p className="share-create-hint">搜索中...</p> : null}
                {!isDemoShareToken(token) && addCandidates.length > 0 ? (
                  <div className="shares-edit-items" style={{ marginTop: "0.5rem" }}>
                    {addCandidates.map((item) => (
                      <div key={item.bookmarkId} className="share-create-item">
                        <div className="share-create-item-copy">
                          <div className="share-create-item-title">{item.title}</div>
                          <div className="share-create-item-domain">{item.domain}</div>
                        </div>
                        <button
                          type="button"
                          className="public-share-btn is-ghost"
                          disabled={editBusy}
                          onClick={() => addCandidate(item)}
                        >
                          添加
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="share-create-actions">
                <button className="public-share-btn is-ghost" type="button" onClick={() => setEditing(null)} disabled={editBusy}>
                  取消
                </button>
                <button className="public-share-btn is-primary" type="button" onClick={saveEdit} disabled={editBusy}>
                  {editBusy ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
