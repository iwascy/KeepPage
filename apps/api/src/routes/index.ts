import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ApiTokenService } from "../services/api-tokens/api-token-service";
import type { AuthService } from "../services/auth/auth-service";
import type { PrivateModeService } from "../services/auth/private-mode-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { CloudArchiveManager } from "../services/cloud-archive/cloud-archive-manager";
import type { ImportService } from "../services/imports/import-service";
import type { UploadService } from "../services/uploads/upload-service";
import { registerApiTokenRoutes } from "./api-tokens";
import { registerAuthRoutes } from "./auth";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerCloudArchiveRoutes } from "./cloud-archive";
import { registerFolderRoutes } from "./folders";
import { registerHealthRoutes } from "./health";
import { registerIngestRoutes } from "./ingest";
import { registerImportRoutes } from "./imports";
import { registerPrivateBookmarkRoutes } from "./private-bookmarks";
import { registerPrivateCaptureRoutes } from "./private-captures";
import { registerPrivateModeRoutes } from "./private-mode";
import { registerTagRoutes } from "./tags";
import { registerUploadRoutes } from "./uploads";
import { registerWorkspaceRoutes } from "./workspace";

export async function registerRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  authService: AuthService,
  privateModeService: PrivateModeService,
  apiTokenService: ApiTokenService,
  repository: BookmarkRepository,
  cloudArchiveManager: CloudArchiveManager | null,
  bookmarkService: BookmarkService,
  importService: ImportService,
  uploadService: UploadService,
) {
  await registerAuthRoutes(app, authService);
  await registerPrivateModeRoutes(app, authService, privateModeService);
  await registerApiTokenRoutes(app, authService, apiTokenService);
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, config, authService, repository);
  await registerPrivateCaptureRoutes(app, config, authService, privateModeService, repository);
  await registerIngestRoutes(app, apiTokenService, repository);
  await registerUploadRoutes(app, authService, privateModeService, uploadService);
  await registerWorkspaceRoutes(app, authService, repository, bookmarkService);
  await registerBookmarkRoutes(app, authService, bookmarkService);
  await registerPrivateBookmarkRoutes(app, authService, privateModeService, bookmarkService);
  await registerFolderRoutes(app, authService, repository);
  await registerTagRoutes(app, authService, repository);
  await registerImportRoutes(app, authService, importService);
  if (cloudArchiveManager) {
    await registerCloudArchiveRoutes(app, authService, cloudArchiveManager);
  }
}
