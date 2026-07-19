import type { AuthSession, AuthUser } from "@keeppage/domain";
import { getStoredAuthToken, getStoredAuthUser, getStoredSyncToken } from "./auth-storage";
import { authUserSchema } from "./domain-runtime";
import { createLogger } from "./logger";

const AUTH_PAGE_FILE = "sidepanel.html";
const DEFAULT_API_BASE_URL = "https://keeppage.cccy.fun/api";
const DEFAULT_WEB_BASE_URL = "https://keeppage.cccy.fun";
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
  await chrome.storage.local.remove([
    "authToken",
    "authApiToken",
    "extensionDeviceToken",
    "extensionDevice",
    "extensionConnectNonce",
    "authUser",
  ]);
}

export async function getConfiguredApiBaseUrl() {
  const result = await chrome.storage.local.get("apiBaseUrl");
  const configured = typeof result.apiBaseUrl === "string" ? result.apiBaseUrl.trim() : "";
  const apiBaseUrl = normalizeApiBaseUrl(configured || DEFAULT_API_BASE_URL);
  if (configured && configured !== apiBaseUrl) {
    await chrome.storage.local.set({ apiBaseUrl });
    logger.info("Migrated legacy API base URL.", {
      configured,
      apiBaseUrl,
    });
  }
  logger.debug("Resolved configured API base URL.", {
    configured: configured || undefined,
    apiBaseUrl,
  });
  return apiBaseUrl;
}

export async function validateStoredAuthSession(): Promise<SessionValidationResult> {
  const [apiBaseUrl, token, syncToken, storedUser] = await Promise.all([
    getConfiguredApiBaseUrl(),
    getStoredAuthToken(),
    getStoredSyncToken(),
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
      tokenKind: getTokenKind(token),
      userId: storedUser?.id,
      email: storedUser?.email,
    });
    const user = await fetchCurrentAccount(apiBaseUrl, token);
    await persistValidatedAuthState(token, user);
    logger.debug("Stored auth session validated successfully.", {
      apiBaseUrl,
      userId: user.id,
      email: user.email,
      tokenKind: getTokenKind(syncToken || token),
    });
    return {
      ok: true,
      token,
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
  await persistStoredTokens({
    authToken: session.token,
    authUser: user,
  });
  return {
    token: session.token,
    user,
  };
}

export async function recoverUnauthorizedSession(reason = "session-expired") {
  await clearStoredAuthSession();
  logger.info("Recovering unauthorized session by opening auth page.", { reason });
  await openExtensionAuthPage(reason);
}

export async function openExtensionAuthPage(reason = "login") {
  logger.debug("Opening web extension connect page.", { reason });
  const connectNonce = crypto.randomUUID();
  await chrome.storage.local.set({
    extensionConnectNonce: connectNonce,
  });
  await openExtensionPage(await buildWebExtensionConnectUrl(reason, connectNonce));
}

export async function redeemExtensionConnectCode(input: {
  apiBaseUrl: string;
  code: string;
  connectNonce: string;
}) {
  const stored = await chrome.storage.local.get("extensionConnectNonce");
  const expectedNonce = typeof stored.extensionConnectNonce === "string"
    ? stored.extensionConnectNonce.trim()
    : "";
  const actualNonce = input.connectNonce.trim();
  if (!expectedNonce || !actualNonce || expectedNonce !== actualNonce) {
    throw new Error("插件授权请求已失效，请从插件重新打开授权页。");
  }

  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/extension/connect/redeem`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      code: input.code,
    }),
  });

  if (!response.ok) {
    throw new ApiResponseError(response.status, await readApiErrorMessage(response));
  }

  const payload = await response.json() as {
    token?: unknown;
    user?: unknown;
    device?: unknown;
  };
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!isExtensionDeviceToken(token)) {
    throw new Error("服务端没有返回有效的插件设备令牌。");
  }

  const user = authUserSchema.parse(payload.user);
  await chrome.storage.local.set({
    apiBaseUrl,
    extensionDeviceToken: token,
    extensionDevice: payload.device,
    authUser: user,
  });
  await chrome.storage.local.remove(["authToken", "authApiToken", "extensionConnectNonce"]);
  logger.info("Extension device connected successfully.", {
    apiBaseUrl,
    userId: user.id,
    email: user.email,
  });
  return {
    token,
    user,
  };
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

async function buildWebExtensionConnectUrl(reason: string, connectNonce: string) {
  const apiBaseUrl = await getConfiguredApiBaseUrl();
  const webBaseUrl = resolveWebBaseUrl(apiBaseUrl);
  const authPageUrl = new URL("#/extension/connect", webBaseUrl);
  authPageUrl.hash = buildExtensionConnectHash(reason, connectNonce);
  return authPageUrl.toString();
}

export function normalizeApiBaseUrl(input: string) {
  const normalized = input.trim().replace(/\/+$/, "");
  if (normalized === DEFAULT_WEB_BASE_URL) {
    return DEFAULT_API_BASE_URL;
  }
  return normalized || DEFAULT_API_BASE_URL;
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

async function persistStoredTokens(input: {
  authToken: string;
  authUser: AuthUser;
}) {
  await chrome.storage.local.set({
    authToken: input.authToken,
    authUser: input.authUser,
  });
}

async function persistValidatedAuthState(token: string, user: AuthUser) {
  await chrome.storage.local.set({
    authUser: user,
  });

  if (isExtensionDeviceToken(token)) {
    await chrome.storage.local.set({
      extensionDeviceToken: token,
    });
    await chrome.storage.local.remove(["authToken", "authApiToken"]);
    return;
  }

  if (isApiToken(token)) {
    await chrome.storage.local.set({
      authApiToken: token,
    });
    await chrome.storage.local.remove("authToken");
    return;
  }

  await chrome.storage.local.set({
    authToken: token,
  });
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

function isExtensionDeviceToken(token: string) {
  return token.startsWith("kpd_");
}

function getTokenKind(token: string) {
  if (isExtensionDeviceToken(token)) {
    return "extension-device";
  }
  if (isApiToken(token)) {
    return "api-token";
  }
  return "session-token";
}

function resolveWebBaseUrl(apiBaseUrl: string) {
  try {
    const url = new URL(apiBaseUrl);
    if (url.pathname.endsWith("/api")) {
      url.pathname = url.pathname.slice(0, -4) || "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return DEFAULT_WEB_BASE_URL;
  }
  return DEFAULT_WEB_BASE_URL;
}

function buildExtensionConnectHash(reason: string, connectNonce: string) {
  const params = new URLSearchParams({
    reason,
    deviceName: buildDeviceName(),
    platform: "Chrome Extension",
    extensionId: chrome.runtime.id,
    connectNonce,
  });
  return `#/extension/connect?${params.toString()}`;
}

function buildDeviceName() {
  const browser = detectBrowserName();
  const platform = navigator.platform?.trim();
  return platform ? `${browser} on ${platform}` : `${browser} Extension`;
}

function detectBrowserName() {
  const userAgent = navigator.userAgent;
  if (userAgent.includes("Edg/")) {
    return "Edge";
  }
  if (userAgent.includes("Firefox/")) {
    return "Firefox";
  }
  if (userAgent.includes("Chrome/")) {
    return "Chrome";
  }
  return "KeepPage";
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
