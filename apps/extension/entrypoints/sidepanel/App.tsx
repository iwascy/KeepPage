import { useEffect, useMemo, useState } from "react";
import type {
  AuthUser,
  CaptureProfile,
  CaptureTask,
  PrivateAutoLock,
  PrivateVaultSummary,
  SaveMode,
} from "@keeppage/domain";
import {
  MESSAGE_TYPE,
  type PrivateVaultStateResponse,
  type RefreshAllBookmarkIconsRequest,
  type TaskUpdatedEvent,
} from "../../src/lib/messages";
import { getStoredAuthToken, getStoredAuthUser } from "../../src/lib/auth-storage";
import { ensureArchiveBaseHref } from "../../src/lib/domain-runtime";
import {
  clearStoredAuthSession,
  normalizeApiBaseUrl,
  openExtensionAuthPage,
  openSidePanelForCurrentWindow,
  validateStoredAuthSession,
} from "../../src/lib/auth-flow";
import {
  PROFILE_META,
  captureProfileLabel,
  captureScopeLabel,
  captureStatusLabel,
  privateModeLabel,
  privateSyncStateLabel,
  qualityGradeLabel,
} from "../../src/lib/ui-shared/capture-status";

type AsyncState = "idle" | "capturing" | "error";
type SettingsState = "idle" | "saving" | "saved" | "error";
type IconRefreshState = "idle" | "refreshing" | "saved" | "error";
type ConnectionState = "idle" | "testing" | "ok" | "error";
type AuthState = "idle" | "submitting" | "ok" | "error";
type NavTab = "queue" | "settings";
type MobileView = "list" | "detail";

const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const LOCKED_CAPTURE_PROFILE: CaptureProfile = "complete";
const SIDE_PANEL_SAVE_MODE_INTENT_KEY = "sidePanelSaveModeIntent";
const SIDE_PANEL_NOTICE_KEY = "sidePanelNotice";
const SIDE_PANEL_NOTICE_TTL_MS = 2 * 60 * 1000;

const AUTO_LOCK_OPTIONS: Array<{ value: PrivateAutoLock; label: string }> = [
  { value: "5m", label: "5 分钟" },
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "browser", label: "浏览器关闭后" },
];

const AUTH_PAGE_VIEW = new URLSearchParams(window.location.search).get("view") === "auth";
const AUTH_PAGE_REASON = new URLSearchParams(window.location.search).get("reason");

