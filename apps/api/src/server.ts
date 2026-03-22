import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { type ApiConfig } from "./config";
import { ApiTokenService } from "./lib/api-token-service";
import { AuthService } from "./lib/auth-service";
import { CloudArchiveManager } from "./lib/cloud-archive-manager";
import { isHttpError } from "./lib/http-error";
import { createRepository } from "./repositories";
import { registerRoutes } from "./routes";
import { createObjectStorage } from "./storage/object-storage";

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
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  if (config.DEBUG_MODE) {
    registerDebugHooks(app);
  }

  const objectStorage = createObjectStorage(config);
  const repository = createRepository(config, objectStorage);
  const authService = new AuthService({
    config,
    repository,
  });
  const apiTokenService = new ApiTokenService({
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

  const cloudArchiveManager = config.CLOUD_ARCHIVE_ENABLED
    ? new CloudArchiveManager(config, repository, objectStorage)
    : null;

  app.register(async (instance) => {
    await registerRoutes(instance, config, authService, apiTokenService, repository, objectStorage, cloudArchiveManager);
  });

  return app;
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
