import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import type { AuthService } from "../lib/auth-service";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";
import { registerAuthRoutes } from "./auth";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerHealthRoutes } from "./health";
import { registerImportRoutes } from "./imports";
import { registerUploadRoutes } from "./uploads";

export async function registerRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  authService: AuthService,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  await registerAuthRoutes(app, authService);
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, config, authService, repository, objectStorage);
  await registerUploadRoutes(app, config, authService, repository, objectStorage);
  await registerBookmarkRoutes(app, authService, repository, objectStorage);
  await registerImportRoutes(app, authService, repository);
}
