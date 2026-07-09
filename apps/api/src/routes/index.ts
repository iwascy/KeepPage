import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ApiTokenService } from "../services/api-tokens/api-token-service";
import type { ExtensionDeviceService } from "../services/auth/extension-device-service";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkBackupService } from "../services/backups/bookmark-backup-service";
import type { PrivateModeService } from "../services/auth/private-mode-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { IconRefreshService } from "../services/icons/icon-refresh-service";
import type { ImportService } from "../services/imports/import-service";
import type { UploadService } from "../services/uploads/upload-service";
import type { ShareService } from "../services/shares/share-service";
import { registerApiTokenRoutes } from "./api-tokens";
import { registerAuthRoutes } from "./auth";
import { registerBackupRoutes } from "./backups";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerFolderRoutes } from "./folders";
import { registerHealthRoutes } from "./health";
import { registerIconRoutes } from "./icons";
import { registerIngestRoutes } from "./ingest";
import { registerImportRoutes } from "./imports";
import { registerPrivateBookmarkRoutes } from "./private-bookmarks";
import { registerPrivateCaptureRoutes } from "./private-captures";
import { registerPrivateModeRoutes } from "./private-mode";
import { registerExtensionDeviceRoutes } from "./extension-devices";
import { registerPublicShareRoutes } from "./public-shares";
import { registerShareRoutes } from "./shares";
import { registerTagRoutes } from "./tags";
import { registerUploadRoutes } from "./uploads";
import { registerWorkspaceRoutes } from "./workspace";
import type { UserResponseCache } from "./http-cache";

export async function registerRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  authService: AuthService,
  privateModeService: PrivateModeService,
  apiTokenService: ApiTokenService,
  extensionDeviceService: ExtensionDeviceService,
  repository: BookmarkRepository,
  bookmarkService: BookmarkService,
  backupService: BookmarkBackupService,
  iconRefreshService: IconRefreshService,
  importService: ImportService,
  uploadService: UploadService,
  shareService: ShareService,
  responseCache: UserResponseCache,
) {
  await registerAuthRoutes(app, authService);
  await registerPrivateModeRoutes(app, authService, privateModeService);
  await registerApiTokenRoutes(app, authService, apiTokenService);
  await registerExtensionDeviceRoutes(app, authService, extensionDeviceService);
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, config, authService, repository, iconRefreshService, responseCache);
  await registerPrivateCaptureRoutes(app, config, authService, privateModeService, repository, iconRefreshService, responseCache);
  await registerIconRoutes(app, authService, iconRefreshService);
  await registerIngestRoutes(app, apiTokenService, repository, responseCache);
  await registerBackupRoutes(app, authService, backupService, responseCache);
  await registerUploadRoutes(app, authService, privateModeService, uploadService);
  await registerWorkspaceRoutes(app, authService, repository, bookmarkService, responseCache);
  await registerBookmarkRoutes(app, authService, bookmarkService, responseCache);
  await registerPrivateBookmarkRoutes(app, authService, privateModeService, bookmarkService, responseCache);
  await registerFolderRoutes(app, authService, repository, responseCache);
  await registerTagRoutes(app, authService, repository, responseCache);
  await registerImportRoutes(app, authService, importService, responseCache);
  await registerShareRoutes(app, authService, shareService);
  await registerPublicShareRoutes(app, shareService);
}
