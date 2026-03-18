import {
  bookmarkDetailResponseSchema,
  bookmarkSearchResponseSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";

const searchQuerySchema = z.object({
  q: z.string().optional(),
  quality: qualityGradeSchema.optional(),
  domain: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const bookmarkParamsSchema = z.object({
  bookmarkId: z.string().min(1),
});

export async function registerBookmarkRoutes(
  app: FastifyInstance,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  app.get("/bookmarks", async (request, reply) => {
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.searchBookmarks(query);
    const payload = bookmarkSearchResponseSchema.parse(result);
    return reply.send(payload);
  });

  app.get<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId", async (request, reply) => {
    const params = bookmarkParamsSchema.parse(request.params);
    const detail = await repository.getBookmarkDetail(params.bookmarkId);
    if (!detail) {
      return reply.status(404).send({
        error: "BookmarkNotFound",
        message: "Bookmark not found.",
      });
    }

    const versions = await Promise.all(
      detail.versions.map(async (version) => {
        const objectStat = await objectStorage.statObject(version.htmlObjectKey);
        return {
          ...version,
          archiveAvailable: objectStat !== null,
          archiveSizeBytes: objectStat?.size,
        };
      }),
    );

    const payload = bookmarkDetailResponseSchema.parse({
      bookmark: detail.bookmark,
      versions,
    });
    return reply.send(payload);
  });
}
