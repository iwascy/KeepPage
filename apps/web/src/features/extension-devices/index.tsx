import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ExtensionDevice } from "@keeppage/domain";
import { ApiError } from "../../api";
import { Icon } from "../../components/Icon";
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

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function isDeviceExpired(device: ExtensionDevice) {
  return Boolean(device.expiresAt && new Date(device.expiresAt).getTime() <= Date.now());
}

function isDeviceActive(device: ExtensionDevice) {
  return !device.revokedAt && !isDeviceExpired(device);
}

export function ExtensionDevicesPanel({
  token,
  dataSource,
  onApiError,
  onBack,
}: {
  token: string;
  dataSource: AppDataSource;
  onApiError?: (error: unknown) => void;
  onBack: () => void;
}) {
  const [devices, setDevices] = useState<ExtensionDevice[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    void loadDevices();
  }, [dataSource, token]);

  const activeCount = useMemo(() => devices.filter(isDeviceActive).length, [devices]);
  const revokedCount = useMemo(() => devices.filter((device) => Boolean(device.revokedAt)).length, [devices]);
  const recentDevice = useMemo(() => {
    return devices
      .filter((device) => Boolean(device.lastUsedAt))
      .sort((left, right) => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? ""))[0];
  }, [devices]);

  async function loadDevices() {
    setLoadState("loading");
    setFeedback(null);
    try {
      const items = await dataSource.fetchExtensionDevices(token);
      setDevices(items);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
      onApiError?.(error);
    }
  }

  async function handleRevoke(device: ExtensionDevice) {
    setRevokingId(device.id);
    setFeedback(null);
    try {
      await dataSource.revokeExtensionDevice(device.id, token);
      setDevices((current) => current.map((item) => item.id === device.id
        ? { ...item, revokedAt: new Date().toISOString() }
        : item));
      setFeedback({
        kind: "success",
        message: `已撤销 ${device.name} 的插件授权。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
      onApiError?.(error);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="api-token-page extension-device-page">
      <header className="api-token-hero">
        <div className="api-token-hero-copy">
          <p>插件设备</p>
          <h1>已连接插件</h1>
          <p>
            插件连接会独立于网页登录状态长期保持；退出网页不会影响已授权插件，除非你在这里撤销。
          </p>
        </div>
        <div className="api-token-hero-actions">
          <button className="secondary-button" type="button" onClick={onBack}>
            返回书签
          </button>
          <button className="primary-button" type="button" onClick={() => void loadDevices()}>
            <Icon name="refresh" />
            刷新
          </button>
        </div>
        <div className="api-token-stat-grid">
          <article className="api-token-stat-card">
            <span className="api-token-stat-label">已启用</span>
            <strong>{activeCount}</strong>
            <small>可继续同步的插件</small>
          </article>
          <article className="api-token-stat-card">
            <span className="api-token-stat-label">最近使用</span>
            <strong>{recentDevice?.lastUsedAt ? formatRelativeWhen(recentDevice.lastUsedAt) : "暂无"}</strong>
            <small>{recentDevice?.name ?? "未记录调用"}</small>
          </article>
          <article className="api-token-stat-card">
            <span className="api-token-stat-label">已撤销</span>
            <strong>{revokedCount}</strong>
            <small>不可再同步</small>
          </article>
        </div>
      </header>

      {feedback ? (
        <section className={`api-token-empty extension-device-feedback is-${feedback.kind}`}>
          <p>{feedback.message}</p>
        </section>
      ) : null}

      {loadState === "loading" ? (
        <section className="api-token-list api-token-list-skeleton">
          {[0, 1].map((index) => (
            <article className="api-token-card is-skeleton" key={index}>
              <div className="api-token-skeleton-line is-eyebrow" />
              <div className="api-token-skeleton-line is-title" />
              <div className="api-token-skeleton-line" />
            </article>
          ))}
        </section>
      ) : loadState === "error" ? (
        <section className="api-token-empty">
          <h2>设备列表加载失败</h2>
          <p>请稍后刷新重试。</p>
        </section>
      ) : devices.length === 0 ? (
        <section className="api-token-empty">
          <h2>还没有插件连接</h2>
          <p>在浏览器插件里点击连接 KeepPage，网页确认后会出现在这里。</p>
        </section>
      ) : (
        <section className="api-token-list extension-device-list">
          {devices.map((device) => {
            const active = isDeviceActive(device);
            const statusLabel = device.revokedAt
              ? "已撤销"
              : isDeviceExpired(device)
              ? "已过期"
              : "已启用";
            const statusClass = device.revokedAt
              ? "is-revoked"
              : isDeviceExpired(device)
              ? "is-expired"
              : "is-active";
            return (
              <article className="api-token-card extension-device-card" key={device.id}>
                <div className="api-token-card-head">
                  <div className="api-token-card-copy">
                    <p>{device.platform}</p>
                    <h2>{device.name}</h2>
                    <code className="api-token-preview">{device.tokenPreview}</code>
                  </div>
                  <span className={`api-token-status ${statusClass}`}>{statusLabel}</span>
                </div>
                <div className="api-token-meta-row">
                  <span className="api-token-meta-pill">创建于 {formatWhen(device.createdAt)}</span>
                  <span className="api-token-meta-pill">
                    最近使用 {device.lastUsedAt ? formatRelativeWhen(device.lastUsedAt) : "暂无"}
                  </span>
                  {device.expiresAt ? (
                    <span className="api-token-meta-pill">过期于 {formatWhen(device.expiresAt)}</span>
                  ) : (
                    <span className="api-token-meta-pill">长期有效</span>
                  )}
                </div>
                <div className="api-token-card-foot">
                  <p>
                    撤销后，这台浏览器插件需要重新通过网页授权才能继续同步。
                  </p>
                  {active ? (
                    <button
                      className="secondary-button"
                      disabled={revokingId === device.id}
                      type="button"
                      onClick={() => void handleRevoke(device)}
                    >
                      {revokingId === device.id ? "撤销中..." : "撤销授权"}
                    </button>
                  ) : (
                    <span className="api-token-revoked-note">
                      {device.revokedAt ? `撤销于 ${formatWhen(device.revokedAt)}` : "当前不可用"}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}
