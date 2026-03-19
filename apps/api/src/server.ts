import Fastify from "fastify";
import { ZodError } from "zod";
import { type ApiConfig } from "./config";
import { AuthService } from "./lib/auth-service";
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

  const objectStorage = createObjectStorage(config);
  const repository = createRepository(config, objectStorage);
  const authService = new AuthService({
    config,
    repository,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
      });
    }

    if (isHttpError(error)) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }

    const safeError = error instanceof Error ? error : new Error("Unknown error");
    app.log.error({ err: safeError }, "Unhandled API error");
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

  app.register(async (instance) => {
    await registerRoutes(instance, config, authService, repository, objectStorage);
  });

  return app;
}
