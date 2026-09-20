import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApiToken } from "@keeppage/domain";
import { ApiError } from "../../api";
import { Icon } from "../../components/Icon";
import { useDialogFocus } from "../../app/use-dialog-focus";
import type { AppDataSource } from "../../data-sources/use-app-data-source";
import {
  formatRelativeWhen,
  formatWhen,
} from "../../lib/date-format";

type LoadState = "idle" | "loading" | "ready" | "error";
type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};
type ApiTokenSecretRecord = {
  value: string;
  savedAt: string;
};

const API_TOKEN_SECRET_STORAGE_PREFIX = "keeppage.api-token-secrets";

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function isApiTokenExpired(token: ApiToken) {
  return Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
}

function isApiTokenActive(token: ApiToken) {
  return !token.revokedAt && !isApiTokenExpired(token);
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const successful = document.execCommand("copy");
  textarea.remove();
  if (!successful) {
    throw new Error("当前环境不支持复制到剪贴板。");
  }
}

function resolveApiBaseForCurl() {
  const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim() || "/api";
  const normalizedBase = configuredBase.replace(/\/$/, "");
  if (/^https?:\/\//i.test(normalizedBase)) {
    return normalizedBase;
  }
  return new URL(normalizedBase, window.location.origin).toString().replace(/\/$/, "");
}

function buildBookmarkIngestCurl(
  apiBaseUrl: string,
  tokenValue: string,
  authMode: "authorization" | "x-api-key" = "authorization",
) {
  const authHeader = authMode === "authorization"
    ? `  -H 'Authorization: Bearer ${tokenValue}' \\`
    : `  -H 'X-KeepPage-Api-Key: ${tokenValue}' \\`;

  return [
    `curl -X POST '${apiBaseUrl}/ingest/bookmarks' \\`,
    authHeader,
    "  -H 'Content-Type: application/json' \\",
    "  -d '{",
    '    "url": "https://example.com/article",',
    '    "title": "KeepPage API 密钥测试",',
    '    "note": "来自 API 密钥页面",',
    '    "tags": ["api-key", "curl"],',
    '    "folderPath": "Inbox/API",',
    '    "dedupeStrategy": "merge"',
    "  }'",
  ].join("\n");
}

function getApiTokenSecretStorageKey(userId: string) {
  return `${API_TOKEN_SECRET_STORAGE_PREFIX}:${userId}`;
}

