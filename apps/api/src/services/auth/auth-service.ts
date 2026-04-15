import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthSession,
  AuthUser,
  ApiTokenScope,
} from "@keeppage/domain";
import {
  authLoginRequestSchema,
  authRegisterRequestSchema,
  authSessionSchema,
} from "@keeppage/domain";
import type { FastifyRequest } from "fastify";
import { promisify } from "node:util";
import type { ApiConfig } from "../../config";
import { HttpError } from "../../lib/http-error";
import type { ApiTokenService } from "../api-tokens/api-token-service";
import type { AuthRepository } from "../../repositories";

const scryptAsync = promisify(nodeScrypt);

type TokenPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

type AuthServiceOptions = {
  apiTokenService: ApiTokenService;
  config: ApiConfig;
  repository: AuthRepository;
};

type RequireUserOptions = {
  allowApiToken?: boolean;
  requiredApiScope?: ApiTokenScope;
};

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly apiTokenService: ApiTokenService;
  private readonly tokenSecret: string;
  private readonly tokenTtlMs: number;

  constructor(options: AuthServiceOptions) {
    this.apiTokenService = options.apiTokenService;
    this.repository = options.repository;
    this.tokenSecret = options.config.AUTH_TOKEN_SECRET;
    this.tokenTtlMs = options.config.AUTH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  async register(input: AuthRegisterRequest): Promise<AuthSession> {
    const payload = authRegisterRequestSchema.parse(input);
    const email = normalizeEmail(payload.email);
    const name = normalizeName(payload.name);
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      throw new HttpError(409, "EmailAlreadyExists", "该邮箱已注册。");
    }

    const passwordHash = await hashPassword(payload.password);
    const user = await this.repository.createUser({
      email,
      name,
      passwordHash,
    });
    return this.createSession(user);
  }

  async login(input: AuthLoginRequest): Promise<AuthSession> {
    const payload = authLoginRequestSchema.parse(input);
    const email = normalizeEmail(payload.email);
    const existing = await this.repository.findUserByEmail(email);
    if (!existing || !existing.passwordHash) {
      throw new HttpError(401, "InvalidCredentials", "邮箱或密码错误。");
    }

    const passwordValid = await verifyPassword(payload.password, existing.passwordHash);
    if (!passwordValid) {
      throw new HttpError(401, "InvalidCredentials", "邮箱或密码错误。");
    }

    return this.createSession(existing.user);
  }

  async requireUser(request: FastifyRequest, options: RequireUserOptions = {}): Promise<AuthUser> {
    const token = readBearerToken(request);
    if (!token) {
      throw new HttpError(401, "Unauthorized", "请先登录。");
    }

    if (options.allowApiToken && isApiToken(token)) {
      const auth = await this.apiTokenService.authenticateToken(token, options.requiredApiScope);
      return auth.user;
    }

    const payload = verifyToken(token, this.tokenSecret);
    if (payload.exp * 1000 <= Date.now()) {
      throw new HttpError(401, "TokenExpired", "登录状态已过期，请重新登录。");
    }

    const user = await this.repository.getUserById(payload.sub);
    if (!user) {
      throw new HttpError(401, "Unauthorized", "当前登录状态无效，请重新登录。");
    }
    return user;
  }

  private createSession(user: AuthUser): AuthSession {
    const now = Date.now();
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + this.tokenTtlMs) / 1000),
    };
    const token = signToken(payload, this.tokenSecret);
    return authSessionSchema.parse({
      token,
      user,
    });
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeName(name?: string) {
  const normalized = name?.trim();
  return normalized ? normalized : undefined;
}

function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function isApiToken(token: string) {
  return token.startsWith("kp_");
}

function signToken(payload: TokenPayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createSignature(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token: string, secret: string): TokenPayload {
  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) {
    throw new HttpError(401, "Unauthorized", "登录令牌格式无效。");
  }

  const expectedSignature = createSignature(encodedPayload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.byteLength !== expectedBuffer.byteLength ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new HttpError(401, "Unauthorized", "登录令牌签名无效。");
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (!payload.sub || !payload.email || !payload.exp) {
      throw new Error("Missing token payload fields.");
    }
    return payload;
  } catch {
    throw new HttpError(401, "Unauthorized", "登录令牌内容无效。");
  }
}

function createSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}
