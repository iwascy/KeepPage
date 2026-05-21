import {
  useEffect,
  useMemo,
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
  const connectParams = useMemo(() => readConnectParams(), []);
  const [state, setState] = useState<ConnectState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void connectExtension();
  }, [token, dataSource]);

  async function connectExtension() {
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
      setState("sending");
      await sendExtensionConnectCodeToLocalExtension({
        code: result.code,
        expiresAt: result.expiresAt,
        apiBaseUrl,
        connectNonce: connectParams.connectNonce,
      });
      setState("connected");
      setMessage("插件已连接。后续同步会使用独立的设备授权，不再跟随网页登录过期。");
    } catch (error) {
      setState("error");
      setMessage(toErrorMessage(error));
      onApiError?.(error);
    }
  }

  return (
    <main className="extension-connect-page">
      <section className="extension-connect-shell">
        <div className="extension-connect-mark">
          <Icon name={state === "connected" ? "link" : "vpn_key"} />
        </div>
        <div className="extension-connect-copy">
          <p>插件连接</p>
          <h1>{state === "connected" ? "连接完成" : "正在连接 KeepPage 插件"}</h1>
          <p>
            {state === "connected"
              ? "这台浏览器已经获得长期插件授权。"
              : "网页会把一次性授权发送给本地插件，插件兑换后会保存自己的长期设备令牌。"}
          </p>
        </div>

        <div className="extension-connect-device">
          <span>设备</span>
          <strong>{connectParams.deviceName}</strong>
          <small>{connectParams.platform}</small>
        </div>

        {message ? (
          <section className={`settings-banner settings-${state === "error" ? "error" : "saved"}`}>
            {message}
          </section>
        ) : (
          <section className="settings-banner settings-loading">
            {state === "creating" ? "正在创建一次性授权..." : "正在发送给本地插件..."}
          </section>
        )}

        <div className="extension-connect-actions">
          {state === "error" ? (
            <button className="primary-button" type="button" onClick={() => void connectExtension()}>
              重试连接
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={onDone}>
            返回 KeepPage
          </button>
        </div>
      </section>
    </main>
  );
}
