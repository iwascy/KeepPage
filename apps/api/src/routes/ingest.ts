import {
  ingestBookmarkRequestSchema,
  ingestBookmarkResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { IngestRepository } from "../repositories";
import type { ApiTokenService } from "../services/api-tokens/api-token-service";
import type { UserResponseCache } from "./http-cache";

export async function registerIngestRoutes(
  app: FastifyInstance,
  apiTokenService: ApiTokenService,
  repository: IngestRepository,
  responseCache: UserResponseCache,
) {
  app.post("/ingest/bookmarks", async (request, reply) => {
    const auth = await apiTokenService.requireScope(request, "bookmark:create");
    const body = ingestBookmarkRequestSchema.parse(request.body);
    const result = await repository.ingestBookmark(auth.user.id, body);
    responseCache.invalidateUser(auth.user.id);
    const payload = ingestBookmarkResponseSchema.parse({
      bookmarkId: result.bookmark.id,
      status: result.status,
      deduplicated: result.deduplicated,
      bookmark: result.bookmark,
    });
    const statusCode = result.status === "created" ? 201 : 200;
    return reply.status(statusCode).send(payload);
  });
}
