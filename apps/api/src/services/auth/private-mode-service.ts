import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyRequest } from "fastify";
import {
  privateModeSetupRequestSchema,
  privateModeUnlockRequestSchema,
  privateModeUnlockResponseSchema,
  privateVaultSummarySchema,
} from "@keeppage/domain";
import type { ApiConfig } from "../../config";
import { HttpError } from "../../lib/http-error";
import type { PrivateModeRepository } from "../../repositories";

const scryptAsync = promisify(nodeScrypt);
const PRIVATE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const PRIVATE_MODE_TOKEN_HEADER = "x-keeppage-private-token";

type PrivateTokenPayload = {
  sub: string;
  kind: "private-mode";
  iat: number;
  exp: number;
};

type PrivateModeServiceOptions = {
  config: ApiConfig;
  repository: PrivateModeRepository;
};

export class PrivateModeService {
  private readonly repository: PrivateModeRepository;
  private readonly tokenSecret: string;

  constructor(options: PrivateModeServiceOptions) {
    this.repository = options.repository;
    this.tokenSecret = `${options.config.AUTH_TOKEN_SECRET}:private-mode`;
  }

  async getStatus(userId: string, privateToken?: string) {
    const summary = await this.repository.getPrivateVaultSummary(userId);
    return privateVaultSummarySchema.parse({
      ...summary,
      unlocked: privateToken ? this.isPrivateTokenValid(privateToken, userId) : false,
    });
  }

  async setup(userId: string, input: unknown) {
    const payload = privateModeSetupRequestSchema.parse(input);
    const passwordHash = await hashPassword(payload.password);
    await this.repository.enablePrivateMode({
      userId,
      passwordHash,
      passwordAlgo: "scrypt",
    });

    return this.createUnlockResponse(userId);
  }

  async unlock(userId: string, input: unknown) {
    const payload = privateModeUnlockRequestSchema.parse(input);
    const config = await this.repository.getPrivateModeConfig(userId);
    if (!config) {
      throw new HttpError(404, "PrivateModeNotEnabled", "请先启用私密模式。");
    }
    const valid = await verifyPassword(payload.password, config.passwordHash);
    if (!valid) {
      throw new HttpError(401, "PrivateModeInvalidPassword", "私密模式密码错误。");
    }
    return this.createUnlockResponse(userId);
  }

  requireUnlocked(request: FastifyRequest, userId: string) {
    const privateToken = readPrivateToken(request);
    if (!privateToken || !this.isPrivateTokenValid(privateToken, userId)) {
      throw new HttpError(401, "PrivateModeLocked", "请先输入私密模式密码。");
    }
    return privateToken;
  }

  private async createUnlockResponse(userId: string) {
    const privateToken = this.createPrivateToken(userId);
    const summary = await this.getStatus(userId, privateToken);
    return privateModeUnlockResponseSchema.parse({
      summary,
      privateToken,
    });
  }

  private createPrivateToken(userId: string) {
    const now = Date.now();
    const payload: PrivateTokenPayload = {
      sub: userId,
      kind: "private-mode",
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + PRIVATE_TOKEN_TTL_MS) / 1000),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createSignature(encodedPayload, this.tokenSecret);
    return `${encodedPayload}.${signature}`;
  }

  private isPrivateTokenValid(token: string, userId: string) {
    try {
      const payload = verifyPrivateToken(token, this.tokenSecret);
      return payload.sub === userId && payload.kind === "private-mode" && payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, encodedHash] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedHash) {
    return false;
  }

  const expected = Buffer.from(encodedHash, "base64url");
  const actual = await scryptAsync(password, salt, expected.byteLength) as Buffer;
  if (actual.byteLength !== expected.byteLength) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

function readPrivateToken(request: FastifyRequest) {
  const header = request.headers[PRIVATE_MODE_TOKEN_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.trim() || "";
}

function verifyPrivateToken(token: string, secret: string): PrivateTokenPayload {
  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) {
    throw new Error("Invalid private token.");
  }

  const expectedSignature = createSignature(encodedPayload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.byteLength !== expectedBuffer.byteLength ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid private token signature.");
  }

  return JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as PrivateTokenPayload;
}

function createSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}
