import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ApiTokenCreateRequest,
  ApiTokenCreateResponse,
  ApiTokenScope,
  AuthUser,
} from "@keeppage/domain";
import { apiTokenCreateResponseSchema } from "@keeppage/domain";
import type { FastifyRequest } from "fastify";
import { HttpError } from "../../lib/http-error";
import type { ApiTokenRepository, AuthRepository } from "../../repositories";

type ApiTokenAuthContext = {
  user: AuthUser;
  tokenId: string;
};

type ApiTokenServiceOptions = {
  repository: ApiTokenRepository & Pick<AuthRepository, "getUserById">;
};

export class ApiTokenService {
  private readonly repository: ApiTokenRepository & Pick<AuthRepository, "getUserById">;

  constructor(options: ApiTokenServiceOptions) {
    this.repository = options.repository;
  }

  async createToken(userId: string, input: ApiTokenCreateRequest): Promise<ApiTokenCreateResponse> {
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(400, "InvalidApiTokenExpiry", "API token 过期时间必须晚于当前时间。");
    }

    const tokenId = crypto.randomUUID();
    const secret = randomBytes(24).toString("base64url");
    const token = formatApiToken(tokenId, secret);
    const item = await this.repository.createApiToken(userId, {
      id: tokenId,
      name: input.name,
      tokenPreview: buildTokenPreview(tokenId, secret),
      tokenHash: hashApiToken(token),
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    });

    return apiTokenCreateResponseSchema.parse({
      token,
      item,
    });
  }

  async listTokens(userId: string) {
    return this.repository.listApiTokens(userId);
  }

  async revokeToken(userId: string, tokenId: string) {
    return this.repository.revokeApiToken(userId, tokenId);
  }

  async authenticateToken(
    rawToken: string,
    requiredScope?: ApiTokenScope,
  ): Promise<ApiTokenAuthContext> {
    const { tokenId } = parseApiToken(rawToken);
    const stored = await this.repository.getApiTokenAuthRecord(tokenId);
    if (!stored) {
      throw new HttpError(401, "Unauthorized", "API token 无效。");
    }

    if (stored.revokedAt) {
      throw new HttpError(401, "ApiTokenRevoked", "API token 已被吊销。");
    }

    if (stored.expiresAt && new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(401, "ApiTokenExpired", "API token 已过期。");
    }

    if (requiredScope && !stored.scopes.includes(requiredScope)) {
      throw new HttpError(403, "InsufficientScope", "API token 权限不足。");
    }

    assertTokenMatches(rawToken, stored.tokenHash);

    const user = await this.repository.getUserById(stored.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized", "API token 对应用户不存在。");
    }

    await this.repository.touchApiToken(stored.id, new Date().toISOString());
    return {
      user,
      tokenId: stored.id,
    };
  }

  async requireScope(request: FastifyRequest, scope: ApiTokenScope): Promise<ApiTokenAuthContext> {
    const rawToken = readApiToken(request);
    if (!rawToken) {
      throw new HttpError(401, "Unauthorized", "缺少 API token。");
    }

    return this.authenticateToken(rawToken, scope);
  }
}

function readApiToken(request: FastifyRequest) {
  const headerValue = getHeaderValue(request.headers["x-keeppage-api-key"]);
  if (headerValue) {
    return headerValue;
  }

  const authorization = getHeaderValue(request.headers.authorization);
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function getHeaderValue(header: string | string[] | undefined) {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.trim() || undefined;
}

function parseApiToken(token: string) {
  if (!token.startsWith("kp_")) {
    throw new HttpError(401, "Unauthorized", "API token 格式无效。");
  }

  const content = token.slice(3);
  const separatorIndex = content.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === content.length - 1) {
    throw new HttpError(401, "Unauthorized", "API token 格式无效。");
  }

  const tokenId = content.slice(0, separatorIndex);
  const secret = content.slice(separatorIndex + 1);
  if (!tokenId || !secret) {
    throw new HttpError(401, "Unauthorized", "API token 格式无效。");
  }

  return {
    tokenId,
    secret,
  };
}

function formatApiToken(tokenId: string, secret: string) {
  return `kp_${tokenId}.${secret}`;
}

function buildTokenPreview(tokenId: string, secret: string) {
  return `kp_${tokenId.slice(0, 8)}.${secret.slice(0, 6)}`;
}

function hashApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function assertTokenMatches(token: string, tokenHash: string) {
  const actualBuffer = Buffer.from(hashApiToken(token));
  const expectedBuffer = Buffer.from(tokenHash);
  if (
    actualBuffer.byteLength !== expectedBuffer.byteLength
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new HttpError(401, "Unauthorized", "API token 无效。");
  }
}
