import type {
  CaptureTask,
  CaptureTaskOwner,
  PrivateAutoLock,
  PrivateCaptureTaskShell,
  PrivateVaultSummary,
} from "@keeppage/domain";
import {
  type PrivateCaptureTaskRecord,
  type PrivateTaskPayload,
  type PrivateVaultRecord,
  dbPromise,
} from "./extension-db";
import {
  captureTaskSchema,
  privateAutoLockSchema,
  privateCaptureTaskShellSchema,
  privateTaskPayloadSchema,
  privateVaultSummarySchema,
} from "./domain-runtime";

const PRIMARY_VAULT_ID = "primary";
const PBKDF2_ITERATIONS = 310_000;
const REDACTED_TITLE = "私密条目（已锁定）";
const REDACTED_URL = "https://private.local/locked";
const REDACTED_DOMAIN = "private.local";

let activeVaultSession:
  | {
      key: CryptoKey;
      autoLock: PrivateAutoLock;
      expiresAt: number | null;
      timer: ReturnType<typeof setTimeout> | null;
    }
  | null = null;

export async function getPrivateVaultSummary(ownerUserId?: string): Promise<PrivateVaultSummary> {
  await ensureSessionFresh();
  const database = await dbPromise;
  const [vaultRecord, taskRecords] = await Promise.all([
    database.get("privateVault", PRIMARY_VAULT_ID),
    database.getAll("privateCaptureTasks"),
  ]);
  const filteredTasks = taskRecords.filter((record) =>
    ownerUserId ? record.shell.owner?.userId === ownerUserId : true
  );
  const lastUpdatedAt = filteredTasks
    .map((record) => record.shell.updatedAt)
    .sort((left, right) => right.localeCompare(left))[0];

  return privateVaultSummarySchema.parse({
    enabled: Boolean(vaultRecord),
    unlocked: Boolean(vaultRecord) && isSessionUnlocked(),
    autoLock: vaultRecord?.autoLock ?? "15m",
    totalItems: filteredTasks.length,
    pendingSyncCount: 0,
    syncEnabled: false,
    lastUpdatedAt,
  });
}

export async function createPrivateVault(input: {
  passphrase: string;
  autoLock: PrivateAutoLock;
}) {
  const autoLock = privateAutoLockSchema.parse(input.autoLock);
  const passphrase = input.passphrase.trim();
  if (passphrase.length < 8) {
    throw new Error("私密口令至少需要 8 位。");
  }

  const salt = randomBase64(16);
  const { key, verifier } = await deriveVaultSecrets(passphrase, salt);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeDigest = await sha256Base64(recoveryCode);
  const now = new Date().toISOString();
  const record: PrivateVaultRecord = {
    id: PRIMARY_VAULT_ID,
    salt,
    verifier,
    autoLock,
    recoveryCodeDigest,
    createdAt: now,
    updatedAt: now,
  };

  const database = await dbPromise;
  await database.put("privateVault", record);
  armVaultSession(key, autoLock);
  return {
    summary: await getPrivateVaultSummary(),
    recoveryCode,
  };
}

export async function unlockPrivateVault(passphrase: string) {
  const record = await getVaultRecord();
  if (!record) {
    throw new Error("当前设备还没有启用私密库。");
  }
  const { key, verifier } = await deriveVaultSecrets(passphrase.trim(), record.salt);
  if (verifier !== record.verifier) {
    throw new Error("私密口令不正确，请检查后重试。");
  }
  armVaultSession(key, record.autoLock);
  return getPrivateVaultSummary();
}

export async function lockPrivateVault() {
  clearVaultSession();
  return getPrivateVaultSummary();
}

export async function listPrivateTasks(limit = 20, ownerUserId?: string) {
  await ensureSessionFresh();
  const database = await dbPromise;
  const records = await database.getAll("privateCaptureTasks");
  const filtered = records
    .filter((record) => (ownerUserId ? record.shell.owner?.userId === ownerUserId : true))
    .sort((left, right) => right.shell.updatedAt.localeCompare(left.shell.updatedAt))
    .slice(0, limit);
  const tasks = await Promise.all(filtered.map((record) => hydrateTaskRecord(record)));
  return tasks.map((task) => captureTaskSchema.parse(task));
}

