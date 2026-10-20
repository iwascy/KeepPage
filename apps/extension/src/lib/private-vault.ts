import type {
  PrivateAutoLock,
  PrivateVaultSummary,
} from "@keeppage/domain";
import { getConfiguredApiBaseUrl } from "./auth-flow";
import { getStoredSyncToken } from "./auth-storage";
import { privateAutoLockSchema, privateVaultSummarySchema } from "./domain-runtime";
import { createLogger } from "./logger";

const PRIVATE_TOKEN_KEY = "privateModeToken";
// Inactivity deadline (epoch ms) for the current private session; absent for "browser".
const PRIVATE_TOKEN_EXPIRES_AT_KEY = "privateModeTokenExpiresAt";
const PRIVATE_AUTO_LOCK_KEY = "privateAutoLock";
const DEFAULT_PRIVATE_AUTO_LOCK: PrivateAutoLock = "15m";
const AUTO_LOCK_DURATION_MS: Record<PrivateAutoLock, number | null> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  // chrome.storage.session is cleared when the browser exits.
  browser: null,
};
// Avoid rewriting the deadline to storage on every private request.
const EXPIRY_TOUCH_INTERVAL_MS = 30 * 1000;
const logger = createLogger("private-mode");

class PrivateModeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PrivateModeApiError";
    this.status = status;
  }
}

let cachedPrivateToken: string | null = null;
let cachedPrivateTokenExpiresAt: number | null = null;
let privateTokenLoaded = false;

async function createEmptySummary(): Promise<PrivateVaultSummary> {
  return privateVaultSummarySchema.parse({
    enabled: false,
    unlocked: false,
    autoLock: await getPrivateAutoLock(),
    totalItems: 0,
    pendingSyncCount: 0,
    syncEnabled: true,
  });
}

export async function getPrivateAutoLock(): Promise<PrivateAutoLock> {
  const result = await chrome.storage.local.get(PRIVATE_AUTO_LOCK_KEY);
  try {
    return privateAutoLockSchema.parse(result[PRIVATE_AUTO_LOCK_KEY] ?? DEFAULT_PRIVATE_AUTO_LOCK);
  } catch {
    return DEFAULT_PRIVATE_AUTO_LOCK;
  }
}

export async function setPrivateAutoLock(autoLock: PrivateAutoLock) {
  await chrome.storage.local.set({
    [PRIVATE_AUTO_LOCK_KEY]: privateAutoLockSchema.parse(autoLock),
  });
  if (await loadPrivateToken()) {
    await persistPrivateTokenExpiry(await computePrivateTokenExpiresAt());
  }
  return getPrivateVaultSummary();
}

async function computePrivateTokenExpiresAt() {
  const duration = AUTO_LOCK_DURATION_MS[await getPrivateAutoLock()];
  return duration == null ? null : Date.now() + duration;
}

async function persistPrivateTokenExpiry(expiresAt: number | null) {
  cachedPrivateTokenExpiresAt = expiresAt;
  if (expiresAt == null) {
    await chrome.storage.session.remove(PRIVATE_TOKEN_EXPIRES_AT_KEY);
    return;
  }
  await chrome.storage.session.set({
    [PRIVATE_TOKEN_EXPIRES_AT_KEY]: expiresAt,
  });
}

