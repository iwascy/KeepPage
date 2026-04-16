import {
  bookmarkListViewSchema,
  privateBookmarkDetailResponseSchema,
  privateBookmarkSearchResponseSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import { PrivateModeService } from "../services/auth/private-mode-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";

const searchQuerySchema = z.object({
  q: z.string().optional(),
  quality: qualityGradeSchema.optional(),
  view: bookmarkListViewSchema.optional(),
  domain: z.string().optional(),
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
) {
  app.get("/private/bookmarks", async (request, reply) => {
    const user = await authService.requireUser(request);
    privateModeService.requireUnlocked(request, user.id);
    const query = searchQuerySchema.parse(request.query);
    return reply.send(privateBookmarkSearchResponseSchema.parse(
      await bookmarkService.searchPrivateBookmarks(user.id, query),
    ));
  });

  app.get<{ Params: { bookmarkId: string } }>("/private/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await authService.requireUser(request);
    privateModeService.requireUnlocked(request, user.id);
    const params = bookmarkParamsSchema.parse(request.params);
    return reply.send(privateBookmarkDetailResponseSchema.parse(
      await bookmarkService.getPrivateBookmarkDetail(user.id, params.bookmarkId),
    ));
  });
}
