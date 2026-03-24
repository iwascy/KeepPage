import { useEffect, useMemo, useState } from "react";
import type {
  AuthUser,
  CaptureProfile,
  CaptureTask,
  PrivateAutoLock,
  PrivateVaultSummary,
  QualityGrade,
  SaveMode,
} from "@keeppage/domain";
import {
  MESSAGE_TYPE,
  type PrivateVaultStateResponse,
  type TaskUpdatedEvent,
} from "../../src/lib/messages";
import { getStoredAuthToken, getStoredAuthUser } from "../../src/lib/auth-storage";
import {
  authSessionSchema,
  authUserSchema,
  ensureArchiveBaseHref,
} from "../../src/lib/domain-runtime";
import {
  openExtensionAuthPage,
  openSidePanelForCurrentWindow,
} from "../../src/lib/auth-flow";

type AsyncState = "idle" | "capturing" | "error";
type SettingsState = "idle" | "saving" | "saved" | "error";
type ConnectionState = "idle" | "testing" | "ok" | "error";
type AuthState = "idle" | "submitting" | "ok" | "error";
type AuthMode = "login" | "register";

const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const PROFILE_OPTIONS: Array<{
  value: CaptureProfile;
  label: string;
  description: string;
}> = [
  {
    value: "standard",
    label: "标准保真",
    description: "默认方案，平衡质量与体积。",
  },
  {
    value: "complete",
    label: "完整保留",
    description: "尽量少裁剪，适合复杂页面。",
  },
  {
    value: "dynamic",
    label: "动态增强",
    description: "更适合延迟内容和 SPA。",
  },
  {
    value: "lightweight",
    label: "轻量快照",
    description: "更快更小，优先搜索和快速归档。",
  },
];
const SAVE_MODE_OPTIONS: Array<{ value: SaveMode; label: string }> = [
  {
    value: "standard",
    label: "普通",
  },
  {
    value: "private",
    label: "私密",
  },
];
const AUTO_LOCK_OPTIONS: Array<{ value: PrivateAutoLock; label: string }> = [
  { value: "5m", label: "5 分钟" },
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "browser", label: "浏览器关闭后" },
];

const AUTH_PAGE_VIEW = new URLSearchParams(window.location.search).get("view") === "auth";
const AUTH_PAGE_REASON = new URLSearchParams(window.location.search).get("reason");

function captureStatusLabel(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "capturing":
      return "抓取中";
    case "validating":
      return "校验中";
    case "local_ready":
      return "本地就绪";
    case "upload_pending":
      return "等待同步";
    case "uploading":
      return "同步中";
    case "uploaded":
      return "已上传";
    case "indexed":
      return "建索引中";
    case "synced":
      return "已入库";
    case "failed":
      return "失败";
  }
}

function captureProfileLabel(profile: CaptureProfile) {
  return PROFILE_OPTIONS.find((option) => option.value === profile)?.label ?? profile;
}

function captureScopeLabel(scope: CaptureTask["source"]["captureScope"]) {
  return scope === "selection" ? "选中区域" : "整页";
}

function privateSyncStateLabel(syncState?: CaptureTask["syncState"]) {
  switch (syncState) {
    case "local-only":
      return "仅本机";
    case "sync-disabled":
      return "未启用同步";
    case "sync-pending":
      return "等待同步";
    case "sync-failed":
      return "同步失败";
    default:
      return null;
  }
}

function qualityGradeLabel(grade?: QualityGrade) {
  switch (grade) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "待评估";
  }
}

function privateModeLabel(mode?: CaptureTask["privateMode"]) {
  switch (mode) {
    case "encrypted-sync":
      return "端到端同步";
    case "local-only":
    default:
      return "本机私密";
  }
}

