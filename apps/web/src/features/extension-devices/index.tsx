import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExtensionDevice } from "@keeppage/domain";
import { ApiError } from "../../api";
import { useDialogFocus } from "../../app/use-dialog-focus";
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
  const [revokeTarget, setRevokeTarget] = useState<ExtensionDevice | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const loadSequence = useRef(0);
  const dialogRef = useDialogFocus(Boolean(revokeTarget), () => setRevokeTarget(null), Boolean(revokingId));

  useEffect(() => {
    void loadDevices();
    return () => { loadSequence.current += 1; };
  }, [dataSource, token]);

  const activeCount = useMemo(() => devices.filter(isDeviceActive).length, [devices]);
  const revokedCount = useMemo(() => devices.filter((device) => Boolean(device.revokedAt)).length, [devices]);
  const recentDevice = useMemo(() => {
    return devices
      .filter((device) => Boolean(device.lastUsedAt))
      .sort((left, right) => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? ""))[0];
  }, [devices]);

  async function loadDevices() {
    const requestId = ++loadSequence.current;
    setLoadState("loading");
    setFeedback(null);
    try {
      const items = await dataSource.fetchExtensionDevices(token);
      if (requestId !== loadSequence.current) return;
      setDevices(items);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadSequence.current) return;
      setLoadState("error");
      setFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
      onApiError?.(error);
    }
  }

  async function handleRevoke(device: ExtensionDevice) {
    if (revokingId) return;
    setRevokingId(device.id);
    setFeedback(null);
    try {
      await dataSource.revokeExtensionDevice(device.id, token);
      loadSequence.current += 1;
      setLoadState("ready");
      setDevices((current) => current.map((item) => item.id === device.id
        ? { ...item, revokedAt: new Date().toISOString() }
        : item));
      setRevokeTarget(null);
      requestAnimationFrame(() => pageHeadingRef.current?.focus());
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
    <section className="api-token-page extension-device-page settings-surface">
      <header className="settings-page-heading"><div><p className="settings-kicker">连接与集成</p><h1 ref={pageHeadingRef} tabIndex={-1}>插件设备</h1><p>管理已授权的浏览器，随时掌握哪些设备可以同步书签。</p></div><div className="settings-actions"><button className="secondary-button" type="button" onClick={onBack}>返回书签</button><button className="secondary-button" type="button" disabled={loadState === "loading"} onClick={() => void loadDevices()}><Icon name="refresh" />{loadState === "loading" ? "加载中…" : "刷新设备"}</button></div></header>
      <div className="settings-metrics" aria-label="设备概况"><div><span>已连接</span><strong>{loadState === "loading" && !devices.length ? "—" : activeCount}</strong></div><div><span>最近使用</span><strong>{recentDevice?.lastUsedAt ? formatRelativeWhen(recentDevice.lastUsedAt) : "尚未使用"}</strong></div><div><span>已撤销</span><strong>{revokedCount}</strong></div></div>
      {feedback && !revokeTarget ? <p role={feedback.kind === "error" ? "alert" : "status"} className={`settings-notice ${feedback.kind === "error" ? "is-error" : "is-success"}`}>{feedback.message}</p> : null}
      <div className="settings-notice"><Icon name="info" /><div><strong>设备授权独立于网页登录</strong><p>退出网页后，插件仍可同步。在这里撤销授权后，该设备需要重新连接。</p></div></div>
      <section className="settings-resource-section"><div className="settings-section-heading"><div><h2>已授权设备 <span className="settings-count">{devices.length}</span></h2><p>在插件中点击「连接 KeepPage」，即可添加当前浏览器。</p></div></div>
      {loadState === "loading" && !devices.length ? (
        <div className="api-token-list-skeleton" role="status" aria-label="正在加载设备">{[0, 1].map((index) => <div className="api-token-card is-skeleton" key={index}><div className="api-token-skeleton-line is-title" /><div className="api-token-skeleton-line" /></div>)}</div>
      ) : loadState === "error" && !devices.length ? (
        <div className="settings-empty-state"><Icon name="info" /><h2>设备列表加载失败</h2><p>请检查网络连接后重试。</p><button className="secondary-button" type="button" onClick={() => void loadDevices()}>重新加载</button></div>
      ) : devices.length === 0 ? (
        <div className="settings-empty-state"><Icon name="link" /><h2>连接你的浏览器</h2><p>打开 KeepPage 插件并点击「连接 KeepPage」。连接完成后，设备会显示在这里。</p></div>
      ) : (
        <div className="api-token-list extension-device-list">{devices.map((device) => {
          const active = isDeviceActive(device);
          const statusLabel = device.revokedAt ? "已撤销" : isDeviceExpired(device) ? "已过期" : "已连接";
          const statusClass = device.revokedAt ? "is-revoked" : isDeviceExpired(device) ? "is-expired" : "is-active";
          return <article className="api-token-card extension-device-card" key={device.id}>
            <div className="api-token-card-head"><span className="settings-resource-icon"><Icon name="link" /></span><div className="api-token-card-copy"><h2>{device.name}</h2><p>{device.platform}</p></div><span className={`api-token-status ${statusClass}`}>{statusLabel}</span></div>
            <dl className="settings-meta-grid"><div><dt>授权时间</dt><dd>{formatWhen(device.createdAt)}</dd></div><div><dt>最近同步</dt><dd>{device.lastUsedAt ? formatRelativeWhen(device.lastUsedAt) : "尚未使用"}</dd></div><div><dt>有效期</dt><dd>{device.expiresAt ? formatWhen(device.expiresAt) : "长期有效"}</dd></div><div><dt>设备凭证</dt><dd><code>{device.tokenPreview}</code></dd></div></dl>
            <div className="api-token-card-foot"><span>{device.revokedAt ? `已于 ${formatWhen(device.revokedAt)} 撤销` : active ? "可同步书签与网页存档" : "重新连接后可恢复同步"}</span>{active ? <button className="settings-danger-link" type="button" onClick={() => { setFeedback(null); setRevokeTarget(device); }}>撤销授权</button> : null}</div>
          </article>;
        })}</div>
      )}</section>
      {revokeTarget ? <div className="manager-dialog-backdrop api-token-dialog-backdrop" onClick={() => { if (!revokingId) setRevokeTarget(null); }}><div ref={dialogRef} tabIndex={-1} className="api-token-dialog" role="dialog" aria-modal="true" aria-labelledby="device-revoke-title" onClick={(event) => event.stopPropagation()}>
        <div className="api-token-dialog-header"><div><span className="settings-dialog-icon is-danger"><Icon name="link_off" /></span><h2 id="device-revoke-title">断开这台设备？</h2><p>插件将停止同步，需要重新连接 KeepPage 才能继续使用。已保存的书签不受影响。</p></div><button type="button" className="settings-icon-button" aria-label="关闭撤销授权" disabled={Boolean(revokingId)} onClick={() => setRevokeTarget(null)}><Icon name="close" /></button></div>
        <div className="api-token-revoke-card"><strong>{revokeTarget.name}</strong><span>{revokeTarget.platform}</span></div>
        {feedback?.kind === "error" ? <p className="settings-notice is-error" role="alert">{feedback.message}</p> : null}
        <div className="api-token-dialog-actions"><button className="secondary-button" type="button" disabled={Boolean(revokingId)} onClick={() => setRevokeTarget(null)}>保留连接</button><button className="primary-button danger-fill" type="button" disabled={Boolean(revokingId)} onClick={() => void handleRevoke(revokeTarget)}>{revokingId ? "撤销中…" : "撤销授权"}</button></div>
      </div></div> : null}
    </section>
  );
}
