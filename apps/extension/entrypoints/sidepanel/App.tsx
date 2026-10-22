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
import {
  clearStoredAuthSession,
  normalizeApiBaseUrl,
  openExtensionAuthPage,
  openSidePanelForCurrentWindow,
  validateStoredAuthSession,
} from "../../src/lib/auth-flow";
import { BrandMark } from "../../src/lib/ui-shared/brand-mark";
import { CapturePanel } from "./components/CapturePanel";
import { Notice } from "./components/common";
import { Header, PrivateStrip } from "./components/Header";
import { AccountBlock, ServerBlock, SettingsSection, type Feedback } from "./components/settings-sections";
import { SettingsView } from "./components/SettingsView";
import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";
import { VaultPanel } from "./components/VaultPanel";
import { useActiveTab } from "./use-active-tab";

type AsyncState = "idle" | "capturing" | "error";
type SettingsState = "idle" | "saving" | "saved" | "error";
type IconRefreshState = "idle" | "refreshing" | "saved" | "error";
type ConnectionState = "idle" | "testing" | "ok" | "error";
type AuthState = "idle" | "submitting" | "ok" | "error";
type PanelView = "queue" | "detail" | "settings";

const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const LOCKED_CAPTURE_PROFILE: CaptureProfile = "complete";
const SIDE_PANEL_SAVE_MODE_INTENT_KEY = "sidePanelSaveModeIntent";
const SIDE_PANEL_NOTICE_KEY = "sidePanelNotice";
const SIDE_PANEL_NOTICE_TTL_MS = 2 * 60 * 1000;

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
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("queue");
  const activeTab = useActiveTab(!AUTH_PAGE_VIEW);

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
    ? "重新保存"
    : canResumeSync && selectedTask?.profile === captureProfile
    ? "继续同步"
    : selectedTask?.source.captureScope === "selection"
    ? "回到页面重新框选"
    : "重新保存";

  const primaryActionLabel = useMemo(() => {
    if (!authUser) {
      return "连接账号后保存";
    }
    if (state === "capturing") {
      return "保存中…";
    }
    return isPrivateView ? "私密保存此页" : "保存此页";
  }, [authUser, state, isPrivateView, isVaultEnabled, isVaultUnlocked]);

  async function syncAuthStateFromStorage() {
    const [token, user] = await Promise.all([
      getStoredAuthToken(),
      getStoredAuthUser(),
    ]);

    if (!token) {
      setAuthUser(null);
      setTasks([]);
      setSelectedTaskId(null);
      setAuthState("idle");
      setAuthMessage("插件设备未连接或已退出，请通过网页连接后再继续保存。");
      return;
    }

    if (!user) {
      // The device token is present but the cached profile is missing (legacy
      // record or schema change). Restore it from /auth/me instead of asking the
      // user to authorize this browser again.
      const session = await validateStoredAuthSession();
      if (session.ok) {
        setAuthUser(session.user);
        setAuthState("ok");
        setAuthMessage(`已连接 ${session.user.email}，现在可以继续使用扩展。`);
        await refreshTasks(saveMode);
        return;
      }
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

  async function refreshPrivateVaultState(silent = false) {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.GetPrivateVaultState,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      if (!silent) {
        setError(response?.error ?? "加载私密模式状态失败。");
      }
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
      if (saveMode === "private") {
        // The underlying private session may have been cleared by the failure;
        // refresh silently so the vault card switches back to the unlock form.
        void refreshPrivateVaultState(true);
      }
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

  async function createPrivateVaultAction(passphrase: string, confirm: string, autoLock: PrivateAutoLock) {
    setError(null);
    if (passphrase.trim().length < 8) {
      setError("私密密码至少需要 8 位。");
      return false;
    }
    if (passphrase !== confirm) {
      setError("两次输入的私密密码不一致。");
      return false;
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.CreatePrivateVault,
      passphrase,
      autoLock,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "启用私密模式失败。");
      return false;
    }
    setVaultSummary(response.summary ?? null);
    setSaveMode("private");
    await refreshTasks("private");
    return true;
  }

  async function unlockPrivateVaultAction(passphrase: string) {
    setError(null);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.UnlockPrivateVault,
      passphrase,
    }) as PrivateVaultStateResponse;
    if (!response?.ok) {
      setError(response?.error ?? "解锁私密模式失败。");
      return false;
    }
    setVaultSummary(response.summary ?? null);
    await refreshTasks("private");
    return true;
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
      setError(response?.error ?? "锁定私密模式失败。");
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

  function handleSelectTask(id: string) {
    setSelectedTaskId(id);
    setView("detail");
  }

  const authFeedback: Feedback = authMessage
    ? { tone: authState === "error" ? "error" : "info", message: authMessage }
    : null;
  const serverFeedback: Feedback[] = [
    settingsMessage ? { tone: settingsState === "error" ? "error" : "success", message: settingsMessage } : null,
    connectionMessage ? { tone: connectionState === "error" ? "error" : "success", message: connectionMessage } : null,
  ];
  const serverBlock = (
    <ServerBlock
      apiBaseUrl={apiBaseUrl}
      feedback={serverFeedback}
      onChange={setApiBaseUrl}
      onReset={resetApiBaseUrl}
      onSave={saveSettings}
      onTest={testConnection}
      placeholder={DEFAULT_API_BASE_URL}
      saving={settingsState === "saving"}
      testing={connectionState === "testing"}
    />
  );

  // 网页授权落地页视图 (?view=auth)
  if (AUTH_PAGE_VIEW) {
    const authPageTitle = authUser ? "KeepPage 已连接" : "连接 KeepPage";
    const authPageSubtitle = authUser
      ? "当前浏览器已经连接账号，可以回到侧栏继续保存网页。"
      : AUTH_PAGE_REASON === "session-expired"
      ? "插件授权已失效，请通过网页重新连接后继续使用。"
      : "完成网页授权后，扩展会自动连接，你就可以直接保存当前页面。";
    const authPageApiHost = normalizeApiBaseUrl(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/^https?:\/\//, "");

    return (
      <div className="sp-auth-page">
        <main className="sp-auth">
          <header className="sp-auth-head">
            <div className="sp-auth-brand">
              <BrandMark size={28} />
              <span>KeepPage 浏览器扩展</span>
            </div>
            <h1>{authPageTitle}</h1>
            <p>{authPageSubtitle}</p>
            <span className="sp-auth-host">服务器：{authPageApiHost}</span>
          </header>

          <SettingsSection title="账号">
            <AccountBlock
              authUser={authUser}
              connectLabel="前往网页授权"
              connecting={authState === "submitting"}
              extraAction={
                <button className="sp-button is-primary" onClick={() => void openSidePanelForCurrentWindow()} type="button">
                  打开侧栏
                </button>
              }
              feedback={authFeedback}
              onConnect={connectAccount}
              onLogout={logoutAuth}
            />
          </SettingsSection>

          <SettingsSection description="使用自部署服务时修改。" title="服务器地址">{serverBlock}</SettingsSection>
        </main>
      </div>
    );
  }

  const vaultBlocksCapture = Boolean(authUser) && isPrivateLockedView;
  const vaultPanel = (
    <VaultPanel
      onChangeAutoLock={(autoLock) => void changePrivateAutoLockAction(autoLock)}
      onCreate={createPrivateVaultAction}
      onLock={() => void lockPrivateVaultAction()}
      onUnlock={unlockPrivateVaultAction}
      summary={vaultSummary}
    />
  );

  const emptyText = isPrivateView
    ? !isVaultEnabled
      ? "启用私密模式后，私密保存的网页会出现在这里。"
      : "还没有私密保存的网页。"
    : authUser
    ? "还没有保存记录。点击「保存此页」保存当前网页。"
    : "连接账号后，保存记录会显示在这里。";

  return (
    <div className={`sp-shell ${isPrivateView ? "is-private" : ""}`}>
      <Header
        authUser={authUser}
        onChangeSaveMode={(mode) => {
          setSaveMode(mode);
          if (view === "detail") {
            setView("queue");
          }
        }}
        onConnect={connectAccount}
        onOpenSettings={() => setView("settings")}
        onToggleSettings={() => setView(view === "settings" ? "queue" : "settings")}
        saveMode={saveMode}
        settingsOpen={view === "settings"}
      />
      {isPrivateView && view !== "settings" && <PrivateStrip enabled={isVaultEnabled} unlocked={isVaultUnlocked} />}

      <main className="sp-body" key={view}>
        {view === "settings" ? (
          <SettingsView
            account={
              <AccountBlock
                authUser={authUser}
                connectLabel="打开网页授权"
                connecting={authState === "submitting"}
                feedback={authFeedback}
                onConnect={connectAccount}
                onLogout={logoutAuth}
              />
            }
            debugMode={debugMode}
            iconFeedback={
              iconRefreshMessage
                ? { tone: iconRefreshState === "error" ? "error" : "success", message: iconRefreshMessage }
                : null
            }
            incognitoPrivateDefault={incognitoPrivateDefault}
            onBack={() => setView("queue")}
            onDebugModeChange={(checked) => {
              setDebugMode(checked);
              void chrome.storage.local.set({ debugMode: checked });
            }}
            onIncognitoPrivateDefaultChange={(checked) => {
              setIncognitoPrivateDefault(checked);
              void chrome.storage.local.set({ incognitoPrivateDefault: checked });
            }}
            onRefreshIcons={refreshAllIcons}
            refreshingIcons={iconRefreshState === "refreshing"}
            server={serverBlock}
          />
        ) : view === "detail" && selectedTask ? (
          <TaskDetail
            notice={error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}
            locked={isPrivateLockedView && selectedTask.isPrivate}
            onBack={() => setView("queue")}
            onOpenPreview={openPreviewInNewTab}
            onPrivateLocked={() => void refreshPrivateVaultState(true)}
            onRetry={retryCurrentTask}
            retryDisabled={selectedTask.source.captureScope === "selection" && !canResumeSync}
            retryLabel={retryLabel}
            task={selectedTask}
          />
        ) : (
          <>
            {vaultBlocksCapture && vaultPanel}

            <CapturePanel
              activeTab={activeTab}
              blockedHint={vaultBlocksCapture ? (isVaultEnabled ? "解锁私密模式后才能私密保存。" : "启用私密模式后才能私密保存。") : null}
              capturing={state === "capturing"}
              hint={isPrivateView ? "只保存到私密空间，与普通书签分开存放。" : "保存完整网页存档，并同步到你的资料库。"}
              isPrivate={isPrivateView}
              onCapture={handlePrimaryAction}
              onCaptureSelection={startSelectionCaptureAction}
              primaryLabel={primaryActionLabel}
            />

            {isPrivateView && authUser && !vaultBlocksCapture && vaultPanel}

            {error && <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice>}

            <TaskList emptyText={emptyText} hideTaskContent={isPrivateLockedView} onSelect={handleSelectTask} tasks={tasks} />
          </>
        )}
      </main>
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
