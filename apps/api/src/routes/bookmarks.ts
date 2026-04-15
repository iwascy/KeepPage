import {
  bookmarkListViewSchema,
  bookmarkMetadataUpdateRequestSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";

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

const bookmarkParamsSchema = z.object({
  bookmarkId: z.string().min(1),
});

export async function registerBookmarkRoutes(
  app: FastifyInstance,
  authService: AuthService,
  bookmarkService: BookmarkService,
) {
  app.get("/bookmarks", async (request, reply) => {
    const user = await authService.requireUser(request);
    const query = searchQuerySchema.parse(request.query);
    return reply.send(await bookmarkService.searchBookmarks(user.id, query));
  });

  app.get("/bookmarks/sidebar-stats", async (request, reply) => {
    const user = await authService.requireUser(request);
    return reply.send(await bookmarkService.getBookmarkSidebarStats(user.id));
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
    return reply.status(204).send();
  });

  app.patch<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId/metadata", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    const body = bookmarkMetadataUpdateRequestSchema.parse(request.body);
    return reply.send(await bookmarkService.updateBookmarkMetadata(user.id, params.bookmarkId, body));
  });
}
