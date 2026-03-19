import {
  authUserSchema,
  type AuthUser,
} from "@keeppage/domain";
import { getStoredAuthToken, getStoredAuthUser } from "./auth-storage";

const AUTH_PAGE_FILE = "sidepanel.html";
const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";

type SessionValidationResult =
  | {
      ok: true;
      token: string;
      user: AuthUser;
      apiBaseUrl: string;
    }
  | {
      ok: false;
      reason: "missing" | "unauthorized" | "unreachable";
      message: string;
      apiBaseUrl: string;
    };

export async function hasStoredAuthSession() {
  const [token, user] = await Promise.all([
    getStoredAuthToken(),
    getStoredAuthUser(),
  ]);
  return Boolean(token && user);
}

export async function clearStoredAuthSession() {
  await chrome.storage.local.remove(["authToken", "authUser"]);
}

export async function getConfiguredApiBaseUrl() {
  const result = await chrome.storage.local.get("apiBaseUrl");
  const configured = typeof result.apiBaseUrl === "string" ? result.apiBaseUrl.trim() : "";
  return normalizeApiBaseUrl(configured || DEFAULT_API_BASE_URL);
}

export async function validateStoredAuthSession(): Promise<SessionValidationResult> {
  const [apiBaseUrl, token, storedUser] = await Promise.all([
    getConfiguredApiBaseUrl(),
    getStoredAuthToken(),
    getStoredAuthUser(),
  ]);

  if (!token || !storedUser) {
    return {
      ok: false,
      reason: "missing",
      message: "请先登录 KeepPage。",
      apiBaseUrl,
    };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "登录已失效，请重新登录。",
        apiBaseUrl,
      };
    }

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        reason: "unreachable",
        message: text ? `API ${response.status}: ${text}` : `API ${response.status}`,
        apiBaseUrl,
      };
    }

    const user = authUserSchema.parse(await response.json());
    await chrome.storage.local.set({ authUser: user });
    return {
      ok: true,
      token,
      user,
      apiBaseUrl,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: error instanceof Error ? error.message : "无法验证当前登录状态。",
      apiBaseUrl,
    };
  }
}

export async function recoverUnauthorizedSession(reason = "session-expired") {
  await clearStoredAuthSession();
  await openExtensionAuthPage(reason);
}

export async function openExtensionAuthPage(reason = "login") {
  await openExtensionPage(buildExtensionAuthPageUrl(reason));
}

export async function openSidePanelForCurrentWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  return openSidePanelForWindow(currentWindow.id);
}

export async function openExtensionWorkspacePage() {
  await openExtensionPage(chrome.runtime.getURL(AUTH_PAGE_FILE));
}

export async function openWorkspaceUi(windowId: number | undefined) {
  const sidePanelOpened = await openSidePanelForWindow(windowId);
  if (sidePanelOpened) {
    return;
  }
  await openExtensionWorkspacePage();
}

export async function openSidePanelForWindow(windowId: number | undefined) {
  if (windowId == null) {
    return false;
  }

  try {
    await chrome.sidePanel.open({ windowId });
    return true;
  } catch {
    return false;
  }
}

function buildExtensionAuthPageUrl(reason: string) {
  const authPageUrl = new URL(chrome.runtime.getURL(AUTH_PAGE_FILE));
  authPageUrl.searchParams.set("view", "auth");
  authPageUrl.searchParams.set("reason", reason);
  return authPageUrl.toString();
}

function normalizeApiBaseUrl(input: string) {
  return input.trim().replace(/\/$/, "");
}

async function openExtensionPage(pageUrl: string) {
  const pageBaseUrl = chrome.runtime.getURL(AUTH_PAGE_FILE);
  const existingTabs = await chrome.tabs.query({});
  const existingTab = existingTabs.find(
    (tab) => typeof tab.id === "number" && tab.url?.startsWith(pageBaseUrl),
  );

  if (existingTab?.id != null) {
    await chrome.tabs.update(existingTab.id, {
      active: true,
      url: pageUrl,
    });
    if (existingTab.windowId != null) {
      await chrome.windows.update(existingTab.windowId, {
        focused: true,
      });
    }
    return;
  }

  await chrome.tabs.create({
    url: pageUrl,
    active: true,
  });
}
