import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ApiToken } from "@keeppage/domain";
import { ApiError } from "../../api";
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
    <span className="material-symbols-outlined" aria-hidden="true">
      close
    </span>
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
  const apiBaseUrl = useMemo(() => resolveApiBaseForCurl(), []);

  useEffect(() => {
    setStoredTokenSecrets(readApiTokenSecrets(storageUserId));
  }, [storageUserId]);

  useEffect(() => {
    setFeedback(null);
    let cancelled = false;
    setLoadState("loading");
    dataSource.fetchApiTokens(token)
      .then((nextItems) => {
        if (cancelled) {
          return;
        }
        setItems(nextItems);
        setLoadError(null);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled || onApiError(error)) {
          return;
        }
        setLoadError(toErrorMessage(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, token]);

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

  function openCreateDialog() {
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
    if (!revokeTarget) {
      return;
    }

    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const revokedAt = new Date().toISOString();
      await dataSource.revokeApiToken(revokeTarget.id, token);
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
    <>
      <section className="api-token-page">
        <header className="api-token-hero">
          <div className="api-token-hero-copy">
            <p className="eyebrow">设置</p>
            <h1>API 密钥</h1>
            <p>
              给 Raycast、快捷指令、Zapier 或你自己的脚本一个受限写入口。
              目前每个密钥只授予 <code>bookmark:create</code> 权限，适合只传 URL 的自动入库场景。
            </p>
          </div>

          <div className="api-token-hero-actions">
            <button className="secondary-button" type="button" onClick={onBack}>
              返回书签
            </button>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              <span>创建 API 密钥</span>
            </button>
          </div>

          <div className="api-token-stat-grid">
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">生效密钥</span>
              <strong>{activeCount}</strong>
              <small>{items.length} 个密钥中可用的写入入口</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">最近调用</span>
              <strong>{latestUsedAt ? formatRelativeWhen(latestUsedAt) : "尚未调用"}</strong>
              <small>{latestUsedAt ? formatWhen(latestUsedAt) : "创建后等待第一次接入请求"}</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">已吊销</span>
              <strong>{revokedCount}</strong>
              <small>建议定期清理停用的集成入口</small>
            </article>
            <article className="api-token-stat-card">
              <span className="api-token-stat-label">本地明文</span>
              <strong>{locallyStoredCount}</strong>
              <small>完整密钥仅保存在当前浏览器，方便复制和 curl 调试</small>
            </article>
          </div>
        </header>

        {revealedToken ? (
          <section className="api-token-reveal-card">
            <div className="api-token-reveal-copy">
              <p className="eyebrow">可立即测试</p>
              <h2>{revealedToken.name}</h2>
              <p>完整 API 密钥已保存在当前浏览器本地。服务端仍然只保存哈希，所以换浏览器后不会重新取回明文。</p>
            </div>
            <div className="api-token-secret-shell">
              <code>{revealedToken.value}</code>
              <div className="api-token-secret-actions">
                <button className="secondary-button compact-button" type="button" onClick={() => setRevealedToken(null)}>
                  关闭提示
                </button>
                <button className="primary-button compact-button" type="button" onClick={() => void handleCopyRevealedToken()}>
                  复制完整密钥
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => void handleCopyCurl(revealedToken.name, revealedToken.value, "authorization")}
                >
                  复制 Bearer curl
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {feedback ? (
          <p className={feedback.kind === "error" ? "status-banner is-error" : "status-banner"}>
            {feedback.message}
          </p>
        ) : null}

        {loadState === "loading" && items.length > 0 ? (
          <p className="status-banner">正在刷新 API 密钥列表...</p>
        ) : null}

        {loadState === "loading" && items.length === 0 ? (
          <section className="api-token-list api-token-list-skeleton">
            {Array.from({ length: 3 }).map((_, index) => (
              <article className="api-token-card is-skeleton" key={index}>
                <div className="api-token-skeleton-line is-eyebrow" />
                <div className="api-token-skeleton-line is-title" />
                <div className="api-token-skeleton-line" />
                <div className="api-token-skeleton-row">
                  <span className="api-token-skeleton-pill" />
                  <span className="api-token-skeleton-pill" />
                </div>
              </article>
            ))}
          </section>
        ) : loadState === "error" ? (
          <section className="api-token-empty">
            <h2>API 密钥列表加载失败</h2>
            <p>{loadError ?? "暂时无法读取当前账号的 API 密钥。"}</p>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              继续创建
            </button>
          </section>
        ) : items.length === 0 ? (
          <section className="api-token-empty">
            <h2>还没有 API 密钥</h2>
            <p>创建一个只允许写入书签的 key，把外部网址流接进 KeepPage 的收集箱。</p>
            <button className="primary-button" type="button" onClick={openCreateDialog}>
              创建第一个 API 密钥
            </button>
          </section>
        ) : (
          <section className="api-token-list">
            {items.map((item) => {
              const expired = isApiTokenExpired(item);
              const storedTokenValue = storedTokenSecrets[item.id]?.value;
              const statusLabel = item.revokedAt
                ? "已吊销"
                : expired
                  ? "已过期"
                  : "可用";
              const statusClass = item.revokedAt
                ? "is-revoked"
                : expired
                  ? "is-expired"
                  : "is-active";

              return (
                <article className="api-token-card" key={item.id}>
                  <div className="api-token-card-head">
                    <div className="api-token-card-copy">
                      <p className="eyebrow">书签写入口</p>
                      <h2>{item.name}</h2>
                      <code className="api-token-preview">{item.tokenPreview}</code>
                    </div>
                    <span className={`api-token-status ${statusClass}`}>{statusLabel}</span>
                  </div>

                  <div className="api-token-meta-row">
                    {item.scopes.map((scope) => (
                      <span className="api-token-scope-chip" key={scope}>
                        {scope}
                      </span>
                    ))}
                    <span className="api-token-meta-pill">
                      创建于 {formatWhen(item.createdAt)}
                    </span>
                    <span className="api-token-meta-pill">
                      最近使用 {item.lastUsedAt ? formatRelativeWhen(item.lastUsedAt) : "尚未调用"}
                    </span>
                    <span className="api-token-meta-pill">
                      {item.expiresAt ? `到期于 ${formatWhen(item.expiresAt)}` : "长期有效"}
                    </span>
                  </div>

                  <section className="api-token-secret-box">
                    <div className="api-token-section-head">
                      <div>
                        <p className="eyebrow">API 密钥</p>
                        <p>
                          {storedTokenValue
                            ? "完整明文已保存在当前浏览器，可直接复制到脚本、Raycast 或快捷指令。"
                            : "当前浏览器没有保存这把密钥的完整明文；服务端不会再次返回明文。"}
                        </p>
                      </div>
                      {storedTokenValue ? (
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => void handleCopyStoredToken(item.name, storedTokenValue)}
                        >
                          复制密钥
                        </button>
                      ) : null}
                    </div>

                    <code className="api-token-code-block">
                      {storedTokenValue ?? item.tokenPreview}
                    </code>

                    <p className="api-token-secret-note">
                      {storedTokenValue
                        ? "为了方便测试，这个明文只保存在当前浏览器的本地存储里。"
                        : "如果你需要直接测试，请重新创建一个新的 API 密钥。"}
                    </p>
                  </section>

                  <section className="api-token-usage-box">
                    <div className="api-token-section-head">
                      <div>
                        <p className="eyebrow">curl 调试</p>
                        <p>默认示例使用 <code>Authorization: Bearer</code>。也支持复制 <code>X-KeepPage-Api-Key</code> 版本。</p>
                      </div>
                    </div>

                    <code className="api-token-code-block">
                      {buildBookmarkIngestCurl(apiBaseUrl, storedTokenValue ?? "<api-token>", "authorization")}
                    </code>

                    <div className="api-token-usage-actions">
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => void handleCopyCurl(
                          item.name,
                          storedTokenValue ?? "<api-token>",
                          "authorization",
                        )}
                      >
                        {storedTokenValue ? "复制 Bearer curl" : "复制 curl 模板"}
                      </button>
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => void handleCopyCurl(
                          item.name,
                          storedTokenValue ?? "<api-token>",
                          "x-api-key",
                        )}
                      >
                        复制 Header 版本
                      </button>
                    </div>
                  </section>

                  <div className="api-token-card-foot">
                    <p>
                      轻量写入只会创建或合并书签，不会主动抓取网页正文。适合先把 URL 丢进 KeepPage 收集箱。
                    </p>
                    {!item.revokedAt ? (
                      <button
                        className="secondary-button compact-button danger-button"
                        type="button"
                        onClick={() => {
                          setRevokeError(null);
                          setRevokeTarget(item);
                        }}
                      >
                        吊销
                      </button>
                    ) : (
                      <span className="api-token-revoked-note">
                        于 {formatWhen(item.revokedAt)} 停用
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>

      {createOpen ? (
        <div className="manager-dialog-backdrop api-token-dialog-backdrop" aria-hidden="true" onClick={closeCreateDialog}>
          <div
            className="api-token-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-token-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="api-token-dialog-shell">
              <div className="api-token-dialog-header">
                <div className="api-token-dialog-heading">
                  <p className="eyebrow">新建凭证</p>
                  <h2 id="api-token-create-title">创建 API 密钥</h2>
                  <p>生成一个只允许新增书签的写入密钥。创建成功后，完整明文会保存在当前浏览器，方便你直接复制和测试。</p>
                </div>
                <button className="create-folder-dialog-close" type="button" onClick={closeCreateDialog} disabled={createBusy}>
                  <DialogCloseIcon />
                </button>
              </div>

              <form className="api-token-dialog-form" onSubmit={handleCreateToken}>
                <label className="api-token-field">
                  <span className="api-token-field-label">密钥名称</span>
                  <input
                    type="text"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="例如 Raycast 收件箱"
                    autoFocus
                    maxLength={120}
                  />
                </label>

                <label className="api-token-field">
                  <span className="api-token-field-label">过期时间（可选）</span>
                  <input
                    type="datetime-local"
                    value={createExpiresAt}
                    onChange={(event) => setCreateExpiresAt(event.target.value)}
                  />
                  <small>留空表示长期有效。当前固定授予 <code>bookmark:create</code> 作用域。</small>
                </label>

                <div className="api-token-scope-box">
                  <span className="api-token-scope-chip">bookmark:create</span>
                  <p>适合从外部工具传入一个 URL，由 KeepPage 负责合并或新建书签记录。</p>
                </div>

                {createError ? <p className="manager-dialog-error">{createError}</p> : null}

                <div className="api-token-dialog-actions">
                  <button className="secondary-button" type="button" onClick={closeCreateDialog} disabled={createBusy}>
                    取消
                  </button>
                  <button className="primary-button" type="submit" disabled={createBusy}>
                    {createBusy ? "创建中..." : "创建密钥"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {revokeTarget ? (
        <div
          className="manager-dialog-backdrop api-token-dialog-backdrop"
          aria-hidden="true"
          onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
        >
          <div
            className="api-token-dialog is-danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-token-revoke-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="api-token-dialog-shell">
              <div className="api-token-dialog-header">
                <div className="api-token-dialog-heading">
                  <p className="eyebrow">吊销访问</p>
                  <h2 id="api-token-revoke-title">吊销 API 密钥</h2>
                  <p>吊销后，依赖这个密钥的自动化入口会立即失效，现有 URL 不会继续写入你的书签库。</p>
                </div>
                <button
                  className="create-folder-dialog-close"
                  type="button"
                  onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
                  disabled={revokeBusy}
                >
                  <DialogCloseIcon />
                </button>
              </div>

              <div className="api-token-revoke-card">
                <strong>{revokeTarget.name}</strong>
                <code>{revokeTarget.tokenPreview}</code>
              </div>

              {revokeError ? <p className="manager-dialog-error">{revokeError}</p> : null}

              <div className="api-token-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokeError(null); } }}
                  disabled={revokeBusy}
                >
                  取消
                </button>
                <button className="primary-button danger-fill" type="button" onClick={() => void handleRevokeToken()} disabled={revokeBusy}>
                  {revokeBusy ? "Revoking..." : "确认吊销"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
