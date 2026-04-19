import { workspaceBootstrapResponseSchema } from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { TaxonomyRepository } from "../repositories";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: TaxonomyRepository,
  bookmarkService: BookmarkService,
) {
  app.get("/workspace/bootstrap", async (request, reply) => {
    const user = await authService.requireUser(request);
    const [folders, tags, stats] = await Promise.all([
      repository.listFolders(user.id),
      repository.listTags(user.id),
      bookmarkService.getBookmarkSidebarStats(user.id),
    ]);

    return reply.send(workspaceBootstrapResponseSchema.parse({
      folders,
      tags,
      folderCounts: stats.folderCounts,
    }));
  });
}
