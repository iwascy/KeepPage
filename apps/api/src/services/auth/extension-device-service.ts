import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AuthUser,
  ExtensionConnectInitRequest,
  ExtensionConnectInitResponse,
  ExtensionDevice,
  ExtensionDeviceSession,
} from "@keeppage/domain";
import {
  extensionConnectInitRequestSchema,
  extensionConnectInitResponseSchema,
  extensionDeviceSessionSchema,
} from "@keeppage/domain";
import { HttpError } from "../../lib/http-error";
import type { AuthRepository, ExtensionDeviceRepository } from "../../repositories";

type ExtensionDeviceAuthContext = {
  user: AuthUser;
  device: ExtensionDevice;
};

type PendingConnectCode = {
  code: string;
  userId: string;
  deviceName: string;
  platform: string;
  extensionId?: string;
  expiresAt: string;
  redeemedAt?: string;
};

type ExtensionDeviceServiceOptions = {
  repository: ExtensionDeviceRepository & Pick<AuthRepository, "getUserById">;
};

const CONNECT_CODE_TTL_MS = 5 * 60 * 1000;
const DEVICE_TOKEN_PREFIX = "kpd_";

export class ExtensionDeviceService {
  private readonly repository: ExtensionDeviceRepository & Pick<AuthRepository, "getUserById">;
  private readonly pendingCodes = new Map<string, PendingConnectCode>();

  constructor(options: ExtensionDeviceServiceOptions) {
    this.repository = options.repository;
  }

  createConnectCode(
    userId: string,
    input: ExtensionConnectInitRequest,
  ): ExtensionConnectInitResponse {
    const payload = extensionConnectInitRequestSchema.parse(input);
    this.pruneExpiredCodes();
    const code = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CONNECT_CODE_TTL_MS).toISOString();
    this.pendingCodes.set(code, {
      code,
      userId,
      deviceName: payload.deviceName,
      platform: payload.platform,
      extensionId: payload.extensionId,
      expiresAt,
    });
    return extensionConnectInitResponseSchema.parse({
      code,
      expiresAt,
    });
  }

  async redeemConnectCode(code: string): Promise<ExtensionDeviceSession> {
    const normalizedCode = code.trim();
    const pending = this.pendingCodes.get(normalizedCode);
    if (!pending || pending.redeemedAt) {
      throw new HttpError(401, "ExtensionConnectCodeInvalid", "扩展连接码无效或已使用。");
    }
    if (new Date(pending.expiresAt).getTime() <= Date.now()) {
      this.pendingCodes.delete(normalizedCode);
      throw new HttpError(401, "ExtensionConnectCodeExpired", "扩展连接码已过期，请重新连接。");
    }

    const user = await this.repository.getUserById(pending.userId);
    if (!user) {
      this.pendingCodes.delete(normalizedCode);
      throw new HttpError(401, "Unauthorized", "连接码对应账号不存在。");
    }

    const deviceId = crypto.randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const token = formatDeviceToken(deviceId, secret);
    const device = await this.repository.createExtensionDevice(user.id, {
      id: deviceId,
      name: pending.deviceName,
      platform: pending.platform,
      tokenPreview: buildDeviceTokenPreview(deviceId, secret),
      tokenHash: hashDeviceToken(token),
    });

    pending.redeemedAt = new Date().toISOString();
    this.pendingCodes.delete(normalizedCode);

    return extensionDeviceSessionSchema.parse({
      token,
      device,
      user,
    });
  }

  listDevices(userId: string) {
    return this.repository.listExtensionDevices(userId);
  }

  revokeDevice(userId: string, deviceId: string) {
    return this.repository.revokeExtensionDevice(userId, deviceId);
  }

  async authenticateDevice(rawToken: string): Promise<ExtensionDeviceAuthContext> {
    const { deviceId } = parseDeviceToken(rawToken);
    const stored = await this.repository.getExtensionDeviceAuthRecord(deviceId);
    if (!stored) {
      throw new HttpError(401, "Unauthorized", "扩展设备令牌无效。");
    }

    if (stored.revokedAt) {
      throw new HttpError(401, "ExtensionDeviceRevoked", "扩展设备授权已撤销。");
    }

    if (stored.expiresAt && new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(401, "ExtensionDeviceExpired", "扩展设备授权已过期。");
    }

    assertDeviceTokenMatches(rawToken, stored.tokenHash);
    const user = await this.repository.getUserById(stored.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized", "扩展设备对应用户不存在。");
    }

    const usedAt = new Date().toISOString();
    await this.repository.touchExtensionDevice(stored.id, usedAt);
    return {
      user,
      device: {
        ...stored,
        lastUsedAt: usedAt,
      },
    };
  }

  isDeviceToken(token: string) {
    return isDeviceToken(token);
  }

  private pruneExpiredCodes() {
    const now = Date.now();
    for (const [code, pending] of this.pendingCodes) {
      if (pending.redeemedAt || new Date(pending.expiresAt).getTime() <= now) {
        this.pendingCodes.delete(code);
      }
    }
  }
}

export function isDeviceToken(token: string) {
  return token.startsWith(DEVICE_TOKEN_PREFIX);
}

function parseDeviceToken(token: string) {
  if (!isDeviceToken(token)) {
    throw new HttpError(401, "Unauthorized", "扩展设备令牌格式无效。");
  }

  const content = token.slice(DEVICE_TOKEN_PREFIX.length);
  const separatorIndex = content.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === content.length - 1) {
    throw new HttpError(401, "Unauthorized", "扩展设备令牌格式无效。");
  }

  const deviceId = content.slice(0, separatorIndex);
  const secret = content.slice(separatorIndex + 1);
  if (!deviceId || !secret) {
    throw new HttpError(401, "Unauthorized", "扩展设备令牌格式无效。");
  }
  return {
    deviceId,
    secret,
  };
}

function formatDeviceToken(deviceId: string, secret: string) {
  return `${DEVICE_TOKEN_PREFIX}${deviceId}.${secret}`;
}

function buildDeviceTokenPreview(deviceId: string, secret: string) {
  return `${DEVICE_TOKEN_PREFIX}${deviceId.slice(0, 8)}.${secret.slice(0, 6)}`;
}

function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function assertDeviceTokenMatches(token: string, tokenHash: string) {
  const actualBuffer = Buffer.from(hashDeviceToken(token));
  const expectedBuffer = Buffer.from(tokenHash);
  if (
    actualBuffer.byteLength !== expectedBuffer.byteLength
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new HttpError(401, "Unauthorized", "扩展设备令牌无效。");
  }
}