export async function getPrivateTask(taskId: string, ownerUserId?: string) {
  await ensureSessionFresh();
  const database = await dbPromise;
  const record = await database.get("privateCaptureTasks", taskId);
  if (!record) {
    return null;
  }
  if (ownerUserId && record.shell.owner?.userId !== ownerUserId) {
    return null;
  }
  return captureTaskSchema.parse(await hydrateTaskRecord(record));
}

export async function putPrivateTaskShell(shell: PrivateCaptureTaskShell) {
  const parsedShell = privateCaptureTaskShellSchema.parse(shell);
  const database = await dbPromise;
  const existing = await database.get("privateCaptureTasks", parsedShell.id);
  const record: PrivateCaptureTaskRecord = existing
    ? {
        ...existing,
        shell: parsedShell,
      }
    : {
        id: parsedShell.id,
        shell: parsedShell,
      };
  await database.put("privateCaptureTasks", record);
  return parsedShell;
}

export async function patchPrivateTaskShell(
  taskId: string,
  patch: Partial<PrivateCaptureTaskShell>,
) {
  const database = await dbPromise;
  const existing = await database.get("privateCaptureTasks", taskId);
  if (!existing) {
    throw new Error(`Private task ${taskId} does not exist.`);
  }
  const merged = privateCaptureTaskShellSchema.parse({
    ...existing.shell,
    ...patch,
    id: existing.shell.id,
    isPrivate: true,
    updatedAt: new Date().toISOString(),
  });
  await database.put("privateCaptureTasks", {
    ...existing,
    shell: merged,
  });
  return merged;
}

export async function putPrivateTaskPayload(taskId: string, payload: PrivateTaskPayload) {
  const session = await requireVaultSession();
  const database = await dbPromise;
  const existing = await database.get("privateCaptureTasks", taskId);
  if (!existing) {
    throw new Error(`Private task ${taskId} does not exist.`);
  }
  const parsedPayload = privateTaskPayloadSchema.parse(payload);
  const encryptedPayload = await encryptPayload(parsedPayload, session.key);
  await database.put("privateCaptureTasks", {
    ...existing,
    encryptedPayload,
  });
}

export function buildPrivateTaskShell(input: {
  id: string;
  status: CaptureTask["status"];
  owner?: CaptureTaskOwner;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}): PrivateCaptureTaskShell {
  return privateCaptureTaskShellSchema.parse({
    id: input.id,
    status: input.status,
    owner: input.owner,
    isPrivate: true,
    privateMode: "local-only",
    syncState: "local-only",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    failureReason: input.failureReason,
  });
}

export function isPrivateVaultUnlocked() {
  return isSessionUnlocked();
}

export async function requirePrivateVaultUnlocked() {
  await requireVaultSession();
}

async function hydrateTaskRecord(record: PrivateCaptureTaskRecord): Promise<CaptureTask> {
  if (!isSessionUnlocked() || !record.encryptedPayload) {
    return buildLockedTask(record.shell);
  }

  try {
    const session = await requireVaultSession();
    const payload = await decryptPayload(record.encryptedPayload, session.key);
    return {
      id: record.shell.id,
      status: record.shell.status,
      saveMode: "private",
      isPrivate: true,
      privateMode: record.shell.privateMode,
      syncState: record.shell.syncState,
      owner: record.shell.owner,
      profile: payload.profile,
      source: payload.source,
      quality: payload.quality,
      artifacts: payload.artifacts,
      localArchiveSha256: payload.localArchiveSha256,
      bookmarkId: payload.bookmarkId,
      versionId: payload.versionId,
      createdAt: record.shell.createdAt,
      updatedAt: record.shell.updatedAt,
      failureReason: record.shell.failureReason,
    };
  } catch {
    return buildLockedTask({
      ...record.shell,
      failureReason: "私密数据解密失败，请重新解锁后再试。",
    });
  }
}

