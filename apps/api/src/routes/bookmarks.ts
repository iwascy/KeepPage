import {
  bookmarkListViewSchema,
  bookmarkMetadataUpdateRequestSchema,
  bookmarkDetailResponseSchema,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  qualityGradeSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth-service";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";

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
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  app.get("/bookmarks", async (request, reply) => {
    const user = await authService.requireUser(request);
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.searchBookmarks(user.id, query);
    const payload = bookmarkSearchResponseSchema.parse(result);
    return reply.send(payload);
  });

  app.get<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    const detail = await repository.getBookmarkDetail(user.id, params.bookmarkId);
    if (!detail) {
      return reply.status(404).send({
        error: "BookmarkNotFound",
        message: "Bookmark not found.",
      });
    }

    const versions = await Promise.all(
      detail.versions.map(async (version) => {
        const [objectStat, readerObjectStat] = await Promise.all([
          objectStorage.statObject(version.htmlObjectKey),
          version.readerHtmlObjectKey
            ? objectStorage.statObject(version.readerHtmlObjectKey)
            : Promise.resolve(null),
        ]);
        return {
          ...version,
          archiveAvailable: objectStat !== null,
          archiveSizeBytes: objectStat?.size,
          readerArchiveAvailable: readerObjectStat !== null,
          readerArchiveSizeBytes: readerObjectStat?.size,
        };
      }),
    );

    const payload = bookmarkDetailResponseSchema.parse({
      bookmark: detail.bookmark,
      versions,
    });
    return reply.send(payload);
  });

  app.delete<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    const detail = await repository.getBookmarkDetail(user.id, params.bookmarkId);
    if (!detail) {
      return reply.status(404).send({
        error: "BookmarkNotFound",
        message: "Bookmark not found.",
      });
    }

    const deleted = await repository.deleteBookmark(user.id, params.bookmarkId);
    if (!deleted) {
      return reply.status(404).send({
        error: "BookmarkNotFound",
        message: "Bookmark not found.",
      });
    }

    await Promise.allSettled(
      detail.versions.flatMap((version) => (
        [
          objectStorage.deleteObject(version.htmlObjectKey),
          version.readerHtmlObjectKey
            ? objectStorage.deleteObject(version.readerHtmlObjectKey)
            : Promise.resolve(),
          ...(version.mediaFiles ?? []).map((mediaFile) => objectStorage.deleteObject(mediaFile.objectKey)),
        ]
      )),
    );

    return reply.status(204).send();
  });

  app.patch<{ Params: { bookmarkId: string } }>("/bookmarks/:bookmarkId/metadata", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = bookmarkParamsSchema.parse(request.params);
    const body = bookmarkMetadataUpdateRequestSchema.parse(request.body);
    const bookmark = await repository.updateBookmarkMetadata(user.id, params.bookmarkId, body);
    if (!bookmark) {
      return reply.status(404).send({
        error: "BookmarkNotFound",
        message: "Bookmark not found.",
      });
    }

    return reply.send(bookmarkSchema.parse(bookmark));
  });
}
