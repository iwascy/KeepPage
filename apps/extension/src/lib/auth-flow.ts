import type { AuthUser } from "@keeppage/domain";
import { getStoredAuthToken, getStoredAuthUser } from "./auth-storage";
import { authUserSchema } from "./domain-runtime";
import { createLogger } from "./logger";

const AUTH_PAGE_FILE = "sidepanel.html";
const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const logger = createLogger("auth-flow");

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
  const apiBaseUrl = normalizeApiBaseUrl(configured || DEFAULT_API_BASE_URL);
  logger.debug("Resolved configured API base URL.", {
    configured: configured || undefined,
    apiBaseUrl,
  });
  return apiBaseUrl;
}

export async function validateStoredAuthSession(): Promise<SessionValidationResult> {
  const [apiBaseUrl, token, storedUser] = await Promise.all([
    getConfiguredApiBaseUrl(),
    getStoredAuthToken(),
    getStoredAuthUser(),
  ]);

  if (!token || !storedUser) {
    logger.debug("Stored auth session is incomplete.", {
      hasToken: Boolean(token),
      hasUser: Boolean(storedUser),
      apiBaseUrl,
    });
    return {
      ok: false,
      reason: "missing",
      message: "请先登录 KeepPage。",
      apiBaseUrl,
    };
  }

  try {
    logger.debug("Validating stored auth session.", {
      apiBaseUrl,
      userId: storedUser.id,
      email: storedUser.email,
    });
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      logger.warn("Stored auth session is unauthorized.", {
        apiBaseUrl,
        status: response.status,
        userId: storedUser.id,
      });
      return {
        ok: false,
        reason: "unauthorized",
        message: "登录已失效，请重新登录。",
        apiBaseUrl,
      };
    }

    if (!response.ok) {
      const text = await response.text();
      logger.warn("Stored auth session validation hit non-success response.", {
        apiBaseUrl,
        status: response.status,
        body: text,
      });
      return {
        ok: false,
        reason: "unreachable",
        message: text ? `API ${response.status}: ${text}` : `API ${response.status}`,
        apiBaseUrl,
      };
    }

    const user = authUserSchema.parse(await response.json());
    await chrome.storage.local.set({ authUser: user });
    logger.debug("Stored auth session validated successfully.", {
      apiBaseUrl,
      userId: user.id,
      email: user.email,
    });
    return {
      ok: true,
      token,
      user,
      apiBaseUrl,
    };
  } catch (error) {
    logger.warn("Stored auth session validation failed due to fetch error.", {
      apiBaseUrl,
      error: error instanceof Error ? error.message : "无法验证当前登录状态。",
    });
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
  logger.info("Recovering unauthorized session by opening auth page.", { reason });
  await openExtensionAuthPage(reason);
}

export async function openExtensionAuthPage(reason = "login") {
  logger.debug("Opening extension auth page.", { reason });
  await openExtensionPage(buildExtensionAuthPageUrl(reason));
}

export async function openSidePanelForCurrentWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  return openSidePanelForWindow(currentWindow.id);
}

export async function openExtensionWorkspacePage() {
  logger.debug("Opening extension workspace page.");
  await openExtensionPage(chrome.runtime.getURL(AUTH_PAGE_FILE));
}

export async function openWorkspaceUi(windowId: number | undefined) {
  const sidePanelOpened = await openSidePanelForWindow(windowId);
  logger.debug("Resolved workspace UI target.", {
    windowId,
    sidePanelOpened,
  });
  if (sidePanelOpened) {
    return;
  }
  await openExtensionWorkspacePage();
}

export async function openSidePanelForWindow(windowId: number | undefined) {
  if (windowId == null) {
    logger.debug("Skipping side panel open because windowId is missing.");
    return false;
  }

  try {
    await chrome.sidePanel.open({ windowId });
    logger.debug("Side panel opened successfully.", { windowId });
    return true;
  } catch (error) {
    logger.warn("Failed to open side panel.", {
      windowId,
      error: error instanceof Error ? error.message : String(error),
    });
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
    logger.debug("Reusing existing extension tab.", {
      tabId: existingTab.id,
      pageUrl,
    });
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

  logger.debug("Creating new extension tab.", { pageUrl });
  await chrome.tabs.create({
    url: pageUrl,
    active: true,
  });
}
