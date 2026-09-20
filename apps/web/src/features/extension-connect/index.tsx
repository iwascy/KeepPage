import {
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError } from "../../api";
import type { AppDataSource } from "../../data-sources/use-app-data-source";
import { sendExtensionConnectCodeToLocalExtension } from "../../local-archive-bridge";
import { Icon } from "../../components/Icon";

type ConnectState = "idle" | "creating" | "sending" | "connected" | "error";

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "连接失败，请稍后重试。";
}

function resolveApiBaseForExtension() {
  const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim() || "/api";
  const normalizedBase = configuredBase.replace(/\/$/, "");
  if (/^https?:\/\//i.test(normalizedBase)) {
    return normalizedBase;
  }
  return new URL(normalizedBase, window.location.origin).toString().replace(/\/$/, "");
}

function readConnectParams() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  return {
    deviceName: params.get("deviceName")?.trim() || "KeepPage Chrome 扩展",
    platform: params.get("platform")?.trim() || "Chrome Extension",
    extensionId: params.get("extensionId")?.trim() || undefined,
    connectNonce: params.get("connectNonce")?.trim() || "",
  };
}

export function ExtensionConnectPage({
  token,
  dataSource,
  onApiError,
  onDone,
}: {
  token: string;
  dataSource: AppDataSource;
  onApiError?: (error: unknown) => void;
  onDone: () => void;
}) {
  const [connectParams, setConnectParams] = useState(readConnectParams);
  const attempt = useRef(0);
  const inFlight = useRef(false);
  const [state, setState] = useState<ConnectState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setConnectParams(readConnectParams());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    attempt.current += 1;
    inFlight.current = false;
    setState(connectParams.connectNonce ? "idle" : "error");
    setMessage(connectParams.connectNonce ? null : "请从 KeepPage 插件里打开网页登录授权页。");
    return () => { attempt.current += 1; };
  }, [token, dataSource, connectParams]);

  async function connectExtension() {
    if (inFlight.current) return;
    inFlight.current = true;
    const currentAttempt = ++attempt.current;
    setState("creating");
    setMessage(null);
    try {
      if (!connectParams.connectNonce) {
        throw new Error("请从 KeepPage 插件里打开网页登录授权页。");
      }

      const apiBaseUrl = resolveApiBaseForExtension();
      const result = await dataSource.createExtensionConnectCode({
        deviceName: connectParams.deviceName,
        platform: connectParams.platform,
        extensionId: connectParams.extensionId,
      }, token);
      if (currentAttempt !== attempt.current) return;
      setState("sending");
      await sendExtensionConnectCodeToLocalExtension({
        code: result.code,
        expiresAt: result.expiresAt,
        apiBaseUrl,
        connectNonce: connectParams.connectNonce,
      });
      if (currentAttempt !== attempt.current) return;
      setState("connected");
      setMessage("插件已连接。后续同步会使用独立的设备授权，不再跟随网页登录过期。");
    } catch (error) {
      if (currentAttempt !== attempt.current) return;
      setState("error");
      setMessage(toErrorMessage(error));
      onApiError?.(error);
    } finally {
      if (currentAttempt === attempt.current) inFlight.current = false;
    }
  }

  return (
    <section className="extension-connect-page">
      <section className="extension-connect-shell">
        <div className="extension-connect-mark">
          <Icon name={state === "connected" ? "check_circle" : state === "error" ? "link_off" : "link"} />
        </div>
        <div className="extension-connect-copy">
          <p>插件连接</p>
          <h1>{state === "connected" ? "浏览器已连接" : state === "error" ? "暂时无法连接" : state === "idle" ? "授权连接这台浏览器？" : "正在连接浏览器"}</h1>
          <p>
            {state === "connected"
              ? "这台浏览器已经获得长期插件授权。"
              : "连接后，可直接从浏览器保存网页。设备授权可在设置中随时撤销。"}
          </p>
        </div>

        <div className="extension-connect-device">
          <span>设备</span>
          <strong>{connectParams.deviceName}</strong>
          <small>{connectParams.platform}</small>
          {connectParams.extensionId ? <small>扩展 ID：{connectParams.extensionId}</small> : null}
        </div>

        {message ? (
          <section role={state === "error" ? "alert" : "status"} className={`settings-banner settings-${state === "error" ? "error" : "saved"}`}>
            {message}
          </section>
        ) : (
          <section role="status" className="settings-banner settings-loading">
            {state === "idle" ? "授权后，这台浏览器的插件可以同步书签与网页存档。仅在这是你正在连接的设备时继续。" : state === "creating" ? "正在创建一次性授权…" : "正在发送给本地插件…"}
          </section>
        )}

        <div className="extension-connect-actions">
          {state === "idle" || (state === "error" && connectParams.connectNonce) ? (
            <button className="primary-button" type="button" onClick={() => void connectExtension()}>
              {state === "idle" ? "授权并连接" : "重试连接"}
            </button>
          ) : null}
          <button className="secondary-button" type="button" disabled={state === "creating" || state === "sending"} onClick={onDone}>
            {state === "idle" ? "取消" : "返回 KeepPage"}
          </button>
        </div>
      </section>
    </section>
  );
}
