import type {
  PrivateAutoLock,
  PrivateVaultSummary,
} from "@keeppage/domain";
import { getConfiguredApiBaseUrl } from "./auth-flow";
import { getStoredSyncToken } from "./auth-storage";
import { privateVaultSummarySchema } from "./domain-runtime";
import { createLogger } from "./logger";

const PRIVATE_TOKEN_KEY = "privateModeToken";
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
let privateTokenLoaded = false;

function createEmptySummary(): PrivateVaultSummary {
  return privateVaultSummarySchema.parse({
    enabled: false,
    unlocked: false,
    autoLock: "browser",
    totalItems: 0,
    pendingSyncCount: 0,
    syncEnabled: true,
  });
}

async function loadPrivateToken() {
  if (privateTokenLoaded) {
    return cachedPrivateToken;
  }
  const result = await chrome.storage.session.get(PRIVATE_TOKEN_KEY);
  cachedPrivateToken = typeof result[PRIVATE_TOKEN_KEY] === "string"
    ? result[PRIVATE_TOKEN_KEY].trim() || null
    : null;
  privateTokenLoaded = true;
  return cachedPrivateToken;
}

async function persistPrivateToken(privateToken: string | null) {
  cachedPrivateToken = privateToken;
  privateTokenLoaded = true;
  if (privateToken) {
    await chrome.storage.session.set({
      [PRIVATE_TOKEN_KEY]: privateToken,
    });
    return;
  }
  await chrome.storage.session.remove(PRIVATE_TOKEN_KEY);
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
    return summary;
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
  void input.autoLock;
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
    summary: payload.summary,
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
  return payload.summary;
}

export async function lockPrivateVault() {
  const authToken = await getStoredSyncToken();
  await persistPrivateToken(null);
  if (!authToken) {
    return createEmptySummary();
  }

  try {
    return privateVaultSummarySchema.parse(
      await requestJson("/private-mode/lock", {
        method: "POST",
        headers: await requireAuthHeaders(),
      }, true),
    );
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
