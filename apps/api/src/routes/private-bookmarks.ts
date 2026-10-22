import {
  bookmarkListViewSchema,
  privateBookmarkDetailResponseSchema,
  privateBookmarkMetadataUpdateRequestSchema,
  privateBookmarkSearchResponseSchema,
  privateBookmarkSidebarStatsResponseSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import { PrivateModeService } from "../services/auth/private-mode-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { UserResponseCache } from "./http-cache";

const searchQuerySchema = z.object({
  q: z.string().optional(),
  quality: qualityGradeSchema.optional(),
  view: bookmarkListViewSchema.optional(),
  domain: z.string().optional(),
  folderId: z.string().min(1).optional(),
  tagId: z.string().min(1).optional(),
  sort: z.enum(["created", "updated", "title", "relevance"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const bookmarkParamsSchema = z.object({
  bookmarkId: z.string().min(1),
});

export async function registerPrivateBookmarkRoutes(
  app: FastifyInstance,
  authService: AuthService,
  privateModeService: PrivateModeService,
  bookmarkService: BookmarkService,
  responseCache: UserResponseCache,
) {
  const requirePrivateUser = async (request: FastifyRequest) => {
    const user = await authService.requireUser(request, {
      allowExtensionDevice: true,
    });
    await privateModeService.requireUnlocked(request, user.id);
    return user;
  };

  app.get("/private/bookmarks", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const query = searchQuerySchema.parse(request.query);
    return responseCache.sendJson(request, reply, {
      scope: "private-bookmarks",
      userId: user.id,
      load: async () => privateBookmarkSearchResponseSchema.parse(
        await bookmarkService.searchPrivateBookmarks(user.id, query),
      ),
    });
  });

  app.get("/private/bookmarks/sidebar-stats", async (request, reply) => {
    const user = await requirePrivateUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "private-bookmark-sidebar-stats",
      userId: user.id,
      load: async () => privateBookmarkSidebarStatsResponseSchema.parse(
        await bookmarkService.getPrivateBookmarkSidebarStats(user.id),
      ),
    });
  });

  app.get<{ Params: { bookmarkId: string } }>("/private/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    return reply.send(privateBookmarkDetailResponseSchema.parse(
      await bookmarkService.getPrivateBookmarkDetail(user.id, params.bookmarkId),
    ));
  });

  app.patch<{ Params: { bookmarkId: string } }>(
    "/private/bookmarks/:bookmarkId/metadata",
    async (request, reply) => {
      const user = await requirePrivateUser(request);
      const params = bookmarkParamsSchema.parse(request.params);
      const body = privateBookmarkMetadataUpdateRequestSchema.parse(request.body);
      const bookmark = await bookmarkService.updatePrivateBookmarkMetadata(user.id, params.bookmarkId, body);
      responseCache.invalidateUser(user.id);
      return reply.send(bookmark);
    },
  );

  app.delete<{ Params: { bookmarkId: string } }>("/private/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    await bookmarkService.deletePrivateBookmark(user.id, params.bookmarkId);
    responseCache.invalidateUser(user.id);
    return reply.status(204).send();
  });
}