export function App() {
  const [tasks, setTasks] = useState<CaptureTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [state, setState] = useState<AsyncState>("idle");
  const [saveMode, setSaveMode] = useState<SaveMode>("standard");
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>("standard");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [incognitoPrivateDefault, setIncognitoPrivateDefault] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState>("idle");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [vaultSummary, setVaultSummary] = useState<PrivateVaultSummary | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [vaultAutoLock, setVaultAutoLock] = useState<PrivateAutoLock>("15m");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (areaName !== "local" || (!changes.authToken && !changes.authUser)) {
        return;
      }

      void syncAuthStateFromStorage();
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [saveMode]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedProfileMeta = PROFILE_OPTIONS.find((option) => option.value === captureProfile);
  const authBannerTone = authState === "ok" ? "ok" : authState;
  const isRegister = authMode === "register";
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
    : "按当前 Profile 重抓";
  const primaryActionLabel = useMemo(() => {
    if (!authUser) {
      return "去登录";
    }
    if (state === "capturing") {
      return isPrivateView ? "私密保存中..." : "保存中...";
    }
    if (isPrivateView && !isVaultEnabled) {
      return "先启用私密库";
    }
    if (isPrivateView && !isVaultUnlocked) {
      return "先解锁私密库";
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
      setAuthMessage("登录已失效或已退出，请重新登录后再继续保存。");
      return;
    }

    setAuthUser(user);
    setAuthState("ok");
    setAuthMessage(`已登录 ${user.email}，现在可以继续使用扩展。`);
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
      setError(response?.error ?? "加载私密库状态失败。");
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
      setAuthMessage("请先完成登录，登录成功后就可以开始使用扩展。");
      await openExtensionAuthPage("capture-button");
      return false;
    }
    if (isPrivateView && !isVaultEnabled) {
      setError("请先启用私密库，再进行私密保存。");
      return false;
    }
    if (isPrivateView && !isVaultUnlocked) {
      setError("私密库当前已锁定，请先解锁。");
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
      setError("私密口令至少需要 8 位。");
      return;
    }
    if (vaultPassphrase !== vaultPassphraseConfirm) {
      setError("两次输入的私密口令不一致。");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.CreatePrivateVault,
      passphrase: vaultPassphrase,
      autoLock: vaultAutoLock,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "启用私密库失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    setRecoveryCode(response.recoveryCode ?? null);
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
      setError(response?.error ?? "解锁私密库失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    setUnlockPassphrase("");
    await refreshTasks("private");
  }

  async function lockPrivateVaultAction() {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.LockPrivateVault,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "锁定私密库失败。");
      return;
    }
    setVaultSummary(response.summary ?? null);
    await refreshTasks("private");
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get([
      "apiBaseUrl",
      "captureProfilePreference",
      "saveModePreference",
      "incognitoPrivateDefault",
      "debugMode",
      "authToken",
      "authUser",
    ]);
    const normalizedApiBaseUrl = typeof result.apiBaseUrl === "string" && result.apiBaseUrl.trim()
      ? normalizeApiBaseUrl(result.apiBaseUrl)
      : DEFAULT_API_BASE_URL;
    setApiBaseUrl(normalizedApiBaseUrl);

    if (typeof result.captureProfilePreference === "string") {
      const matched = PROFILE_OPTIONS.find(
        (option) => option.value === result.captureProfilePreference,
      );
      if (matched) {
        setCaptureProfile(matched.value);
      }
    }

    const nextIncognitoPrivateDefault = result.incognitoPrivateDefault !== false;
    setIncognitoPrivateDefault(nextIncognitoPrivateDefault);
    setDebugMode(result.debugMode === true);
    const detectedInitialSaveMode = await resolveInitialSaveMode(
      typeof result.saveModePreference === "string" ? result.saveModePreference : undefined,
      nextIncognitoPrivateDefault,
    );
    setSaveMode(detectedInitialSaveMode);

    const storedToken = typeof result.authToken === "string" ? result.authToken.trim() : "";
    if (!storedToken) {
      setTasks([]);
      setSelectedTaskId(null);
      if (AUTH_PAGE_VIEW) {
        setAuthState("idle");
        setAuthMessage("请先登录 KeepPage，完成后就可以直接使用扩展。");
      }
      return;
    }

    const parsedUser = await getStoredAuthUser();
    if (parsedUser) {
      setAuthUser(parsedUser);
    }

    try {
      const user = await fetchCurrentAccount(normalizedApiBaseUrl, storedToken);
      setAuthUser(user);
      await chrome.storage.local.set({ authUser: user });
      setAuthState("ok");
      setAuthMessage(`已登录 ${user.email}，后续同步将归到这个账号。`);
      await refreshTasks(detectedInitialSaveMode);
    } catch (loadError) {
      await chrome.storage.local.remove(["authToken", "authUser"]);
      setAuthUser(null);
      setTasks([]);
      setSelectedTaskId(null);
      setAuthState("error");
      setAuthMessage(
        loadError instanceof Error ? loadError.message : "已保存的登录状态失效，请重新登录。",
      );
    }
  }

  async function saveSettings() {
    setSettingsState("saving");
    setSettingsMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      await chrome.storage.local.set({
        apiBaseUrl: normalizedApiBaseUrl,
        captureProfilePreference: captureProfile,
        saveModePreference: saveMode,
        incognitoPrivateDefault,
        debugMode,
      });
      setApiBaseUrl(normalizedApiBaseUrl);
      setSettingsState("saved");
      setSettingsMessage("已保存扩展侧设置。后续保存和同步会立即使用新配置。");
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

  async function submitAuth() {
    setAuthState("submitting");
    setAuthMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      const session = await authenticateAccount(normalizedApiBaseUrl, authMode, {
        email: authEmail.trim(),
        password: authPassword,
        name: authName.trim() || undefined,
      });
      await chrome.storage.local.set({
        authToken: session.token,
        authUser: session.user,
      });
      setAuthUser(session.user);
      setAuthPassword("");
      setAuthState("ok");
      const sidePanelOpened = AUTH_PAGE_VIEW
        ? await openSidePanelForCurrentWindow()
        : false;
      setAuthMessage(
        sidePanelOpened
          ? `已登录 ${session.user.email}，侧边栏已打开，现在可以直接保存当前页面。`
          : `已登录 ${session.user.email}，新的保存会同步到这个账号。`,
      );
      setConnectionState("idle");
      setConnectionMessage(null);
      await refreshTasks(saveMode);
    } catch (authError) {
      setAuthState("error");
      setAuthMessage(
        authError instanceof Error ? authError.message : "登录失败。",
      );
    }
  }

  async function logoutAuth() {
    await chrome.storage.local.remove(["authToken", "authUser"]);
    setAuthUser(null);
    setTasks([]);
    setSelectedTaskId(null);
    setAuthState("idle");
    setAuthMessage("已退出当前账号。要继续保存网页，请先重新登录。");
    setConnectionState("idle");
    setConnectionMessage(null);
  }

  async function testConnection() {
    setConnectionState("testing");
    setConnectionMessage(null);
    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
      const token = await getStoredAuthToken();
      if (!token) {
        throw new Error("请先登录账号，再测试同步连接。");
      }
      const user = await fetchCurrentAccount(normalizedApiBaseUrl, token);
      setAuthUser(user);
      await chrome.storage.local.set({ authUser: user });
      setConnectionState("ok");
      setConnectionMessage(`连接正常，当前账号 ${user.email}。`);
    } catch (testError) {
      setConnectionState("error");
      setConnectionMessage(
        testError instanceof Error ? testError.message : "无法连接到同步服务。",
      );
    }
  }

  if (AUTH_PAGE_VIEW) {
    const authPageTitle = authUser ? "KeepPage 已连接" : "登录 KeepPage";
    const authPageSubtitle = authUser
      ? "当前浏览器已经绑定账号，可以回到侧边栏继续保存网页。"
      : AUTH_PAGE_REASON === "session-expired"
      ? "登录状态已失效，请重新登录后继续使用扩展。"
      : "完成登录后，扩展会自动回到侧边栏，你就可以直接保存当前页面。";

    return (
      <div className="auth-page">
        <main className="auth-page-shell">
          <section className="auth-page-hero">
            <p className="eyebrow">KeepPage 队列</p>
            <h1>{authPageTitle}</h1>
            <p className="auth-page-subtitle">{authPageSubtitle}</p>
          </section>

          <section className="auth-page-card">
            <div className="auth-page-card-header">
              <div>
                <p className="settings-title">账号</p>
                <p className="muted">
                  {authUser
                    ? "当前扩展会把后续归档同步到这个账号。"
                    : "登录后，扩展中的新归档任务会自动归到当前账号。"}
                </p>
              </div>
            </div>

            {authUser ? (
              <div className="auth-page-account">
                <div className="account-chip">
                  <strong>{authUser.name || authUser.email}</strong>
                  <span>{authUser.email}</span>
                </div>
                <div className="auth-page-actions">
                  <button onClick={() => void openSidePanelForCurrentWindow()} type="button">
                    打开侧边栏
                  </button>
                  <button className="ghost-btn" onClick={logoutAuth} type="button">
                    退出登录
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="auth-page-form">
                  <div className="auth-switch">
                    <button
                      className={authMode === "login" ? "auth-switch-btn active" : "auth-switch-btn"}
                      onClick={() => setAuthMode("login")}
                      type="button"
                    >
                      登录
                    </button>
                    <button
                      className={authMode === "register" ? "auth-switch-btn active" : "auth-switch-btn"}
                      onClick={() => setAuthMode("register")}
                      type="button"
                    >
                      注册
                    </button>
                  </div>
                  {isRegister ? (
                    <label className="field-inline">
                      <span>昵称</span>
                      <input
                        value={authName}
                        onChange={(event) => setAuthName(event.target.value)}
                        placeholder="可选"
                      />
                    </label>
                  ) : null}
                  <label className="field-inline">
                    <span>邮箱</span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label className="field-inline">
                    <span>密码</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder={isRegister ? "至少 8 位" : "输入密码"}
                    />
                  </label>
                </div>
                <div className="auth-page-actions">
                  <button onClick={submitAuth} type="button">
                    {authState === "submitting" ? "提交中..." : isRegister ? "注册并登录" : "登录"}
                  </button>
                </div>
              </>
            )}

            {authMessage ? (
              <section className={`settings-banner settings-${authBannerTone}`}>{authMessage}</section>
            ) : null}

            <div className="auth-page-settings">
              <div className="settings-copy">
                <p className="settings-title">连接设置</p>
                <p className="muted">如果你使用自部署服务，可以在这里修改 API 地址。</p>
              </div>
              <div className="settings-fields">
                <label className="field-inline">
                  <span>API 地址</span>
                  <input
                    value={apiBaseUrl}
                    onChange={(event) => setApiBaseUrl(event.target.value)}
                    placeholder={DEFAULT_API_BASE_URL}
                    spellCheck={false}
                  />
                </label>
                <label className="toggle-inline">
                  <input
                    checked={incognitoPrivateDefault}
                    onChange={(event) => setIncognitoPrivateDefault(event.target.checked)}
                    type="checkbox"
                  />
                  <span>无痕窗口默认私密</span>
                </label>
                <label className="toggle-inline">
                  <input
                    checked={debugMode}
                    onChange={(event) => setDebugMode(event.target.checked)}
                    type="checkbox"
                  />
                  <span>开启调试模式（打印详细日志）</span>
                </label>
              </div>
              <div className="auth-page-actions auth-page-actions-wrap">
                <button onClick={saveSettings} type="button">
                  {settingsState === "saving" ? "保存中..." : "保存设置"}
                </button>
                <button className="ghost-btn" onClick={testConnection} type="button">
                  {connectionState === "testing" ? "测试中..." : "测试连接"}
                </button>
                <button className="ghost-btn" onClick={resetApiBaseUrl} type="button">
                  恢复默认
                </button>
              </div>
            </div>

            {settingsMessage ? (
              <section className={`settings-banner settings-${settingsState}`}>{settingsMessage}</section>
            ) : null}
            {connectionMessage ? (
              <section className={`settings-banner settings-${connectionState}`}>{connectionMessage}</section>
            ) : null}
          </section>
        </main>

        {error && <footer className="error-banner">{error}</footer>}
      </div>
    );
  }

  return (
    <div className="layout">
      <header className="header">
        <div className="header-copy">
          <p className="eyebrow">KeepPage 队列</p>
          <h1>{isPrivateView ? "私密归档队列" : "本地归档队列"}</h1>
          <p className="header-subtitle">
            {isPrivateView
              ? "私密任务会先在当前设备加密写入本地库，锁定状态下不展示标题、URL 与质量详情。"
              : "先拿到本地可预览归档，再异步上传、去重和建索引。"}
          </p>
        </div>
        <div className="header-actions">
          <label className="compact-field">
            <span>保存模式</span>
            <select
              value={saveMode}
              onChange={(event) => setSaveMode(event.target.value as SaveMode)}
            >
              {SAVE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            <span>抓取 profile</span>
            <select
              value={captureProfile}
              onChange={(event) => setCaptureProfile(event.target.value as CaptureProfile)}
            >
              {PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="capture-actions">
            <div className="capture-action-row">
              <button className="ghost-btn" onClick={startSelectionCaptureAction} type="button">
                选择区域保存
              </button>
              <button
                className={`capture-btn ${isPrivateView ? "capture-btn-private" : ""}`}
                disabled={state === "capturing"}
                onClick={handlePrimaryAction}
                type="button"
              >
                {primaryActionLabel}
              </button>
            </div>
            <p className="capture-helper">
              只想存正文或局部区域时，点左侧按钮后回到页面点击目标内容。
            </p>
          </div>
        </div>
      </header>

      {isPrivateView && (
        <section className="private-strip">
          <div className="settings-copy">
            <p className="settings-title">私密库状态</p>
            <p className="muted">
              {!isVaultEnabled
                ? "首次启用后，私密归档会以加密形式保存在当前浏览器设备。"
                : isVaultUnlocked
                ? "当前设备已解锁私密库，可以查看标题、质量信息和本地预览。"
                : "私密库当前已锁定，只会暴露最小摘要信息。"}
            </p>
            {vaultSummary ? (
              <div className="vault-facts">
                <span>条目数：{vaultSummary.totalItems}</span>
                <span>待同步：{vaultSummary.pendingSyncCount}</span>
                <span>自动锁定：{renderAutoLockLabel(vaultSummary.autoLock)}</span>
              </div>
            ) : null}
          </div>

          {!isVaultEnabled ? (
            <>
              <div className="vault-form">
                <label className="field-inline">
                  <span>私密口令</span>
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(event) => setVaultPassphrase(event.target.value)}
                    placeholder="至少 8 位"
                  />
                </label>
                <label className="field-inline">
                  <span>确认口令</span>
                  <input
                    type="password"
                    value={vaultPassphraseConfirm}
                    onChange={(event) => setVaultPassphraseConfirm(event.target.value)}
                    placeholder="再次输入"
                  />
                </label>
                <label className="field-inline">
                  <span>自动锁定</span>
                  <select
                    value={vaultAutoLock}
                    onChange={(event) => setVaultAutoLock(event.target.value as PrivateAutoLock)}
                  >
                    {AUTO_LOCK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="settings-actions">
                <button onClick={createPrivateVaultAction} type="button">
                  启用私密库
                </button>
              </div>
            </>
          ) : isVaultUnlocked ? (
            <>
              <div className="vault-summary-card">
                <strong>私密库已解锁</strong>
                <span>
                  当前会话可以查看私密标题、预览和质量提示。手动锁定或超时后需要重新输入口令。
                </span>
              </div>
              <div className="settings-actions">
                <button className="ghost-btn" onClick={lockPrivateVaultAction} type="button">
                  立即锁定
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="vault-form">
                <label className="field-inline">
                  <span>解锁口令</span>
                  <input
                    type="password"
                    value={unlockPassphrase}
                    onChange={(event) => setUnlockPassphrase(event.target.value)}
                    placeholder="输入私密口令"
                  />
                </label>
              </div>
              <div className="settings-actions">
                <button onClick={unlockPrivateVaultAction} type="button">
                  解锁私密库
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {recoveryCode && (
        <section className="settings-banner settings-ok">
          恢复码已生成，请尽快另存到安全位置：<strong>{recoveryCode}</strong>
        </section>
      )}

      <section className="account-strip">
        <div className="settings-copy">
          <p className="settings-title">账号状态</p>
          <p className="muted">
            {authUser
              ? isPrivateView
                ? "当前版本的私密保存仍绑定到当前账号，但内容只保存在本机私密库。"
                : "当前扩展会把新归档同步到这个账号。"
              : "请先注册或登录账号，新的本地归档任务也会绑定到当前账号。"}
          </p>
        </div>

        {authUser ? (
          <div className="account-summary">
            <div className="account-chip">
              <strong>{authUser.name || authUser.email}</strong>
              <span>{authUser.email}</span>
            </div>
            <button className="ghost-btn" onClick={logoutAuth} type="button">
              退出登录
            </button>
          </div>
        ) : (
          <>
            <div className="account-form">
              <div className="auth-switch">
                <button
                  className={authMode === "login" ? "auth-switch-btn active" : "auth-switch-btn"}
                  onClick={() => setAuthMode("login")}
                  type="button"
                >
                  登录
                </button>
                <button
                  className={authMode === "register" ? "auth-switch-btn active" : "auth-switch-btn"}
                  onClick={() => setAuthMode("register")}
                  type="button"
                >
                  注册
                </button>
              </div>
              {isRegister ? (
                <label className="field-inline">
                  <span>昵称</span>
                  <input
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="可选"
                  />
                </label>
              ) : null}
              <label className="field-inline">
                <span>邮箱</span>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <label className="field-inline">
                <span>密码</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder={isRegister ? "至少 8 位" : "输入密码"}
                />
              </label>
            </div>
            <div className="settings-actions">
              <button onClick={submitAuth} type="button">
                {authState === "submitting" ? "提交中..." : isRegister ? "注册并登录" : "登录"}
              </button>
            </div>
          </>
        )}
      </section>
      {authMessage && (
        <section className={`settings-banner settings-${authBannerTone}`}>{authMessage}</section>
      )}

      <section className="settings-strip">
        <div className="settings-copy">
          <p className="settings-title">同步与默认规则</p>
          <p className="muted">
            当前保存会使用 <strong>{selectedProfileMeta?.label ?? "标准保真"}</strong>。
            {selectedProfileMeta?.description ? ` ${selectedProfileMeta.description}` : ""}
          </p>
        </div>
        <div className="settings-fields">
          <label className="field-inline">
            <span>API 地址</span>
            <input
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder={DEFAULT_API_BASE_URL}
              spellCheck={false}
            />
          </label>
          <label className="toggle-inline">
            <input
              checked={incognitoPrivateDefault}
              onChange={(event) => setIncognitoPrivateDefault(event.target.checked)}
              type="checkbox"
            />
            <span>无痕窗口默认私密</span>
          </label>
          <label className="toggle-inline">
            <input
              checked={debugMode}
              onChange={(event) => setDebugMode(event.target.checked)}
              type="checkbox"
            />
            <span>开启调试模式（打印详细日志）</span>
          </label>
        </div>
        <div className="settings-actions">
          <button onClick={saveSettings} type="button">
            {settingsState === "saving" ? "保存中..." : "保存设置"}
          </button>
          <button className="ghost-btn" onClick={testConnection} type="button">
            {connectionState === "testing" ? "测试中..." : "测试连接"}
          </button>
          <button className="ghost-btn" onClick={resetApiBaseUrl} type="button">
            恢复默认
          </button>
        </div>
      </section>
      {settingsMessage && (
        <section className={`settings-banner settings-${settingsState}`}>{settingsMessage}</section>
      )}
      {connectionMessage && (
        <section className={`settings-banner settings-${connectionState}`}>{connectionMessage}</section>
      )}

      <main className="main">
        <section className="task-list">
          {tasks.length === 0 && (
            <p className="muted">
              {isPrivateView
                ? !isVaultEnabled
                  ? "启用私密库后，新的私密保存记录会出现在这里。"
                  : "当前私密库还没有保存记录。"
                : authUser
                ? "当前账号还没有保存记录。点击「保存当前页」，先生成本地归档，再异步进入上传队列。"
                : "登录后，这里只会显示当前账号的本地保存记录。"}
            </p>
          )}
          {tasks.map((task) => {
            const active = task.id === selectedTaskId;
            const lockedTask = isPrivateLockedView && task.isPrivate;
            const isSelectionTask = task.source.captureScope === "selection";
            return (
              <button
                className={`task-card ${active ? "active" : ""} ${task.isPrivate ? "task-card-private" : ""}`}
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                type="button"
              >
                <p className="task-title">{lockedTask ? "私密条目（已锁定）" : task.source.title}</p>
                <p className="task-url">
                  {lockedTask ? "已锁定" : `${task.source.domain}${isSelectionTask ? " · 选中区域" : ""}`}
                </p>
                {!lockedTask && isSelectionTask && task.source.selectionText ? (
                  <p className="task-selection">{task.source.selectionText}</p>
                ) : null}
                <div className="task-meta">
                  <span className={`status status-${task.status}`}>{captureStatusLabel(task.status)}</span>
                  {lockedTask ? (
                    <span className="grade grade-private">已锁定</span>
                  ) : (
                    <span className={`grade grade-${task.quality?.grade ?? "none"}`}>
                      {task.quality
                        ? `${qualityGradeLabel(task.quality.grade)} · ${task.quality.score} 分`
                        : "待评估"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </section>

        <section className="preview-panel">
          {!selectedTask && (
            <p className="muted">
              {isPrivateView
                ? "选择左侧私密记录以查看锁定态摘要或解锁态详情。"
                : "选择左侧记录以查看质量诊断和本地预览。"}
            </p>
          )}

          {selectedTask && isPrivateLockedView && (
            <div className="vault-locked-panel">
              <h2>私密库已锁定</h2>
              <p className="muted">
                当前只展示最小摘要信息。输入私密口令解锁后，才能查看标题、域名、质量诊断和本地预览。
              </p>
              <div className="task-facts">
                <span>状态：{captureStatusLabel(selectedTask.status)}</span>
                <span>模式：本机私密</span>
                {vaultSummary?.lastUpdatedAt ? (
                  <span>最近更新：{formatDateTime(vaultSummary.lastUpdatedAt)}</span>
                ) : null}
              </div>
            </div>
          )}

          {selectedTask && !isPrivateLockedView && (
            <>
              <div className="preview-toolbar">
                <h2>{selectedTask.source.title}</h2>
                <div className="actions">
                  <button
                    disabled={selectedTask.source.captureScope === "selection" && !canResumeSync}
                    onClick={retryCurrentTask}
                    type="button"
                  >
                    {retryLabel}
                  </button>
                  <button onClick={openPreviewInNewTab} type="button">
                    新标签预览
                  </button>
                  {isPrivateView && (
                    <button className="ghost-btn" onClick={lockPrivateVaultAction} type="button">
                      锁定私密库
                    </button>
                  )}
                </div>
              </div>
              <p className="muted">{selectedTask.source.url}</p>
              {selectedTask.source.captureScope === "selection" && selectedTask.source.selectionText ? (
                <p className="selection-summary">选区摘要：{selectedTask.source.selectionText}</p>
              ) : null}
              <div className="task-facts">
                {selectedTask.owner ? <span>账号：{selectedTask.owner.email}</span> : null}
                <span>状态：{captureStatusLabel(selectedTask.status)}</span>
                <span>抓取配置：{captureProfileLabel(selectedTask.profile)}</span>
                <span>范围：{captureScopeLabel(selectedTask.source.captureScope)}</span>
                {selectedTask.isPrivate ? <span>私密模式：{privateModeLabel(selectedTask.privateMode)}</span> : null}
                {privateSyncStateLabel(selectedTask.syncState) ? (
                  <span>同步状态：{privateSyncStateLabel(selectedTask.syncState)}</span>
                ) : null}
                {selectedTask.bookmarkId && <span>书签记录：{selectedTask.bookmarkId}</span>}
              </div>
              <div className="quality-box">
                <p>
                  归档质量：
                  {" "}
                  <strong>
                    {selectedTask.quality
                      ? `${qualityGradeLabel(selectedTask.quality.grade)} · ${selectedTask.quality.score} 分`
                      : "待评估"}
                  </strong>
                </p>
                {(selectedTask.quality?.reasons ?? []).slice(0, 3).map((reason) => (
                  <p className="reason" key={reason.code}>
                    {reason.message}
                  </p>
                ))}
                {!selectedTask.quality && !selectedTask.failureReason ? (
                  <p className="reason">当前任务还没有生成质量诊断，稍后会补充评分与原因。</p>
                ) : null}
                {selectedTask.failureReason && (
                  <p className="reason error">{selectedTask.failureReason}</p>
                )}
              </div>
              <div className="preview-frame-wrap">
                {selectedTask.artifacts?.archiveHtml ? (
                  <iframe
                    className="preview-frame"
                    sandbox="allow-same-origin"
                    srcDoc={ensureArchiveBaseHref(
                      selectedTask.artifacts.archiveHtml,
                      selectedTask.source.canonicalUrl ?? selectedTask.source.url,
                    )}
                    title="archive-preview"
                  />
                ) : (
                  <div className="preview-placeholder">
                    <p>本地预览占位</p>
                    <p>归档 HTML 生成后会在这里直接渲染。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      {error && <footer className="error-banner">{error}</footer>}
    </div>
  );
}

function normalizeApiBaseUrl(input: string) {
  const normalized = input.trim();
  return (normalized || DEFAULT_API_BASE_URL).replace(/\/$/, "");
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

function renderAutoLockLabel(autoLock: PrivateAutoLock) {
  return AUTO_LOCK_OPTIONS.find((option) => option.value === autoLock)?.label ?? autoLock;
}

function formatDateTime(input: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

async function authenticateAccount(
  apiBaseUrl: string,
  mode: AuthMode,
  payload: {
    email: string;
    password: string;
    name?: string;
  },
) {
  const response = await fetch(`${apiBaseUrl}/auth/${mode === "register" ? "register" : "login"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return authSessionSchema.parse(await response.json());
}

async function fetchCurrentAccount(apiBaseUrl: string, authToken: string) {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return authUserSchema.parse(await response.json());
}

async function readApiErrorMessage(response: Response) {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message ?? `API ${response.status}`;
  } catch {
    const text = await response.text();
    return text || `API ${response.status}`;
  }
}