function buildLockedTask(shell: PrivateCaptureTaskShell): CaptureTask {
  return {
    id: shell.id,
    status: shell.status,
    saveMode: "private",
    isPrivate: true,
    privateMode: shell.privateMode,
    syncState: shell.syncState,
    owner: shell.owner,
    profile: "standard",
    source: {
      url: REDACTED_URL,
      title: REDACTED_TITLE,
      canonicalUrl: REDACTED_URL,
      domain: REDACTED_DOMAIN,
      captureScope: "page",
      viewport: {
        width: 1,
        height: 1,
      },
      savedAt: shell.updatedAt,
    },
    createdAt: shell.createdAt,
    updatedAt: shell.updatedAt,
    failureReason: shell.failureReason,
  };
}

async function getVaultRecord() {
  const database = await dbPromise;
  return database.get("privateVault", PRIMARY_VAULT_ID);
}

async function requireVaultSession() {
  await ensureSessionFresh();
  if (!activeVaultSession) {
    throw new Error("私密库当前已锁定，请先解锁后再继续。");
  }
  refreshSessionExpiry(activeVaultSession.autoLock);
  return activeVaultSession;
}

async function ensureSessionFresh() {
  if (!activeVaultSession) {
    return;
  }
  if (activeVaultSession.expiresAt !== null && Date.now() >= activeVaultSession.expiresAt) {
    clearVaultSession();
  }
}

function isSessionUnlocked() {
  if (!activeVaultSession) {
    return false;
  }
  if (activeVaultSession.expiresAt !== null && Date.now() >= activeVaultSession.expiresAt) {
    clearVaultSession();
    return false;
  }
  return true;
}

function armVaultSession(key: CryptoKey, autoLock: PrivateAutoLock) {
  clearVaultSession();
  activeVaultSession = {
    key,
    autoLock,
    expiresAt: null,
    timer: null,
  };
  refreshSessionExpiry(autoLock);
}

function refreshSessionExpiry(autoLock: PrivateAutoLock) {
  if (!activeVaultSession) {
    return;
  }
  if (activeVaultSession.timer) {
    clearTimeout(activeVaultSession.timer);
  }
  const ms = getAutoLockMs(autoLock);
  activeVaultSession.autoLock = autoLock;
  activeVaultSession.expiresAt = ms === null ? null : Date.now() + ms;
  activeVaultSession.timer = ms === null
    ? null
    : setTimeout(() => {
        clearVaultSession();
      }, ms);
}

function clearVaultSession() {
  if (activeVaultSession?.timer) {
    clearTimeout(activeVaultSession.timer);
  }
  activeVaultSession = null;
}

function getAutoLockMs(autoLock: PrivateAutoLock) {
  if (autoLock === "5m") {
    return 5 * 60 * 1000;
  }
  if (autoLock === "15m") {
    return 15 * 60 * 1000;
  }
  if (autoLock === "1h") {
    return 60 * 60 * 1000;
  }
  return null;
}

async function deriveVaultSecrets(passphrase: string, saltBase64: string) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(saltBase64),
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    512,
  );
  const secretBytes = new Uint8Array(bits);
  const encryptionKeyBytes = secretBytes.slice(0, 32);
  const verifierBytes = secretBytes.slice(32);
  const key = await crypto.subtle.importKey(
    "raw",
    encryptionKeyBytes,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  return {
    key,
    verifier: bytesToBase64(verifierBytes),
  };
}

async function encryptPayload(payload: PrivateTaskPayload, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plaintext,
  );
  return {
    algorithm: "AES-GCM" as const,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptPayload(
  encryptedPayload: NonNullable<PrivateCaptureTaskRecord["encryptedPayload"]>,
  key: CryptoKey,
) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: encryptedPayload.algorithm,
      iv: base64ToBytes(encryptedPayload.iv),
    },
    key,
    base64ToBytes(encryptedPayload.ciphertext),
  );
  const decoded = new TextDecoder().decode(plaintext);
  return privateTaskPayloadSchema.parse(JSON.parse(decoded));
}

async function sha256Base64(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64(new Uint8Array(digest));
}

function randomBase64(length: number) {
  const buffer = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64(buffer);
}

function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return hex.match(/.{1,4}/g)?.join("-") ?? hex;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const item of bytes) {
    binary += String.fromCharCode(item);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
