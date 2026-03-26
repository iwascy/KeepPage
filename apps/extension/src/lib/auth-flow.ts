import type { AuthSession, AuthUser } from "@keeppage/domain";
import { getStoredAuthToken, getStoredAuthUser } from "./auth-storage";
import { authUserSchema } from "./domain-runtime";
import { createLogger } from "./logger";

const AUTH_PAGE_FILE = "sidepanel.html";
const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const EXTENSION_API_TOKEN_NAME = "KeepPage Extension";
const logger = createLogger("auth-flow");

class ApiResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

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
  const token = await getStoredAuthToken();
  return Boolean(token);
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

  if (!token) {
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
      tokenKind: isApiToken(token) ? "api-token" : "session-token",
      userId: storedUser?.id,
      email: storedUser?.email,
    });
    const user = await fetchCurrentAccount(apiBaseUrl, token);
    const persistentToken = await ensurePersistentAuthToken(apiBaseUrl, token);
    await chrome.storage.local.set({
      authToken: persistentToken,
      authUser: user,
    });
    logger.debug("Stored auth session validated successfully.", {
      apiBaseUrl,
      userId: user.id,
      email: user.email,
      tokenKind: isApiToken(persistentToken) ? "api-token" : "session-token",
    });
    return {
      ok: true,
      token: persistentToken,
      user,
      apiBaseUrl,
    };
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 401 || error.status === 403)) {
      logger.warn("Stored auth session is unauthorized.", {
        apiBaseUrl,
        status: error.status,
        userId: storedUser?.id,
      });
      return {
        ok: false,
        reason: "unauthorized",
        message: "登录已失效，请重新登录。",
        apiBaseUrl,
      };
    }

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

export async function authenticateAccount(
  apiBaseUrl: string,
  mode: "login" | "register",
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

  const session = await response.json() as AuthSession;
  const token = typeof session.token === "string" ? session.token.trim() : "";
  if (!token) {
    throw new Error("登录成功，但服务端没有返回有效的登录令牌。");
  }
  const user = authUserSchema.parse(session.user);

  return {
    token,
    user,
  } satisfies AuthSession;
}

export async function persistAuthSession(apiBaseUrl: string, session: AuthSession) {
  const user = authUserSchema.parse(session.user);
  const persistentToken = await ensurePersistentAuthToken(apiBaseUrl, session.token);
  await chrome.storage.local.set({
    authToken: persistentToken,
    authUser: user,
  });
  return {
    token: persistentToken,
    user,
  };
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

async function fetchCurrentAccount(apiBaseUrl: string, authToken: string) {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    throw new ApiResponseError(response.status, await readApiErrorMessage(response));
  }

  return authUserSchema.parse(await response.json());
}

async function ensurePersistentAuthToken(apiBaseUrl: string, authToken: string) {
  if (isApiToken(authToken)) {
    return authToken;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api-tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: EXTENSION_API_TOKEN_NAME,
        scopes: ["bookmark:create"],
      }),
    });

    if (!response.ok) {
      throw new ApiResponseError(response.status, await readApiErrorMessage(response));
    }

    const payload = await response.json() as { token?: unknown };
    const persistentToken = typeof payload.token === "string" ? payload.token.trim() : "";
    if (!persistentToken || !isApiToken(persistentToken)) {
      throw new Error("服务端没有返回有效的扩展长期令牌。");
    }

    logger.info("Upgraded extension auth session to long-lived API token.");
    return persistentToken;
  } catch (error) {
    logger.warn("Failed to upgrade session token to long-lived API token, keeping current token.", {
      apiBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return authToken;
  }
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

function isApiToken(token: string) {
  return token.startsWith("kp_");
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
