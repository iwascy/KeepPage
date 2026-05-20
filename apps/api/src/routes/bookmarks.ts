import {
  bookmarkListViewSchema,
  bookmarkMetadataUpdateRequestSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { UserResponseCache } from "./http-cache";

const searchQuerySchema = z.object({
  q: z.string().optional(),
  quality: qualityGradeSchema.optional(),
  view: bookmarkListViewSchema.optional(),
  domain: z.string().optional(),
  folderId: z.string().min(1).optional(),
  tagId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const statusQuerySchema = z.object({
  url: z.string().url(),
});

const bookmarkParamsSchema = z.object({
  bookmarkId: z.string().min(1),
});

export async function registerBookmarkRoutes(
  app: FastifyInstance,
  authService: AuthService,
  bookmarkService: BookmarkService,
  responseCache: UserResponseCache,
) {
  app.get("/bookmarks", async (request, reply) => {
    const user = await authService.requireUser(request);
    const query = searchQuerySchema.parse(request.query);
    return responseCache.sendJson(request, reply, {
      scope: "bookmarks",
      userId: user.id,
      load: () => bookmarkService.searchBookmarks(user.id, query),
    });
  });

  app.get("/bookmarks/sidebar-stats", async (request, reply) => {
    const user = await authService.requireUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "bookmark-sidebar-stats",
      userId: user.id,
      load: () => bookmarkService.getBookmarkSidebarStats(user.id),
    });
  });

  app.get("/bookmarks/status", async (request, reply) => {
    const user = await authService.requireUser(request);
    const query = statusQuerySchema.parse(request.query);
    return reply.send(await bookmarkService.getBookmarkStatus(user.id, query.url));
  });

  app.get<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    return reply.send(await bookmarkService.getBookmarkDetail(user.id, params.bookmarkId));
  });

  app.delete<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    await bookmarkService.deleteBookmark(user.id, params.bookmarkId);
    responseCache.invalidateUser(user.id);
    return reply.status(204).send();
  });

  app.patch<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId/metadata", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    const body = bookmarkMetadataUpdateRequestSchema.parse(request.body);
    const bookmark = await bookmarkService.updateBookmarkMetadata(user.id, params.bookmarkId, body);
    responseCache.invalidateUser(user.id);
    return reply.send(bookmark);
  });
}