function readApiTokenSecrets(userId: string): Record<string, ApiTokenSecretRecord> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(getApiTokenSecretStorageKey(userId));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, ApiTokenSecretRecord>>((accumulator, [tokenId, value]) => {
      if (typeof value !== "object" || value === null) {
        return accumulator;
      }

      const record = value as {
        value?: unknown;
        savedAt?: unknown;
      };
      if (typeof record.value !== "string" || !record.value.trim()) {
        return accumulator;
      }

      accumulator[tokenId] = {
        value: record.value.trim(),
        savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
      };
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function writeApiTokenSecrets(userId: string, secrets: Record<string, ApiTokenSecretRecord>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (Object.keys(secrets).length === 0) {
      window.localStorage.removeItem(getApiTokenSecretStorageKey(userId));
      return;
    }
    window.localStorage.setItem(getApiTokenSecretStorageKey(userId), JSON.stringify(secrets));
  } catch {
    // Ignore storage write failures and keep the UI usable.
  }
}

function DialogCloseIcon() {
  return (
    <Icon name="close" />
  );
}

export function ApiTokensPanel({
  token,
  userId,
  dataSource,
  onApiError,
  onBack,
}: {
  token: string;
  userId: string;
  dataSource: AppDataSource;
  onApiError: (error: unknown) => boolean;
  onBack: () => void;
}) {
  const isDemoMode = dataSource.kind === "demo";
  const storageUserId = isDemoMode ? "demo" : userId;
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [items, setItems] = useState<ApiToken[]>([]);
  const [storedTokenSecrets, setStoredTokenSecrets] = useState<Record<string, ApiTokenSecretRecord>>(
    () => readApiTokenSecrets(storageUserId),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ id: string; name: string; value: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createExpiresAt, setCreateExpiresAt] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const loadSequence = useRef(0);
  const createOpenerRef = useRef<HTMLElement | null>(null);
  const createDialogRef = useDialogFocus(createOpen, closeCreateDialog, createBusy, createOpenerRef);
  const revokeDialogRef = useDialogFocus(Boolean(revokeTarget), () => setRevokeTarget(null), revokeBusy);
  const apiBaseUrl = useMemo(() => resolveApiBaseForCurl(), []);

  useEffect(() => {
    setStoredTokenSecrets(readApiTokenSecrets(storageUserId));
  }, [storageUserId]);

  useEffect(() => {
    setFeedback(null);
    const requestId = ++loadSequence.current;
    let cancelled = false;
    setLoadState("loading");
    dataSource.fetchApiTokens(token)
      .then((nextItems) => {
        if (cancelled || requestId !== loadSequence.current) {
          return;
        }
        setItems(nextItems);
        setLoadError(null);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled || requestId !== loadSequence.current || onApiError(error)) {
          return;
        }
        setLoadError(toErrorMessage(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, token, reloadKey]);

  const activeCount = useMemo(
    () => items.filter((item) => isApiTokenActive(item)).length,
    [items],
  );
  const revokedCount = useMemo(
    () => items.filter((item) => Boolean(item.revokedAt)).length,
    [items],
  );
  const latestUsedAt = useMemo(() => {
    const candidates = items
      .map((item) => item.lastUsedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    return candidates[0];
  }, [items]);
  const locallyStoredCount = useMemo(
    () => items.filter((item) => Boolean(storedTokenSecrets[item.id]?.value)).length,
    [items, storedTokenSecrets],
  );

  function updateStoredTokenSecrets(
    updater: (current: Record<string, ApiTokenSecretRecord>) => Record<string, ApiTokenSecretRecord>,
  ) {
    setStoredTokenSecrets((current) => {
      const next = updater(current);
      writeApiTokenSecrets(storageUserId, next);
      return next;
    });
  }

  function openCreateDialog(event: ReactMouseEvent<HTMLButtonElement>) {
    createOpenerRef.current = event.currentTarget;
    setCreateName("");
    setCreateExpiresAt("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (createBusy) {
      return;
    }
    setCreateOpen(false);
    setCreateError(null);
  }

  async function handleCopyRevealedToken() {
    if (!revealedToken) {
      return;
    }
    try {
      await copyTextToClipboard(revealedToken.value);
      setFeedback({
        kind: "success",
        message: `已复制 ${revealedToken.name} 的完整 API 密钥。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCopyCurl(
    itemName: string,
    tokenValue: string,
    authMode: "authorization" | "x-api-key",
  ) {
    const curlCommand = buildBookmarkIngestCurl(apiBaseUrl, tokenValue, authMode);
    try {
      await copyTextToClipboard(curlCommand);
      setFeedback({
        kind: "success",
        message: authMode === "authorization"
          ? `已复制 ${itemName} 的 Bearer curl 命令。`
          : `已复制 ${itemName} 的 X-KeepPage-Api-Key curl 命令。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCopyStoredToken(itemName: string, tokenValue: string) {
    try {
      await copyTextToClipboard(tokenValue);
      setFeedback({
        kind: "success",
        message: `已复制 ${itemName} 的完整 API 密钥。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    }
  }

  async function handleCreateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBusy) return;
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError("请填写 API 密钥名称。");
      return;
    }

    let expiresAt: string | undefined;
    if (createExpiresAt.trim()) {
      const parsed = new Date(createExpiresAt);
      if (Number.isNaN(parsed.getTime())) {
        setCreateError("请输入有效的过期时间。");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        setCreateError("过期时间必须晚于当前时间。");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setCreateBusy(true);
    setCreateError(null);

    try {
      const result = await dataSource.createApiToken({
        name: trimmedName,
        scopes: ["bookmark:create"],
        expiresAt,
      }, token);
      loadSequence.current += 1;
      setLoadState("ready");
      setLoadError(null);
      setItems((current) => [result.item, ...current]);
      updateStoredTokenSecrets((current) => ({
        ...current,
        [result.item.id]: {
          value: result.token,
          savedAt: new Date().toISOString(),
        },
      }));
      setRevealedToken({
        id: result.item.id,
        name: result.item.name,
        value: result.token,
      });

      setCreateOpen(false);
      setCreateName("");
      setCreateExpiresAt("");
      setFeedback({
        kind: "success",
        message: `已创建 API 密钥：${trimmedName}。完整明文已保存在当前浏览器，下面可以直接复制 curl 测试。`,
      });
    } catch (error) {
      if (onApiError(error)) {
        return;
      }
      setCreateError(toErrorMessage(error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleRevokeToken() {
    if (!revokeTarget || revokeBusy) {
      return;
    }

    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const revokedAt = new Date().toISOString();
      await dataSource.revokeApiToken(revokeTarget.id, token);
      loadSequence.current += 1;
      setLoadState("ready");
      setLoadError(null);
      setItems((current) => current.map((item) => (
        item.id === revokeTarget.id
          ? { ...item, revokedAt }
          : item
      )));

      updateStoredTokenSecrets((current) => {
        if (!current[revokeTarget.id]) {
          return current;
        }
        const next = { ...current };
        delete next[revokeTarget.id];
        return next;
      });
      if (revealedToken?.id === revokeTarget.id) {
        setRevealedToken(null);
      }

      setFeedback({
        kind: "success",
        message: `已吊销 API 密钥：${revokeTarget.name}。`,
      });
      setRevokeTarget(null);
      requestAnimationFrame(() => pageHeadingRef.current?.focus());
    } catch (error) {
      if (onApiError(error)) {
        return;
      }
      setRevokeError(toErrorMessage(error));
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <section className="api-token-page settings-surface">
      <header className="settings-page-heading">
        <div><p className="settings-kicker">连接与集成</p><h1 ref={pageHeadingRef} tabIndex={-1}>API 密钥</h1><p>连接快捷指令、Raycast 和自动化脚本，将网址保存到 KeepPage。</p></div>
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={onBack}>返回书签</button><button className="primary-button" type="button" onClick={openCreateDialog}><Icon name="add" />创建密钥</button></div>
      </header>
      <div className="settings-metrics" aria-label="密钥概况">
        <div><span>可用密钥</span><strong>{loadState === "loading" && !items.length ? "—" : activeCount}<small> / {items.length}</small></strong></div>
        <div><span>最近调用</span><strong>{latestUsedAt ? formatRelativeWhen(latestUsedAt) : "尚未调用"}</strong></div>
        <div><span>已撤销</span><strong>{revokedCount}</strong></div>
        <div><span>本机保存的密钥</span><strong>{locallyStoredCount}</strong></div>
      </div>
      {feedback ? <p role={feedback.kind === "error" ? "alert" : "status"} className={`settings-notice ${feedback.kind === "error" ? "is-error" : "is-success"}`}>{feedback.message}</p> : null}
      {loadState === "error" && items.length > 0 ? <p role="alert" className="settings-notice is-error">刷新失败，已保留上次加载的密钥。{loadError}</p> : null}
      {revealedToken ? (
        <section className="api-token-reveal-card">
          <div className="settings-section-heading"><div><h2>密钥已创建 · {revealedToken.name}</h2><p>明文已保存在当前浏览器。换用其他浏览器时，服务端无法再次提供。</p></div><button type="button" className="settings-icon-button" aria-label="关闭密钥提示" onClick={() => setRevealedToken(null)}><Icon name="close" /></button></div>
          <code className="api-token-code-block">{revealedToken.value}</code>
          <div className="settings-actions"><button className="primary-button" type="button" onClick={() => void handleCopyRevealedToken()}>复制完整密钥</button><button className="secondary-button" type="button" onClick={() => void handleCopyCurl(revealedToken.name, revealedToken.value, "authorization")}>复制调用示例</button></div>
        </section>
      ) : null}
      <section className="settings-resource-section" aria-label="密钥列表">
        <div className="settings-section-heading"><div><h2>你的密钥 <span className="settings-count">{items.length}</span></h2><p>仅允许新增或合并书签，不会自动抓取网页正文。</p></div><button type="button" className="secondary-button" disabled={loadState === "loading"} onClick={() => setReloadKey((value) => value + 1)}><Icon name="refresh" />{loadState === "loading" ? "加载中…" : "刷新"}</button></div>
        {loadState === "loading" && items.length === 0 ? (
          <div className="api-token-list-skeleton" role="status" aria-label="正在加载密钥">
            {[0, 1, 2].map((index) => <div className="api-token-card is-skeleton" key={index}><div className="api-token-skeleton-line is-title" /><div className="api-token-skeleton-line" /></div>)}
          </div>
        ) : loadState === "error" && items.length === 0 ? (
          <div className="settings-empty-state" role="alert"><Icon name="info" /><h2>暂时无法加载密钥</h2><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button></div>
        ) : items.length === 0 ? (
          <div className="settings-empty-state"><Icon name="vpn_key" /><h2>连接你的第一个工具</h2><p>创建专用密钥，将外部工具收集的网址自动保存进来。</p><button className="primary-button" type="button" onClick={openCreateDialog}><Icon name="add" />创建第一个密钥</button></div>
        ) : (
          <div className="api-token-list">
            {items.map((item) => {
              const expired = isApiTokenExpired(item);
              const storedTokenValue = storedTokenSecrets[item.id]?.value;
              const statusLabel = item.revokedAt ? "已撤销" : expired ? "已过期" : "可用";
              const statusClass = item.revokedAt ? "is-revoked" : expired ? "is-expired" : "is-active";
              return (
                <article className="api-token-card" key={item.id}>
                  <div className="api-token-card-head">
                    <span className="settings-resource-icon"><Icon name="vpn_key" /></span>
                    <div className="api-token-card-copy"><h2>{item.name}</h2><code className="api-token-preview">{item.tokenPreview}</code></div>
                    <span className={`api-token-status ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <dl className="settings-meta-grid">
                    <div><dt>权限</dt><dd>{item.scopes.join(" · ")}</dd></div>
                    <div><dt>创建时间</dt><dd>{formatWhen(item.createdAt)}</dd></div>
                    <div><dt>最近调用</dt><dd>{item.lastUsedAt ? formatRelativeWhen(item.lastUsedAt) : "尚未调用"}</dd></div>
                    <div><dt>有效期</dt><dd>{item.expiresAt ? formatWhen(item.expiresAt) : "长期有效"}</dd></div>
                  </dl>
                  <details className="api-token-details">
                    <summary><Icon name="keyboard_arrow_right" /><span>密钥与调用示例</span><small>{storedTokenValue ? "本机已保存" : "本机未保存明文"}</small></summary>
                    <div className="api-token-details-body">
                      <section className="api-token-secret-box"><div className="settings-section-heading"><div><h3>API 密钥</h3><p>{storedTokenValue ? "完整密钥仅保存在当前浏览器，可复制到你的工具中。" : "当前浏览器未保存完整密钥，服务端仅保留哈希。需要明文时请创建新密钥。"}</p></div>{storedTokenValue ? <button className="secondary-button" type="button" onClick={() => void handleCopyStoredToken(item.name, storedTokenValue)}>复制密钥</button> : null}</div><code className="api-token-code-block">{storedTokenValue ?? item.tokenPreview}</code></section>
                      <section className="api-token-usage-box"><h3>调用示例</h3><p>支持 Bearer 或 X-KeepPage-Api-Key 请求头。</p><pre className="api-token-code-block"><code>{buildBookmarkIngestCurl(apiBaseUrl, storedTokenValue ?? "<api-token>", "authorization")}</code></pre><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => void handleCopyCurl(item.name, storedTokenValue ?? "<api-token>", "authorization")}>{storedTokenValue ? "复制 Bearer 示例" : "复制 curl 模板"}</button><button className="secondary-button" type="button" onClick={() => void handleCopyCurl(item.name, storedTokenValue ?? "<api-token>", "x-api-key")}>复制 Header 示例</button></div></section>
                    </div>
                  </details>
                  <div className="api-token-card-foot"><span>{item.revokedAt ? `已于 ${formatWhen(item.revokedAt)} 撤销` : "每个工具使用独立密钥，方便管理访问权限。"}</span>{!item.revokedAt ? <button className="settings-danger-link" type="button" onClick={() => { setRevokeError(null); setRevokeTarget(item); }}>撤销密钥</button> : null}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {createOpen ? (
        <div className="manager-dialog-backdrop api-token-dialog-backdrop" onClick={closeCreateDialog}>
          <div ref={createDialogRef} tabIndex={-1} className="api-token-dialog" role="dialog" aria-modal="true" aria-labelledby="api-token-create-title" onClick={(event) => event.stopPropagation()}>
            <div className="api-token-dialog-header"><div><span className="settings-dialog-icon"><Icon name="vpn_key" /></span><h2 id="api-token-create-title">创建 API 密钥</h2><p>为一个工具创建专用凭证，随时可以撤销。</p></div><button className="settings-icon-button" type="button" aria-label="关闭创建密钥" onClick={closeCreateDialog} disabled={createBusy}><DialogCloseIcon /></button></div>
            <form className="api-token-dialog-form" onSubmit={handleCreateToken}>
              <label className="api-token-field"><span>密钥名称</span><input type="text" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="例如：Raycast 收集箱" required maxLength={120} disabled={createBusy} autoFocus /></label>
              <label className="api-token-field"><span>过期时间 <small>可选</small></span><input type="datetime-local" disabled={createBusy} value={createExpiresAt} onChange={(event) => setCreateExpiresAt(event.target.value)} /><small>留空则长期有效。</small></label>
              <div className="settings-notice"><Icon name="info" /><div><strong>仅授予书签写入权限</strong><p>允许新增或合并书签（bookmark:create）。完整密钥会保存在当前浏览器，便于复制使用。</p></div></div>
              {createError ? <p className="settings-notice is-error" role="alert">{createError}</p> : null}
              <div className="api-token-dialog-actions"><button className="secondary-button" type="button" onClick={closeCreateDialog} disabled={createBusy}>取消</button><button className="primary-button" type="submit" disabled={createBusy}>{createBusy ? "创建中…" : "创建密钥"}</button></div>
            </form>
          </div>
        </div>
      ) : null}
      {revokeTarget ? (
        <div className="manager-dialog-backdrop api-token-dialog-backdrop" onClick={() => { if (!revokeBusy) setRevokeTarget(null); }}>
          <div ref={revokeDialogRef} tabIndex={-1} className="api-token-dialog is-danger" role="dialog" aria-modal="true" aria-labelledby="api-token-revoke-title" onClick={(event) => event.stopPropagation()}>
            <div className="api-token-dialog-header"><div><span className="settings-dialog-icon is-danger"><Icon name="link_off" /></span><h2 id="api-token-revoke-title">撤销这枚密钥？</h2><p>依赖此密钥的工具将立即停止写入。已有书签不会受到影响。</p></div><button className="settings-icon-button" type="button" aria-label="关闭撤销密钥" onClick={() => setRevokeTarget(null)} disabled={revokeBusy}><DialogCloseIcon /></button></div>
            <div className="api-token-revoke-card"><strong>{revokeTarget.name}</strong><code>{revokeTarget.tokenPreview}</code></div>
            {revokeError ? <p className="settings-notice is-error" role="alert">{revokeError}</p> : null}
            <div className="api-token-dialog-actions"><button className="secondary-button" type="button" onClick={() => setRevokeTarget(null)} disabled={revokeBusy}>保留密钥</button><button className="primary-button danger-fill" type="button" onClick={() => void handleRevokeToken()} disabled={revokeBusy}>{revokeBusy ? "撤销中…" : "确认撤销"}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
