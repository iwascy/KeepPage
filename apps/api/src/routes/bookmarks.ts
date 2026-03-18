import { bookmarkSearchResponseSchema, qualityGradeSchema } from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BookmarkRepository } from "../repositories";

const searchQuerySchema = z.object({
  q: z.string().optional(),
  quality: qualityGradeSchema.optional(),
  domain: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function registerBookmarkRoutes(
  app: FastifyInstance,
  repository: BookmarkRepository,
) {
  app.get("/bookmarks", async (request, reply) => {
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.searchBookmarks(query);
    const payload = bookmarkSearchResponseSchema.parse(result);
    return reply.send(payload);
  });
}
