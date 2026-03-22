import type { ApiTokenService } from "../lib/api-token-service";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import type { AuthService } from "../lib/auth-service";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";
import { registerApiTokenRoutes } from "./api-tokens";
import { registerAuthRoutes } from "./auth";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerFolderRoutes } from "./folders";
import { registerHealthRoutes } from "./health";
import { registerIngestRoutes } from "./ingest";
import { registerImportRoutes } from "./imports";
import { registerTagRoutes } from "./tags";
import { registerUploadRoutes } from "./uploads";

export async function registerRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  authService: AuthService,
  apiTokenService: ApiTokenService,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  await registerAuthRoutes(app, authService);
  await registerApiTokenRoutes(app, authService, apiTokenService);
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, config, authService, repository, objectStorage);
  await registerIngestRoutes(app, apiTokenService, repository);
  await registerUploadRoutes(app, config, authService, repository, objectStorage);
  await registerBookmarkRoutes(app, authService, repository, objectStorage);
  await registerFolderRoutes(app, authService, repository);
  await registerTagRoutes(app, authService, repository);
  await registerImportRoutes(app, authService, repository);
}
