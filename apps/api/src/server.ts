import Fastify from "fastify";
import { ZodError } from "zod";
import { type ApiConfig } from "./config";
import { createRepository } from "./repositories";
import { registerRoutes } from "./routes";

export function buildServer(config: ApiConfig) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });
  const repository = createRepository(config);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
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
    await registerRoutes(instance, repository);
  });

  return app;
}
