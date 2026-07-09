import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { type ApiConfig } from "./config";
import { isHttpError } from "./lib/http-error";
import { createRepository } from "./repositories";
import { registerRoutes } from "./routes";
import { ApiTokenService } from "./services/api-tokens/api-token-service";
import { ExtensionDeviceService } from "./services/auth/extension-device-service";
import { AuthService } from "./services/auth/auth-service";
import { PrivateModeService } from "./services/auth/private-mode-service";
import { BookmarkBackupService } from "./services/backups/bookmark-backup-service";
import { R2BookmarkBackupScheduler } from "./services/backups/r2-bookmark-backup-scheduler";
import { BookmarkService } from "./services/bookmarks/bookmark-service";
import { IconRefreshService } from "./services/icons/icon-refresh-service";
import { ImportService } from "./services/imports/import-service";
import { ShareService } from "./services/shares/share-service";
import { UploadService } from "./services/uploads/upload-service";
import { createObjectStorage } from "./storage/object-storage";
import { UserResponseCache } from "./routes/http-cache";

export function buildServer(config: ApiConfig) {
  const app = Fastify({
    bodyLimit: config.UPLOAD_BODY_LIMIT_MB * 1024 * 1024,
    trustProxy: true,
    logger: {
      level: config.LOG_LEVEL,
    },
  });
  app.addContentTypeParser(/^text\/html(?:;.*)?$/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(/^(image|video)\/.+$/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/gzip", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/x-keeppage-package", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  if (config.DEBUG_MODE) {
    registerDebugHooks(app);
  }

  const objectStorage = createObjectStorage(config);
  const repository = createRepository(config, objectStorage);
  const responseCache = new UserResponseCache();
  const apiTokenService = new ApiTokenService({
    repository,
  });
  const extensionDeviceService = new ExtensionDeviceService({
    repository,
  });
  const authService = new AuthService({
    apiTokenService,
    extensionDeviceService,
    config,
    repository,
  });
  const privateModeService = new PrivateModeService({
    config,
    repository,
  });
  const bookmarkService = new BookmarkService({
    repository,
    objectStorage,
  });
  const backupService = new BookmarkBackupService({
    repository,
    objectStorage,
  });
  const r2BookmarkBackupScheduler = new R2BookmarkBackupScheduler({
    config,
    repository,
    backupService,
    logger: app.log,
  });
  const uploadService = new UploadService({
    config,
    repository,
    objectStorage,
  });
  const iconRefreshService = new IconRefreshService({
    repository,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      if (config.DEBUG_MODE) {
        app.log.warn({
          requestId: request.id,
          method: request.method,
          url: request.url,
          issues: error.issues,
          query: request.query,
          params: request.params,
          body: summarizePayload(request.body),
        }, "Validation error");
      }
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
      });
    }

    if (isHttpError(error)) {
      if (config.DEBUG_MODE) {
        app.log.warn({
          requestId: request.id,
          method: request.method,
          url: request.url,
          statusCode: error.statusCode,
          errorCode: error.code,
          details: error.details,
        }, "HTTP error response");
      }
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }

    const safeError = error instanceof Error ? error : new Error("Unknown error");
    app.log.error({
      err: safeError,
      requestId: request.id,
      method: request.method,
      url: request.url,
      query: config.DEBUG_MODE ? request.query : undefined,
      params: config.DEBUG_MODE ? request.params : undefined,
      body: config.DEBUG_MODE ? summarizePayload(request.body) : undefined,
    }, "Unhandled API error");
    return reply.status(500).send({
      error: "InternalServerError",
      message: safeError.message,
    });
  });

  app.get("/", async () => {
    return {
      name: "KeepPage API",
      storage: repository.kind,
    };
  });

  const importService = new ImportService({
    repository,
  });
  const webPublicBaseUrl = resolveWebPublicBaseUrl(config);
  if (config.NODE_ENV === "production" && !webPublicBaseUrl) {
    app.log.warn(
      "WEB_PUBLIC_BASE_URL is not set; share publicUrl will be relative (/s/:token). Configure it for absolute share links from the API.",
    );
  }
  const shareService = new ShareService({
    repository,
    webPublicBaseUrl,
  });

  app.register(async (instance) => {
    await registerRoutes(
      instance,
      config,
      authService,
      privateModeService,
      apiTokenService,
      extensionDeviceService,
      repository,
      bookmarkService,
      backupService,
      iconRefreshService,
      importService,
      uploadService,
      shareService,
      responseCache,
    );
  });

  app.addHook("onReady", async () => {
    r2BookmarkBackupScheduler.start();
  });
  app.addHook("onClose", async () => {
    r2BookmarkBackupScheduler.stop();
  });

  return app;
}

function resolveWebPublicBaseUrl(config: ApiConfig) {
  if (config.WEB_PUBLIC_BASE_URL?.trim()) {
    return config.WEB_PUBLIC_BASE_URL.trim().replace(/\/$/, "");
  }
  if (config.NODE_ENV === "production") {
    // Do NOT fall back to API_PUBLIC_BASE_URL — Web and API are often on different hosts.
    // Empty base yields relative /s/:token; Web clients prefix window.location.origin on copy.
    return "";
  }
  return "http://127.0.0.1:5173";
}

function registerDebugHooks(app: FastifyInstance) {
  app.addHook("preHandler", async (request: FastifyRequest) => {
    request.log.debug({
      requestId: request.id,
      method: request.method,
      url: request.url,
      headers: sanitizeHeaders(request.headers),
      query: request.query,
      params: request.params,
      body: summarizePayload(request.body),
    }, "Incoming request");
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    request.log.debug({
      requestId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTimeMs: Number(reply.elapsedTime.toFixed(1)),
    }, "Request completed");
  });
}

function sanitizeHeaders(headers: Record<string, unknown>) {
  const sanitizedEntries = Object.entries(headers).map(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("authorization") ||
      lowerKey.includes("cookie") ||
      lowerKey.includes("token") ||
      lowerKey.includes("api-key") ||
      lowerKey.includes("secret")
    ) {
      return [key, "[REDACTED]"];
    }
    return [key, summarizePayload(value)];
  });

  return Object.fromEntries(sanitizedEntries);
}

function summarizePayload(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}... (${value.length} chars)` : value;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      byteLength: value.byteLength,
    };
  }
  if (value instanceof Uint8Array) {
    return {
      type: value.constructor.name,
      byteLength: value.byteLength,
    };
  }
  if (Array.isArray(value)) {
    if (value.length > 20) {
      return {
        type: "Array",
        length: value.length,
        preview: value.slice(0, 20),
      };
    }
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("password") ||
      lowerKey.includes("token") ||
      lowerKey.includes("api-key") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("authorization")
    ) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = summarizePayload(entry);
  }
  return next;
}
