import { useMemo, useState } from "react";
import type { Share } from "@keeppage/domain";
import { ApiError } from "../../api";
import { Icon } from "../../components/Icon";
import { createShareFromDrafts, type ShareDraftItem } from "./share-api";

export function CreateShareDialog({
  token,
  selectedDrafts,
  onClose,
  onCreated,
}: {
  token: string;
  selectedDrafts: ShareDraftItem[];
  onClose: () => void;
  onCreated: (share: Share) => void;
}) {
  const initialItems = useMemo(() => selectedDrafts, [selectedDrafts]);
  const [items, setItems] = useState(initialItems);
  const [title, setTitle] = useState(
    initialItems.length === 1
      ? initialItems[0]?.title ?? "分享的书签"
      : `分享的 ${initialItems.length} 条书签`,
  );
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function handleSubmit() {
    const bookmarkIds = items.map((item) => item.id);
    if (bookmarkIds.length === 0) {
      setError("至少保留 1 条书签。");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请填写分享标题。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const share = await createShareFromDrafts({
        title: trimmedTitle,
        description: description.trim() || undefined,
        bookmarkIds,
      }, token, items);
      setCreated(share);
      onCreated(share);
      try {
        await navigator.clipboard.writeText(share.publicUrl);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "创建分享失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!created) {
      return;
    }
    try {
      await navigator.clipboard.writeText(created.publicUrl);
      setCopied(true);
    } catch {
      setError("复制失败，请手动选择链接。");
    }
  }

  return (
    <div className="manager-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="share-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-create-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="share-create-dialog-shell">
          {!created ? (
            <>
              <h2 id="share-create-title">创建公开分享</h2>
              <p className="share-create-hint">
                任何拿到链接的人都能查看列表中的书签信息（含备注与标签），请勿分享敏感内容。访客无需登录。
              </p>

              <div className="share-create-field">
                <label htmlFor="share-title">标题</label>
                <input
                  id="share-title"
                  value={title}
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="share-create-field">
                <label htmlFor="share-desc">描述（可选）</label>
                <textarea
                  id="share-desc"
                  rows={3}
                  maxLength={500}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={submitting}
                  placeholder="给接收方一点上下文"
                />
              </div>

              <div className="share-create-field">
                <label>已选书签（{items.length}）</label>
                <div className="share-create-items">
                  {items.map((item) => (
                    <div key={item.id} className="share-create-item">
                      <div className="share-create-item-copy">
                        <div className="share-create-item-title">{item.title}</div>
                        <div className="share-create-item-domain">{item.domain}</div>
                      </div>
                      <button
                        type="button"
                        className="share-create-item-remove"
                        aria-label={`移除 ${item.title}`}
                        disabled={submitting}
                        onClick={() => removeItem(item.id)}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {error ? <p className="share-create-error">{error}</p> : null}

              <div className="share-create-actions">
                <button className="public-share-btn is-ghost" type="button" onClick={onClose} disabled={submitting}>
                  取消
                </button>
                <button
                  className="public-share-btn is-primary"
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || items.length === 0}
                >
                  {submitting ? "创建中..." : "创建并复制链接"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="share-create-title">分享已创建</h2>
              <p className="share-create-hint">
                {copied ? "链接已复制到剪贴板。" : "请复制下方链接发给对方。"}
                可在「设置 → 我的分享」中管理。
              </p>
              <div className="share-create-success-url">
                <input readOnly value={created.publicUrl} onFocus={(event) => event.currentTarget.select()} />
                <button className="public-share-btn is-primary" type="button" onClick={handleCopy}>
                  复制
                </button>
              </div>
              <div className="share-create-actions">
                <a className="public-share-btn is-ghost" href={created.publicUrl} target="_blank" rel="noreferrer">
                  打开预览
                </a>
                <button className="public-share-btn is-primary" type="button" onClick={onClose}>
                  完成
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