export function App() {
  const [tasks, setTasks] = useState<CaptureTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [state, setState] = useState<AsyncState>("idle");
  const [saveMode, setSaveMode] = useState<SaveMode>("standard");
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>(LOCKED_CAPTURE_PROFILE);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [incognitoPrivateDefault, setIncognitoPrivateDefault] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState>("idle");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [iconRefreshState, setIconRefreshState] = useState<IconRefreshState>("idle");
  const [iconRefreshMessage, setIconRefreshMessage] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [vaultSummary, setVaultSummary] = useState<PrivateVaultSummary | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [vaultAutoLock, setVaultAutoLock] = useState<PrivateAutoLock>("15m");
  const [error, setError] = useState<string | null>(null);

  // 导航与响应式视图切换
  const [activeNavTab, setActiveNavTab] = useState<NavTab>("queue");
  const [mobileView, setMobileView] = useState<MobileView>("list");

  useEffect(() => {
    void Promise.all([loadSettings(), refreshPrivateVaultState()]);
  }, []);

  useEffect(() => {
    void refreshTasks(saveMode);
    if (saveMode === "private") {
      void refreshPrivateVaultState();
    }
  }, [saveMode, authUser?.id]);

  useEffect(() => {
    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void,
    ) => {
      const event = message as Partial<TaskUpdatedEvent>;
      if (event.type !== MESSAGE_TYPE.TaskUpdated || !event.task) {
        return;
      }
      if ((event.task.saveMode ?? "standard") !== saveMode) {
        return;
      }
      setTasks((previous) => {
        const next = [event.task!, ...previous.filter((item) => item.id !== event.task!.id)];
        return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20);
      });
      setSelectedTaskId((current) => current ?? event.task!.id);
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [saveMode]);

  useEffect(() => {
    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== "local" || (!changes.authToken && !changes.authApiToken && !changes.extensionDeviceToken && !changes.authUser)) {
        return;
      }

      void syncAuthStateFromStorage();
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [saveMode]);

  useEffect(() => {
    async function consumeSidePanelNotice() {
      const result = await chrome.storage.session.get(SIDE_PANEL_NOTICE_KEY);
      if (!result[SIDE_PANEL_NOTICE_KEY]) {
        return;
      }
      await chrome.storage.session.remove(SIDE_PANEL_NOTICE_KEY);
      const notice = parseSidePanelNotice(result[SIDE_PANEL_NOTICE_KEY]);
      if (!notice) {
        return;
      }
      setSaveMode(notice.saveMode);
      setError(notice.message);
    }

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== "session") {
        return;
      }
      const requestedSaveMode = parseSaveModeIntent(changes[SIDE_PANEL_SAVE_MODE_INTENT_KEY]?.newValue);
      if (requestedSaveMode) {
        void chrome.storage.session.remove(SIDE_PANEL_SAVE_MODE_INTENT_KEY);
        setSaveMode(requestedSaveMode);
      }
      if (changes[SIDE_PANEL_NOTICE_KEY]?.newValue) {
        void consumeSidePanelNotice();
      }
    };

    void consumeSidePanelNotice();
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const isPrivateView = saveMode === "private";
  const isVaultEnabled = Boolean(vaultSummary?.enabled);
  const isVaultUnlocked = Boolean(vaultSummary?.unlocked);
  const isPrivateLockedView = isPrivateView && (!isVaultEnabled || !isVaultUnlocked);
  const canResumeSync = Boolean(
    !isPrivateView &&
      selectedTask &&
      selectedTask.status === "upload_pending" &&
      selectedTask.artifacts?.archiveHtml &&
      typeof selectedTask.artifacts.extractedText === "string" &&
      selectedTask.quality &&
      selectedTask.localArchiveSha256,
  );
  const retryLabel = isPrivateView
    ? "重新抓取"
    : canResumeSync && selectedTask?.profile === captureProfile
    ? "继续同步"
    : selectedTask?.source.captureScope === "selection"
    ? "需回页面重选"
    : "按当前方案重抓";

  const primaryActionLabel = useMemo(() => {
    if (!authUser) {
      return "连接账号后保存";
    }
    if (state === "capturing") {
      return isPrivateView ? "私密保存中..." : "保存中...";
    }
    if (isPrivateView && !isVaultEnabled) {
      return "先启用私密模式";
    }
    if (isPrivateView && !isVaultUnlocked) {
      return "先解锁私密密码";
    }
    return isPrivateView ? "私密保存当前页" : "保存当前页";
  }, [authUser, state, isPrivateView, isVaultEnabled, isVaultUnlocked]);

  async function syncAuthStateFromStorage() {
    const [token, user] = await Promise.all([
      getStoredAuthToken(),
      getStoredAuthUser(),
    ]);

    if (!token || !user) {
      setAuthUser(null);
      setTasks([]);
      setSelectedTaskId(null);
      setAuthState("idle");
      setAuthMessage("插件设备未连接或已退出，请通过网页连接后再继续保存。");
      return;
    }

    setAuthUser(user);
    setAuthState("ok");
    setAuthMessage(`已连接 ${user.email}，现在可以继续使用扩展。`);
    await refreshTasks(saveMode);
  }

  async function refreshTasks(nextSaveMode = saveMode) {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.ListTasks,
      limit: 20,
      saveMode: nextSaveMode,
    });
    if (!response?.ok) {
      setError(response?.error ?? "加载任务列表失败。");
      return;
    }
    const nextTasks = (response.tasks as CaptureTask[]) ?? [];
    setTasks(nextTasks);
    setSelectedTaskId((current) => {
      if (current && nextTasks.some((task) => task.id === current)) {
        return current;
      }
      return nextTasks[0]?.id ?? null;
    });
  }

  async function refreshPrivateVaultState() {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.GetPrivateVaultState,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "加载私密模式状态失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
  }

  async function captureCurrentPage() {
    setState("capturing");
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.TriggerCaptureActiveTab,
      profile: captureProfile,
      saveMode,
    });
    if (!response?.ok) {
      setState("error");
      setError(response?.error ?? "触发保存失败。");
      return;
    }
    setState("idle");
    await refreshTasks(saveMode);
    if (saveMode === "private") {
      await refreshPrivateVaultState();
    }
  }

  async function ensureReadyForCaptureAction() {
    if (!authUser) {
      setAuthState("idle");
      setAuthMessage("请先通过网页连接 KeepPage，连接后就可以开始使用扩展。");
      await openExtensionAuthPage("capture-button");
      return false;
    }
    if (isPrivateView && !isVaultEnabled) {
      setError("请先启用私密模式，再进行私密保存。");
      return false;
    }
    if (isPrivateView && !isVaultUnlocked) {
      setError("私密模式当前已锁定，请先输入密码。");
      return false;
    }
    return true;
  }

  async function startSelectionCaptureAction() {
    if (!await ensureReadyForCaptureAction()) {
      return;
    }
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.StartSelectionCapture,
      profile: captureProfile,
      saveMode,
    });
    if (!response?.ok) {
      setError(response?.error ?? "启动选区保存失败。");
    }
  }

  async function handlePrimaryAction() {
    if (!await ensureReadyForCaptureAction()) {
      return;
    }
    await captureCurrentPage();
  }

  async function retryCurrentTask() {
    if (!selectedTask) {
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.RetryTask,
      taskId: selectedTask.id,
      profile: captureProfile,
      saveMode,
    });
    if (!response?.ok) {
      setError(response?.error ?? "重试失败。");
      return;
    }
    await refreshTasks(saveMode);
  }

  async function openPreviewInNewTab() {
    if (!selectedTask) {
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.OpenTaskPreview,
      taskId: selectedTask.id,
    });
    if (!response?.ok) {
      setError(response?.error ?? "打开预览失败。");
    }
  }

  async function createPrivateVaultAction() {
    setError(null);
    if (vaultPassphrase.trim().length < 8) {
      setError("私密密码至少需要 8 位。");
      return;
    }
    if (vaultPassphrase !== vaultPassphraseConfirm) {
      setError("两次输入的私密密码不一致。");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.CreatePrivateVault,
      passphrase: vaultPassphrase,
      autoLock: vaultAutoLock,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "启用私密模式失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    setVaultPassphrase("");
    setVaultPassphraseConfirm("");
    setUnlockPassphrase("");
    setSaveMode("private");
    await refreshTasks("private");
  }

  async function unlockPrivateVaultAction() {
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.UnlockPrivateVault,
      passphrase: unlockPassphrase,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "进入私密模式失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    setUnlockPassphrase("");
    await refreshTasks("private");
  }

  async function changePrivateAutoLockAction(autoLock: PrivateAutoLock) {
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.SetPrivateAutoLock,
      autoLock,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "更新自动锁定时间失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
  }

  async function lockPrivateVaultAction() {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.LockPrivateVault,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "退出私密模式失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    await refreshTasks("private");
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get([
      "apiBaseUrl",
      "saveModePreference",
      "incognitoPrivateDefault",
      "debugMode",
      "authToken",
      "authApiToken",
      "extensionDeviceToken",
      "authUser",
    ]);
    const normalizedApiBaseUrl = typeof result.apiBaseUrl === "string" && result.apiBaseUrl.trim()
      ? normalizeApiBaseUrl(result.apiBaseUrl)
      : DEFAULT_API_BASE_URL;
    setApiBaseUrl(normalizedApiBaseUrl);
    setCaptureProfile(LOCKED_CAPTURE_PROFILE);

    const nextIncognitoPrivateDefault = result.incognitoPrivateDefault !== false;
    setIncognitoPrivateDefault(nextIncognitoPrivateDefault);
    setDebugMode(result.debugMode === true);
    const saveModeIntent = await chrome.storage.session.get(SIDE_PANEL_SAVE_MODE_INTENT_KEY);
    await chrome.storage.session.remove(SIDE_PANEL_SAVE_MODE_INTENT_KEY);
    const requestedSaveMode = parseSaveModeIntent(saveModeIntent[SIDE_PANEL_SAVE_MODE_INTENT_KEY]);
    const detectedInitialSaveMode = requestedSaveMode ?? await resolveInitialSaveMode(
      typeof result.saveModePreference === "string" ? result.saveModePreference : undefined,
      nextIncognitoPrivateDefault,
    );
    setSaveMode(detectedInitialSaveMode);

    const storedToken = typeof result.extensionDeviceToken === "string" && result.extensionDeviceToken.trim()
      ? result.extensionDeviceToken.trim()
      : typeof result.authApiToken === "string" && result.authApiToken.trim()
      ? result.authApiToken.trim()
      : typeof result.authToken === "string"
      ? result.authToken.trim()
      : "";
    if (!storedToken) {
      setTasks([]);
      setSelectedTaskId(null);
      if (AUTH_PAGE_VIEW) {
        setAuthState("idle");
        setAuthMessage("请在网页端连接 KeepPage，完成后就可以直接使用扩展。");
      }
      return;
    }

    const parsedUser = await getStoredAuthUser();
    if (parsedUser) {
      setAuthUser(parsedUser);
    }

    const session = await validateStoredAuthSession();
    if (session.ok) {
      setAuthUser(session.user);
      setAuthState("ok");
      setAuthMessage(`已连接 ${session.user.email}，后续同步将归到这个账号。`);
      await refreshTasks(detectedInitialSaveMode);
      return;
    }

    if (session.reason === "unreachable" && parsedUser) {
      setAuthUser(parsedUser);
      setAuthState("ok");
      setAuthMessage(`暂时无法验证服务器连接，已保留 ${parsedUser.email} 的本地连接。`);
      await refreshTasks(detectedInitialSaveMode);
      return;
    }

    if (session.reason === "unauthorized") {
      await clearStoredAuthSession();
      setAuthUser(null);
      setTasks([]);
      setSelectedTaskId(null);
      setAuthState("error");
      setAuthMessage(session.message);
      return;
    }

    setAuthState("error");
    setAuthMessage(session.message);
  }

  async function saveSettings() {
    setSettingsState("saving");
    setSettingsMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      await chrome.storage.local.set({
        apiBaseUrl: normalizedApiBaseUrl,
        captureProfilePreference: LOCKED_CAPTURE_PROFILE,
        saveModePreference: saveMode,
        incognitoPrivateDefault,
        debugMode,
      });
      setApiBaseUrl(normalizedApiBaseUrl);
      setSettingsState("saved");
      setSettingsMessage("设置已保存，后续保存和同步将立即生效。");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (saveError) {
      setSettingsState("error");
      setSettingsMessage(
        saveError instanceof Error ? saveError.message : "保存设置失败。",
      );
    }
  }

  async function resetApiBaseUrl() {
    setApiBaseUrl(DEFAULT_API_BASE_URL);
    setSettingsState("saving");
    setSettingsMessage(null);
    try {
      await chrome.storage.local.set({
        apiBaseUrl: DEFAULT_API_BASE_URL,
      });
      setSettingsState("saved");
      setSettingsMessage("已恢复默认 API 地址。");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (saveError) {
      setSettingsState("error");
      setSettingsMessage(
        saveError instanceof Error ? saveError.message : "重置 API 地址失败。",
      );
    }
  }

  async function refreshAllIcons() {
    setIconRefreshState("refreshing");
    setIconRefreshMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.RefreshAllBookmarkIcons,
      } satisfies RefreshAllBookmarkIconsRequest) as {
        ok: boolean;
        refreshed?: number;
        skipped?: number;
        error?: string;
      };
      if (!response?.ok) {
        throw new Error(response?.error ?? "刷新网站图标失败。");
      }
      setIconRefreshState("saved");
      setIconRefreshMessage(`已刷新 ${response.refreshed ?? 0} 个网站图标，跳过 ${response.skipped ?? 0} 个。`);
    } catch (refreshError) {
      setIconRefreshState("error");
      setIconRefreshMessage(refreshError instanceof Error ? refreshError.message : "刷新网站图标失败。");
    }
  }

  async function connectAccount() {
    setAuthState("submitting");
    setAuthMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      await chrome.storage.local.set({
        apiBaseUrl: normalizedApiBaseUrl,
      });
      setApiBaseUrl(normalizedApiBaseUrl);
      await openExtensionAuthPage("manual-connect");
      setAuthState("idle");
      setAuthMessage("已打开网页登录授权页。完成网页授权后，插件会自动连接。");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (authError) {
      setAuthState("error");
      setAuthMessage(
        authError instanceof Error ? authError.message : "打开网页授权失败。",
      );
    }
  }

  async function logoutAuth() {
    await clearStoredAuthSession();
    setAuthUser(null);
    setTasks([]);
    setSelectedTaskId(null);
    setAuthState("idle");
    setAuthMessage("已退出当前插件设备。要继续保存网页，请重新通过网页连接。");
    setConnectionState("idle");
    setConnectionMessage(null);
  }

  async function testConnection() {
    setConnectionState("testing");
    setConnectionMessage(null);
    try {
      const token = await getStoredAuthToken();
      if (!token) {
        throw new Error("请先通过网页连接插件，再测试同步连接。");
      }

      const session = await validateStoredAuthSession();
      if (!session.ok) {
        if (session.reason === "unauthorized") {
          await clearStoredAuthSession();
          setAuthUser(null);
        }
        throw new Error(session.message);
      }

      setAuthUser(session.user);
      setConnectionState("ok");
      setConnectionMessage(`连接正常，当前账号 ${session.user.email}。`);
    } catch (testError) {
      setConnectionState("error");
      setConnectionMessage(
        testError instanceof Error ? testError.message : "无法连接到同步服务。",
      );
    }
  }

  // 点击任务卡片切换
  function handleSelectTask(id: string) {
    setSelectedTaskId(id);
    setMobileView("detail");
  }

  // 网页授权落地页视图 (?view=auth)
  if (AUTH_PAGE_VIEW) {
    const authPageTitle = authUser ? "KeepPage 已连接" : "连接 KeepPage";
    const authPageSubtitle = authUser
      ? "当前浏览器已经绑定账号，可以回到侧边栏继续保存网页。"
      : AUTH_PAGE_REASON === "session-expired"
      ? "插件授权已失效，请通过网页重新连接后继续使用扩展。"
      : "完成网页授权后，扩展会自动回到侧边栏，你就可以直接保存当前页面。";
    const authPageApiHost = normalizeApiBaseUrl(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/^https?:\/\//, "");

    return (
      <div className="sp-auth-container">
        <main className="sp-auth-card">
          <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="sp-brand-logo">K</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sp-text-muted)" }}>KeepPage 浏览器扩展</span>
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>{authPageTitle}</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--sp-text-secondary)" }}>{authPageSubtitle}</p>
            <span style={{ fontSize: 11, color: "var(--sp-text-muted)" }}>当前后端：{authPageApiHost}</span>
          </header>

          <section className="sp-settings-section" style={{ padding: 14 }}>
            <div className="sp-settings-header">
              <span className="sp-settings-title">账号连接</span>
            </div>

            {authUser ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, background: "#f8fafc", borderRadius: 8 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--sp-primary)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>
                    {(authUser.name || authUser.email).slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: 13 }}>{authUser.name || authUser.email}</strong>
                    <span style={{ fontSize: 11, color: "var(--sp-text-muted)" }}>{authUser.email}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="sp-btn-primary" onClick={() => void openSidePanelForCurrentWindow()} type="button">
                    打开侧边栏
                  </button>
                  <button className="sp-btn-secondary" onClick={logoutAuth} type="button">
                    退出登录
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--sp-text-secondary)" }}>
                  登录后，保存的网页归档将自动与你的 KeepPage 个人书签库保持同步。
                </p>
                <button className="sp-btn-primary" onClick={connectAccount} disabled={authState === "submitting"} type="button">
                  {authState === "submitting" ? "正在跳转授权..." : "前往网页登录授权"}
                </button>
              </div>
            )}

            {authMessage && (
              <div className={`sp-banner ${authState === "error" ? "sp-banner-error" : "sp-banner-info"}`}>
                {authMessage}
              </div>
            )}
          </section>

          <section className="sp-settings-section" style={{ padding: 14 }}>
            <div className="sp-settings-header">
              <span className="sp-settings-title">服务器地址</span>
              <span className="sp-settings-desc">如需使用自建实例，可在此修改。</span>
            </div>
            <div className="sp-field">
              <input
                className="sp-input"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={DEFAULT_API_BASE_URL}
                spellCheck={false}
              />
            </div>
            <div className="sp-btn-row">
              <button className="sp-btn-sm" onClick={saveSettings} disabled={settingsState === "saving"} type="button">
                {settingsState === "saving" ? "保存中..." : "保存地址"}
              </button>
              <button className="sp-btn-sm" onClick={testConnection} disabled={connectionState === "testing"} type="button">
                {connectionState === "testing" ? "测试中..." : "测试连接"}
              </button>
              <button className="sp-btn-sm" onClick={resetApiBaseUrl} type="button">
                恢复默认
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="sp-shell">
      {/* 顶部常驻导航栏 */}
      <header className="sp-header">
        <div className="sp-brand">
          <div className="sp-brand-logo">K</div>
          <span className="sp-brand-text">KeepPage</span>
        </div>

        {/* 模式切换胶囊 */}
        <div className="sp-mode-switch">
          <button
            className={`sp-mode-btn ${saveMode === "standard" ? "active" : ""}`}
            onClick={() => setSaveMode("standard")}
            type="button"
          >
            普通
          </button>
          <button
            className={`sp-mode-btn is-private ${saveMode === "private" ? "active" : ""}`}
            onClick={() => setSaveMode("private")}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            私密
          </button>
        </div>

        {/* 右侧工具入口 */}
        <div className="sp-header-actions">
          {authUser ? (
            <div className="sp-user-badge" title={`已连接账号: ${authUser.email}`}>
              <div className="sp-user-dot" />
              <span className="sp-user-email">{authUser.name || authUser.email}</span>
            </div>
          ) : (
            <div
              className="sp-user-badge unauth"
              onClick={connectAccount}
              title="未连接账号，点击连接"
            >
              <div className="sp-user-dot" />
              <span>未连接</span>
            </div>
          )}

          <button
            className={`sp-icon-btn ${activeNavTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveNavTab(activeNavTab === "queue" ? "settings" : "queue")}
            title={activeNavTab === "queue" ? "扩展设置" : "返回队列"}
            type="button"
          >
            {activeNavTab === "queue" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 视图主体 */}
      <div className="sp-body">
        {activeNavTab === "settings" ? (
          /* ================= 设置视图 ================= */
          <div className="sp-settings-view">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>扩展设置</h2>
              <button className="sp-btn-sm" onClick={() => setActiveNavTab("queue")} type="button">
                返回队列
              </button>
            </div>

            {/* 账号卡片 */}
            <section className="sp-settings-section">
              <div className="sp-settings-header">
                <span className="sp-settings-title">KeepPage 账号</span>
                <span className="sp-settings-desc">同步本地归档与书签数据</span>
              </div>
              {authUser ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--sp-primary)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>
                      {(authUser.name || authUser.email).slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{authUser.name || authUser.email}</div>
                      <div style={{ fontSize: 11, color: "var(--sp-text-muted)" }}>{authUser.email}</div>
                    </div>
                  </div>
                  <button className="sp-btn-sm" onClick={logoutAuth} type="button">
                    退出登录
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--sp-text-secondary)" }}>
                    尚未连接 KeepPage 账号。连接后，本地抓取的快照将自动同步到云端。
                  </p>
                  <button className="sp-btn-primary" onClick={connectAccount} disabled={authState === "submitting"} type="button">
                    {authState === "submitting" ? "打开中..." : "打开网页授权"}
                  </button>
                </div>
              )}
              {authMessage && (
                <div className={`sp-banner ${authState === "error" ? "sp-banner-error" : "sp-banner-info"}`}>
                  {authMessage}
                </div>
              )}
            </section>

            {/* API 连接卡片 */}
            <section className="sp-settings-section">
              <div className="sp-settings-header">
                <span className="sp-settings-title">服务端地址</span>
                <span className="sp-settings-desc">自部署或私有服务配置</span>
              </div>
              <div className="sp-field">
                <input
                  className="sp-input"
                  value={apiBaseUrl}
                  onChange={(event) => setApiBaseUrl(event.target.value)}
                  placeholder={DEFAULT_API_BASE_URL}
                  spellCheck={false}
                />
              </div>
              <div className="sp-btn-row">
                <button className="sp-btn-sm" onClick={saveSettings} disabled={settingsState === "saving"} type="button">
                  {settingsState === "saving" ? "保存中..." : "保存地址"}
                </button>
                <button className="sp-btn-sm" onClick={testConnection} disabled={connectionState === "testing"} type="button">
                  {connectionState === "testing" ? "测试中..." : "测试连接"}
                </button>
                <button className="sp-btn-sm" onClick={resetApiBaseUrl} type="button">
                  恢复默认
                </button>
              </div>
              {settingsMessage && (
                <div className={`sp-banner ${settingsState === "error" ? "sp-banner-error" : "sp-banner-success"}`}>
                  {settingsMessage}
                </div>
              )}
              {connectionMessage && (
                <div className={`sp-banner ${connectionState === "error" ? "sp-banner-error" : "sp-banner-info"}`}>
                  {connectionMessage}
                </div>
              )}
            </section>

            {/* 抓取与常规偏好 */}
            <section className="sp-settings-section">
              <div className="sp-settings-header">
                <span className="sp-settings-title">偏好设置</span>
                <span className="sp-settings-desc">自定义保存行为</span>
              </div>
              <label className="sp-toggle-row">
                <input
                  type="checkbox"
                  checked={incognitoPrivateDefault}
                  onChange={(event) => {
                    setIncognitoPrivateDefault(event.target.checked);
                    void chrome.storage.local.set({ incognitoPrivateDefault: event.target.checked });
                  }}
                />
                <span>在 Chrome 无痕窗口下默认启用私密模式</span>
              </label>
              <label className="sp-toggle-row">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(event) => {
                    setDebugMode(event.target.checked);
                    void chrome.storage.local.set({ debugMode: event.target.checked });
                  }}
                />
                <span>开启调试模式（控制台打印抓取与同步日志）</span>
              </label>
            </section>

            {/* 维护工具 */}
            <section className="sp-settings-section">
              <div className="sp-settings-header">
                <span className="sp-settings-title">数据维护</span>
                <span className="sp-settings-desc">书签图标等资源刷新</span>
              </div>
              <div className="sp-btn-row">
                <button
                  className="sp-btn-sm"
                  disabled={iconRefreshState === "refreshing"}
                  onClick={refreshAllIcons}
                  type="button"
                >
                  {iconRefreshState === "refreshing" ? "刷新中..." : "重新抓取所有书签 Favicon"}
                </button>
              </div>
              {iconRefreshMessage && (
                <div className={`sp-banner ${iconRefreshState === "error" ? "sp-banner-error" : "sp-banner-info"}`}>
                  {iconRefreshMessage}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ================= 队列主视图 ================= */
          <>
            {/* 快捷保存条 */}
            <div className="sp-capture-bar">
              <div className="sp-capture-buttons">
                <button
                  className={`sp-btn-primary ${isPrivateView ? "is-private" : ""}`}
                  disabled={state === "capturing"}
                  onClick={handlePrimaryAction}
                  type="button"
                >
                  {state === "capturing" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                  ) : isPrivateView ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/>
                      <polyline points="7 3 7 8 15 8"/>
                    </svg>
                  )}
                  {primaryActionLabel}
                </button>

                <button
                  className="sp-btn-secondary"
                  disabled={state === "capturing"}
                  onClick={startSelectionCaptureAction}
                  title="在当前页面框选特定正文保存"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3"/>
                  </svg>
                  选区保存
                </button>
              </div>

              <div className="sp-capture-subtext">
                <span>方案：{captureProfileLabel(captureProfile)}</span>
                {isPrivateView ? (
                  <span style={{ color: "var(--sp-private)", fontWeight: 500 }}>
                    {isVaultUnlocked ? "私密状态：已解锁" : "私密状态：已锁定"}
                  </span>
                ) : (
                  <span>保存离线快照，排队同步云端</span>
                )}
              </div>
            </div>

            {/* 私密模式卡片（未启用 / 未解锁 / 已解锁） */}
            {isPrivateView && (
              <div className="sp-vault-card">
                <div className="sp-vault-header">
                  <div className="sp-vault-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <span>私密工作区</span>
                  </div>
                  {isVaultUnlocked && (
                    <button className="sp-btn-sm" onClick={lockPrivateVaultAction} style={{ padding: "3px 8px", minHeight: 24, fontSize: 11 }} type="button">
                      立即锁定
                    </button>
                  )}
                </div>

                {!isVaultEnabled ? (
                  /* 未启用私密模式 */
                  <div className="sp-vault-form">
                    <p style={{ margin: 0, color: "var(--sp-text-secondary)" }}>首次使用请设置私密密码，数据经端到端加密保护。</p>
                    <div className="sp-input-row">
                      <input
                        className="sp-input"
                        type="password"
                        placeholder="私密密码（至少 8 位）"
                        value={vaultPassphrase}
                        onChange={(e) => setVaultPassphrase(e.target.value)}
                      />
                      <input
                        className="sp-input"
                        type="password"
                        placeholder="确认密码"
                        value={vaultPassphraseConfirm}
                        onChange={(e) => setVaultPassphraseConfirm(e.target.value)}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <select
                        className="sp-select"
                        value={vaultAutoLock}
                        onChange={(e) => setVaultAutoLock(e.target.value as PrivateAutoLock)}
                      >
                        {AUTO_LOCK_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <button className="sp-btn-primary is-private" onClick={createPrivateVaultAction} style={{ minHeight: 34, padding: "6px 12px" }} type="button">
                        启用私密库
                      </button>
                    </div>
                  </div>
                ) : !isVaultUnlocked ? (
                  /* 已启用但锁定中 */
                  <div className="sp-vault-form">
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="sp-input"
                        type="password"
                        placeholder="输入私密密码解锁"
                        value={unlockPassphrase}
                        onChange={(e) => setUnlockPassphrase(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void unlockPrivateVaultAction()}
                      />
                      <button className="sp-btn-primary is-private" onClick={unlockPrivateVaultAction} style={{ minHeight: 34, padding: "6px 14px", flexShrink: 0 }} type="button">
                        解锁
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 已解锁状态 */
                  <div className="sp-vault-facts">
                    <span className="sp-vault-fact-pill">已保存: {vaultSummary?.totalItems ?? 0}</span>
                    <span className="sp-vault-fact-pill">待同步: {vaultSummary?.pendingSyncCount ?? 0}</span>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span>自动锁定:</span>
                      <select
                        className="sp-select"
                        style={{ height: 26, minHeight: 26, padding: "2px 6px" }}
                        value={vaultSummary?.autoLock ?? "15m"}
                        onChange={(e) => void changePrivateAutoLockAction(e.target.value as PrivateAutoLock)}
                      >
                        {AUTO_LOCK_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* 错误通知 */}
            {error && (
              <div className="sp-banner sp-banner-error" style={{ margin: "8px 14px 0" }}>
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* 窄屏下的视图切换 Tab（仅在宽度 < 840px 侧边栏生效） */}
            <div className="sp-view-nav">
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sp-text-secondary)" }}>
                {mobileView === "list" ? `队列记录 (${tasks.length})` : "归档预览与质量"}
              </span>
              <div className="sp-view-nav-tabs">
                <button
                  className={`sp-view-nav-tab ${mobileView === "list" ? "active" : ""}`}
                  onClick={() => setMobileView("list")}
                  type="button"
                >
                  列表
                </button>
                <button
                  className={`sp-view-nav-tab ${mobileView === "detail" ? "active" : ""}`}
                  onClick={() => setMobileView("detail")}
                  type="button"
                >
                  详情
                </button>
              </div>
            </div>

            {/* 工作区：双栏自适应 / 移动单栏 */}
            <div className={`sp-workspace ${mobileView === "detail" ? "show-detail" : "show-list"}`}>
              {/* 任务列表列 */}
              <section className="sp-list-column">
                <div className="sp-list-header">
                  <span>保存记录</span>
                  <span>{tasks.length} 条</span>
                </div>

                <div className="sp-list-items">
                  {tasks.length === 0 ? (
                    <div className="sp-empty-state">
                      <div className="sp-empty-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10 9 9 9 8 9"/>
                        </svg>
                      </div>
                      <p>
                        {isPrivateView
                          ? !isVaultEnabled
                            ? "启用私密模式后，新保存的私密条目会出现在这里。"
                            : "私密库中暂无保存记录。"
                          : authUser
                          ? "暂无归档。点击「保存当前页」即刻保存高质量网页快照。"
                          : "连接账号后，所有归档记录将在这里实时展示。"}
                      </p>
                    </div>
                  ) : (
                    tasks.map((task) => {
                      const active = task.id === selectedTaskId;
                      const lockedTask = isPrivateLockedView && task.isPrivate;
                      const isSelectionTask = task.source.captureScope === "selection";

                      return (
                        <button
                          className={`sp-task-card ${active ? "active" : ""} ${task.isPrivate ? "is-private" : ""}`}
                          key={task.id}
                          onClick={() => handleSelectTask(task.id)}
                          type="button"
                        >
                          <div className="sp-task-header">
                            <h3 className="sp-task-title">
                              {lockedTask ? "私密快照（已加密锁定）" : task.source.title || "未命名网页"}
                            </h3>
                          </div>

                          <div className="sp-task-meta">
                            <span className="sp-task-domain">
                              {lockedTask ? "安全保密域" : task.source.domain}
                            </span>
                            <span>•</span>
                            <span>{formatDateTime(task.updatedAt)}</span>
                          </div>

                          {!lockedTask && isSelectionTask && task.source.selectionText && (
                            <div className="sp-task-selection">
                              {task.source.selectionText}
                            </div>
                          )}

                          <div className="sp-task-badges">
                            <span className={`sp-badge sp-badge-${task.status}`}>
                              <span className="sp-badge-dot" />
                              {captureStatusLabel(task.status)}
                            </span>

                            {lockedTask ? (
                              <span className="sp-badge-grade" style={{ color: "var(--sp-private)" }}>已加密</span>
                            ) : task.quality ? (
                              <span className={`sp-badge-grade sp-badge-grade-${task.quality.grade}`}>
                                {qualityGradeLabel(task.quality.grade)} · {task.quality.score}分
                              </span>
                            ) : (
                              <span className="sp-badge-grade">评估中</span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              {/* 详情与预览列 */}
              <section className="sp-detail-column">
                {!selectedTask ? (
                  <div className="sp-empty-state">
                    <div className="sp-empty-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                    </div>
                    <p>在左侧选择一条记录，即可在此查看归档诊断、完整内容与离线预览。</p>
                  </div>
                ) : isPrivateLockedView && selectedTask.isPrivate ? (
                  /* 私密锁定时详情 */
                  <div className="sp-detail-content">
                    <div className="sp-detail-toolbar" style={{ borderLeft: "4px solid var(--sp-private)" }}>
                      <div className="sp-detail-main-info">
                        <h2 className="sp-detail-main-title">私密内容已锁定</h2>
                        <span style={{ fontSize: 12, color: "var(--sp-text-muted)" }}>
                          当前条目内容经过加密保护，请输入私密密码后解锁查看标题、诊断和离线预览。
                        </span>
                      </div>
                    </div>
                    <div className="sp-quality-card">
                      <div className="sp-quality-header">
                        <strong>状态信息</strong>
                        <span className="sp-badge sp-badge-default">{captureStatusLabel(selectedTask.status)}</span>
                      </div>
                      <p style={{ margin: "6px 0 0", color: "var(--sp-text-secondary)" }}>
                        模式：端到端加密保护 · 最近更新：{formatDateTime(selectedTask.updatedAt)}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* 正常详情与完整离线预览 */
                  <div className="sp-detail-content">
                    {/* 工具条 */}
                    <div className="sp-detail-toolbar">
                      <div className="sp-detail-main-info">
                        <h2 className="sp-detail-main-title">{selectedTask.source.title}</h2>
                        <a
                          className="sp-detail-url"
                          href={selectedTask.source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {selectedTask.source.url} ↗
                        </a>
                      </div>

                      <div className="sp-detail-actions">
                        <button
                          className="sp-btn-sm"
                          disabled={selectedTask.source.captureScope === "selection" && !canResumeSync}
                          onClick={retryCurrentTask}
                          type="button"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                          </svg>
                          {retryLabel}
                        </button>

                        <button className="sp-btn-sm" onClick={openPreviewInNewTab} type="button">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                          新标签打开
                        </button>
                      </div>
                    </div>

                    {/* 选区摘要（如有） */}
                    {selectedTask.source.captureScope === "selection" && selectedTask.source.selectionText && (
                      <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--sp-border)", fontSize: 12 }}>
                        <strong style={{ color: "var(--sp-text-primary)", display: "block", marginBottom: 4 }}>选区内容：</strong>
                        <div style={{ color: "var(--sp-text-secondary)", lineHeight: 1.5 }}>{selectedTask.source.selectionText}</div>
                      </div>
                    )}

                    {/* 质量诊断卡片 */}
                    <div className="sp-quality-card">
                      <div className="sp-quality-header">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <strong>归档质量评分：</strong>
                          {selectedTask.quality ? (
                            <span className={`sp-badge-grade sp-badge-grade-${selectedTask.quality.grade}`}>
                              {qualityGradeLabel(selectedTask.quality.grade)} · {selectedTask.quality.score} 分
                            </span>
                          ) : (
                            <span className="sp-badge-grade">待评估</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span className="sp-badge sp-badge-default">{captureScopeLabel(selectedTask.source.captureScope)}</span>
                          <span className={`sp-badge sp-badge-${selectedTask.status}`}>{captureStatusLabel(selectedTask.status)}</span>
                        </div>
                      </div>

                      {selectedTask.quality?.reasons && selectedTask.quality.reasons.length > 0 && (
                        <div className="sp-quality-reasons">
                          {selectedTask.quality.reasons.slice(0, 3).map((reason) => (
                            <div className="sp-reason-item" key={reason.code}>
                              <div className="sp-reason-dot" />
                              <span>{reason.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {selectedTask.failureReason && (
                        <div style={{ color: "var(--sp-danger)", fontSize: 12, marginTop: 4 }}>
                          失败原因：{selectedTask.failureReason}
                        </div>
                      )}
                    </div>

                    {/* 模拟浏览器内嵌离线预览容器 */}
                    <div className="sp-preview-box">
                      <div className="sp-preview-bar">
                        <div className="sp-preview-dots">
                          <div className="sp-preview-dot" />
                          <div className="sp-preview-dot" />
                          <div className="sp-preview-dot" />
                        </div>
                        <span className="sp-preview-title">
                          离线沙箱快照预览 · {selectedTask.source.title}
                        </span>
                      </div>

                      {selectedTask.artifacts?.archiveHtml ? (
                        <iframe
                          className="sp-preview-iframe"
                          sandbox="allow-same-origin"
                          srcDoc={ensureArchiveBaseHref(
                            selectedTask.artifacts.archiveHtml,
                            selectedTask.source.canonicalUrl ?? selectedTask.source.url,
                          )}
                          title="archive-preview"
                        />
                      ) : (
                        <div className="sp-preview-empty">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                          </svg>
                          <span>正在生成网页完整快照，完成后即可在此直接预览...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function parseSaveModeIntent(input: unknown): SaveMode | null {
  return input === "standard" || input === "private" ? input : null;
}

function parseSidePanelNotice(input: unknown): { message: string; saveMode: SaveMode } | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const saveMode = parseSaveModeIntent(record.saveMode);
  if (
    typeof record.message !== "string" ||
    !saveMode ||
    typeof record.createdAt !== "number" ||
    Date.now() - record.createdAt > SIDE_PANEL_NOTICE_TTL_MS
  ) {
    return null;
  }
  return { message: record.message, saveMode };
}

async function resolveInitialSaveMode(
  preferredSaveMode: string | undefined,
  incognitoPrivateDefault: boolean,
): Promise<SaveMode> {
  if (preferredSaveMode === "standard" || preferredSaveMode === "private") {
    return preferredSaveMode;
  }
  if (!incognitoPrivateDefault) {
    return "standard";
  }
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return activeTab?.incognito ? "private" : "standard";
  } catch {
    return "standard";
  }
}

function formatDateTime(input: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(input));
  } catch {
    return input;
  }
}
