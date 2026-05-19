import { workspaceBootstrapResponseSchema } from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { TaxonomyRepository } from "../repositories";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { UserResponseCache } from "./http-cache";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: TaxonomyRepository,
  bookmarkService: BookmarkService,
  responseCache: UserResponseCache,
) {
  app.get("/workspace/bootstrap", async (request, reply) => {
    const user = await authService.requireUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "workspace-bootstrap",
      userId: user.id,
      load: async () => {
        const [folders, tags, stats] = await Promise.all([
          repository.listFolders(user.id),
          repository.listTags(user.id),
          bookmarkService.getBookmarkSidebarStats(user.id),
        ]);

        return workspaceBootstrapResponseSchema.parse({
          folders,
          tags,
          folderCounts: stats.folderCounts,
        });
      },
    });
  });
}
