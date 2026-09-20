import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Share, ShareDetail, ShareOwnerItem } from "@keeppage/domain";
import { ApiError, fetchBookmarks } from "../../api";
import { useDialogFocus } from "../../app/use-dialog-focus";
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">("all");
  const [revoking, setRevoking] = useState<Share | null>(null);
  const apiErrorHandler = useRef(onApiError);
  apiErrorHandler.current = onApiError;
  const candidateRequest = useRef<AbortController | null>(null);
  const closeEdit = () => { if (!editBusy) { candidateRequest.current?.abort(); setEditing(null); } };
  const editOpenerRef = useRef<HTMLElement | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const editDialogRef = useDialogFocus(Boolean(editing), closeEdit, editBusy, editOpenerRef);
  const revokeDialogRef = useDialogFocus(Boolean(revoking), () => setRevoking(null), Boolean(busyId));
  const visibleItems = items.filter((share) => statusFilter === "all" || share.status === statusFilter);
  const activeCount = items.filter((share) => share.status === "active").length;

  useEffect(() => () => candidateRequest.current?.abort(), []);

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
      apiErrorHandler.current?.(error);
    }
  }, [token]);

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
    setBusyId(share.id);
    try {
      const updated = await revokeShareById(share.id, token);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback({ kind: "success", message: "已撤销分享，公开链接不再可用。" });
      setRevoking(null);
      requestAnimationFrame(() => pageHeadingRef.current?.focus());
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      apiErrorHandler.current?.(error);
    } finally {
      setBusyId(null);
    }
  }

  async function openEdit(share: Share, opener: HTMLElement) {
    if (share.status !== "active") {
      return;
    }
    editOpenerRef.current = opener;
    setBusyId(share.id);
    setFeedback(null);
    try {
      const detail = await getShareDetail(share.id, token);
      setEditing(detail);
      setEditTitle(detail.title);
      setEditDescription(detail.description);
      setEditItems(detail.items.slice().sort((a, b) => a.position - b.position));
      candidateRequest.current?.abort();
      setAddQuery("");
      setAddCandidates([]);
      setAddLoading(false);
    } catch (error) {
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      apiErrorHandler.current?.(error);
    } finally {
      setBusyId(null);
    }
  }

  async function searchAddCandidates(query: string) {
    candidateRequest.current?.abort();
    const controller = new AbortController();
    candidateRequest.current = controller;
    setAddQuery(query);
    setAddCandidates([]);
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
      }, token, controller.signal);
      if (controller.signal.aborted) return;
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
      if (controller.signal.aborted) return;
      setFeedback({ kind: "error", message: toErrorMessage(error) });
      apiErrorHandler.current?.(error);
    } finally {
      if (!controller.signal.aborted) setAddLoading(false);
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
    if (!editTitle.trim()) {
      setFeedback({ kind: "error", message: "请输入分享标题。" });
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
      apiErrorHandler.current?.(error);
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <section className="shares-panel" aria-labelledby="shares-page-title">
      <div className="shares-panel-header settings-page-heading">
        <div>
          <p className="settings-kicker">连接与分享</p>
          <h1 id="shares-page-title" ref={pageHeadingRef} tabIndex={-1}>分享管理</h1>
          <p>管理已创建的分享链接、公开内容和访问状态。</p>
        </div>
        <button className="public-share-btn is-ghost" type="button" onClick={onBack}>
          <Icon name="add" />
          选择书签创建分享
        </button>
      </div>

      {feedback && !editing && !revoking ? (
        <p className={`shares-feedback${feedback.kind === "error" ? " is-error" : ""}`} role="status">
          {feedback.message}
        </p>
      ) : null}

      <div className="shares-policy-note"><Icon name="info" /><p>分享为公开只读链接，持有链接的人无需登录即可查看。撤销后，原链接立即失效。</p></div>
      <div className="shares-toolbar">
        <div className="shares-filter" role="group" aria-label="按分享状态筛选">
          {(["all", "active", "revoked"] as const).map((status) => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>{status === "all" ? "全部" : status === "active" ? "可访问" : "已撤销"}<span>{status === "all" ? items.length : status === "active" ? activeCount : items.length - activeCount}</span></button>)}
        </div>
        <button className="public-share-btn is-ghost" type="button" onClick={() => void load()} disabled={loadState === "loading"}><Icon name="refresh" />刷新</button>
      </div>
      {loadState === "loading" && !items.length ? <div className="shares-empty" role="status" aria-busy="true"><Icon name="refresh" /><h2>正在加载分享…</h2><p>读取分享链接和访问状态。</p></div> : null}
      {loadState === "error" && !items.length ? <div className="shares-empty"><Icon name="link_off" /><h2>暂时无法读取分享</h2><p>请检查连接后重试。</p><button className="public-share-btn is-primary" type="button" onClick={() => void load()}>重试加载</button></div> : null}
      {loadState === "ready" && !visibleItems.length ? <div className="shares-empty"><Icon name="share" /><h2>{items.length ? "此状态下没有分享" : "还没有创建分享"}</h2><p>{items.length ? "切换到其他状态查看已有分享。" : "在书签库进入多选，选择要公开的书签，然后点击“分享”。"}</p>{!items.length ? <button className="public-share-btn is-primary" type="button" onClick={onBack}>前往书签库</button> : null}</div> : null}

      <div className="shares-list">
        {visibleItems.map((share) => (
          <article key={share.id} className="shares-card">
            <div className="shares-card-top">
              <h2 className="shares-card-title">{share.title}</h2>
              <span className={`shares-status is-${share.status}`}>
                {share.status === "active" ? "可访问" : "已撤销"}
              </span>
            </div>
            {share.description.trim() ? (
              <p className="shares-card-description">
                {share.description}
              </p>
            ) : null}
            <div className="shares-card-meta">
              <span>{share.itemCount} 条书签</span>
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
                    onClick={(event) => openEdit(share, event.currentTarget)}
                  >
                    编辑
                  </button>
                  <button
                    className="public-share-btn is-danger shares-revoke-button"
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => { setFeedback(null); setRevoking(share); }}
                  >
                    撤销
                  </button>
                </>
              ) : (
                <span className="shares-revoked-note"><Icon name="link_off" />此链接已停止公开访问</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <div className="manager-dialog-backdrop" role="presentation" onClick={closeEdit}>
          <div
            className="share-create-dialog shares-edit-dialog"
            ref={editDialogRef}
            tabIndex={-1}
            aria-labelledby="shares-edit-title"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="share-create-dialog-shell">
              <div className="shares-edit-heading"><h2 id="shares-edit-title">编辑分享</h2><button className="settings-icon-button" type="button" aria-label="关闭编辑分享" disabled={editBusy} onClick={closeEdit}><Icon name="close" /></button></div>
              <p className="share-create-hint">
                可修改标题、描述、条目顺序，并从书签库追加条目。公开页将实时反映当前书签内容。
              </p>
              {feedback?.kind === "error" ? <p className="shares-feedback is-error" role="alert">{feedback.message}</p> : null}
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
                        aria-label={`上移 ${item.title}`}
                        disabled={editBusy || index === 0}
                        onClick={() => setEditItems((list) => moveItem(list, index, index - 1))}
                      >
                        <Icon name="keyboard_arrow_right" style={{ transform: "rotate(-90deg)" }} />
                      </button>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        title="下移"
                        aria-label={`下移 ${item.title}`}
                        disabled={editBusy || index === editItems.length - 1}
                        onClick={() => setEditItems((list) => moveItem(list, index, index + 1))}
                      >
                        <Icon name="keyboard_arrow_right" style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        disabled={editBusy}
                        aria-label={`移除 ${item.title}`}
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
                {addLoading ? <p className="share-create-hint" role="status">搜索中…</p> : addQuery.trim() && !addCandidates.length ? <p className="share-create-hint" role="status">没有可添加的匹配书签，已在分享中的条目不会重复显示。</p> : null}
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
                <button className="public-share-btn is-ghost" type="button" onClick={closeEdit} disabled={editBusy}>
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
      {revoking ? (
        <div className="manager-dialog-backdrop" role="presentation" onClick={() => { if (!busyId) setRevoking(null); }}>
          <div className="shares-revoke-dialog" ref={revokeDialogRef} role="dialog" aria-modal="true" aria-labelledby="shares-revoke-title" aria-describedby="shares-revoke-description" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <div className="shares-danger-icon"><Icon name="link_off" /></div>
            <h2 id="shares-revoke-title">撤销这个分享？</h2>
            <p id="shares-revoke-description">“{revoking.title}”的公开链接将立即失效。书签本身会保留，如需再次分享，需要创建新链接。</p>
            {feedback?.kind === "error" ? <p className="shares-feedback is-error" role="alert">{feedback.message}</p> : null}
            <div className="share-create-actions"><button className="public-share-btn is-ghost" type="button" onClick={() => setRevoking(null)} disabled={Boolean(busyId)}>保留分享</button><button className="public-share-btn is-danger-filled" type="button" onClick={() => void handleRevoke(revoking)} disabled={Boolean(busyId)}>{busyId ? "撤销中…" : "确认撤销"}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
