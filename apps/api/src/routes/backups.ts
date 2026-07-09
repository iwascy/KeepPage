import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkBackupService } from "../services/backups/bookmark-backup-service";
import type { UserResponseCache } from "./http-cache";

export async function registerBackupRoutes(
  app: FastifyInstance,
  authService: AuthService,
  backupService: BookmarkBackupService,
  responseCache: UserResponseCache,
) {
  app.get("/backups/bookmarks/export", async (request, reply) => {
    const user = await authService.requireUser(request);
    const result = await backupService.exportUserBookmarks(user);
    reply.header("content-type", "application/x-keeppage-package");
    reply.header("content-disposition", `attachment; filename="${result.fileName}"`);
    reply.header("x-keeppage-backup-format", result.manifest.format);
    reply.header("x-keeppage-backup-version", String(result.manifest.version));
    return reply.send(result.body);
  });

  app.post<{ Body: Buffer }>("/backups/bookmarks/import/preview", async (request, reply) => {
    const user = await authService.requireUser(request);
    return reply.send(await backupService.previewImportPackage(user.id, request.body));
  });

  app.post<{ Body: Buffer }>("/backups/bookmarks/import", async (request, reply) => {
    const user = await authService.requireUser(request);
    const result = await backupService.importPackage(user.id, request.body);
    responseCache.invalidateUser(user.id);
    return reply.send(result);
  });
}