async function loadPrivateToken() {
  if (!privateTokenLoaded) {
    const result = await chrome.storage.session.get([PRIVATE_TOKEN_KEY, PRIVATE_TOKEN_EXPIRES_AT_KEY]);
    cachedPrivateToken = typeof result[PRIVATE_TOKEN_KEY] === "string"
      ? result[PRIVATE_TOKEN_KEY].trim() || null
      : null;
    cachedPrivateTokenExpiresAt = typeof result[PRIVATE_TOKEN_EXPIRES_AT_KEY] === "number"
      ? result[PRIVATE_TOKEN_EXPIRES_AT_KEY]
      : null;
    privateTokenLoaded = true;
  }
  if (!cachedPrivateToken) {
    return null;
  }

  if (cachedPrivateTokenExpiresAt != null && Date.now() >= cachedPrivateTokenExpiresAt) {
    logger.info("Private session reached its auto-lock deadline.");
    await lockPrivateVault().catch((error) => {
      logger.warn("Server-side private lock after auto-lock failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return null;
  }

  // Auto-lock counts inactivity: every private access pushes the deadline back.
  const nextExpiresAt = await computePrivateTokenExpiresAt();
  if (
    nextExpiresAt !== cachedPrivateTokenExpiresAt &&
    (nextExpiresAt == null ||
      cachedPrivateTokenExpiresAt == null ||
      nextExpiresAt - cachedPrivateTokenExpiresAt >= EXPIRY_TOUCH_INTERVAL_MS)
  ) {
    await persistPrivateTokenExpiry(nextExpiresAt);
  }
  return cachedPrivateToken;
}

async function persistPrivateToken(privateToken: string | null) {
  cachedPrivateToken = privateToken;
  privateTokenLoaded = true;
  if (privateToken) {
    await chrome.storage.session.set({
      [PRIVATE_TOKEN_KEY]: privateToken,
    });
    await persistPrivateTokenExpiry(await computePrivateTokenExpiresAt());
    return;
  }
  await chrome.storage.session.remove(PRIVATE_TOKEN_KEY);
  await persistPrivateTokenExpiry(null);
}

async function withLocalAutoLock(summary: PrivateVaultSummary): Promise<PrivateVaultSummary> {
  return {
    ...summary,
    autoLock: await getPrivateAutoLock(),
  };
}

async function requireAuthHeaders(privateToken?: string | null) {
  const authToken = await getStoredSyncToken();
  if (!authToken) {
    throw new Error("请先登录 KeepPage，再使用私密模式。");
  }
  return {
    authorization: `Bearer ${authToken}`,
    ...(privateToken
      ? {
          "x-keeppage-private-token": privateToken,
        }
      : {}),
  } satisfies Record<string, string>;
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

async function requestJson(path: string, init: RequestInit, allowUnauthorized = false) {
  const apiBaseUrl = await getConfiguredApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    if (allowUnauthorized && (response.status === 401 || response.status === 403)) {
      throw new PrivateModeApiError(response.status, message);
    }
    throw new PrivateModeApiError(response.status, message);
  }

  return response.json();
}

function parseUnlockResponse(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("私密模式响应格式不正确。");
  }
  const record = input as Record<string, unknown>;
  const privateToken = typeof record.privateToken === "string" ? record.privateToken.trim() : "";
  if (!privateToken) {
    throw new Error("服务端没有返回有效的私密模式会话。");
  }
  return {
    summary: privateVaultSummarySchema.parse(record.summary),
    privateToken,
  };
}

export async function getPrivateSessionToken() {
  return loadPrivateToken();
}

export async function getPrivateVaultSummary(_ownerUserId?: string): Promise<PrivateVaultSummary> {
  const authToken = await getStoredSyncToken();
  if (!authToken) {
    await persistPrivateToken(null);
    return createEmptySummary();
  }

  const privateToken = await loadPrivateToken();
  try {
    const summary = privateVaultSummarySchema.parse(
      await requestJson("/private-mode/status", {
        method: "GET",
        headers: await requireAuthHeaders(privateToken),
      }, true),
    );
    if (!summary.unlocked && privateToken) {
      await persistPrivateToken(null);
    }
    return withLocalAutoLock(summary);
  } catch (error) {
    if (error instanceof PrivateModeApiError && (error.status === 401 || error.status === 403)) {
      logger.warn("Fetching private mode summary fell back to locked state.", {
        status: error.status,
        message: error.message,
      });
      await persistPrivateToken(null);
      return createEmptySummary();
    }
    throw error;
  }
}

export async function createPrivateVault(input: {
  passphrase: string;
  autoLock: PrivateAutoLock;
}) {
  await chrome.storage.local.set({
    [PRIVATE_AUTO_LOCK_KEY]: privateAutoLockSchema.parse(input.autoLock),
  });
  const payload = parseUnlockResponse(
    await requestJson("/private-mode/setup", {
      method: "POST",
      headers: {
        ...(await requireAuthHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: input.passphrase,
      }),
    }),
  );
  await persistPrivateToken(payload.privateToken);
  return {
    summary: await withLocalAutoLock(payload.summary),
  };
}

export async function unlockPrivateVault(passphrase: string) {
  const payload = parseUnlockResponse(
    await requestJson("/private-mode/unlock", {
      method: "POST",
      headers: {
        ...(await requireAuthHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: passphrase,
      }),
    }),
  );
  await persistPrivateToken(payload.privateToken);
  return withLocalAutoLock(payload.summary);
}

export async function lockPrivateVault() {
  const authToken = await getStoredSyncToken();
  await persistPrivateToken(null);
  if (!authToken) {
    return createEmptySummary();
  }

  try {
    return withLocalAutoLock(privateVaultSummarySchema.parse(
      await requestJson("/private-mode/lock", {
        method: "POST",
        headers: await requireAuthHeaders(),
      }, true),
    ));
  } catch (error) {
    if (error instanceof PrivateModeApiError && (error.status === 401 || error.status === 403)) {
      logger.warn("Locking private mode returned unauthorized, clearing local session only.", {
        status: error.status,
        message: error.message,
      });
      return createEmptySummary();
    }
    throw error;
  }
}

export function isPrivateVaultUnlocked() {
  return Boolean(cachedPrivateToken);
}

export async function requirePrivateVaultUnlocked() {
  const privateToken = await loadPrivateToken();
  if (!privateToken) {
    throw new Error("请先输入私密模式密码。");
  }

  const summary = await getPrivateVaultSummary();
  if (!summary.enabled) {
    throw new Error("请先启用私密模式。");
  }
  if (!summary.unlocked) {
    throw new Error("私密模式当前已锁定，请先输入密码。");
  }

  return privateToken;
}
