import {
  captureCompleteRequestSchema,
  captureInitRequestSchema,
  captureInitResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";

const captureCompleteResponseSchema = z.object({
  bookmarkId: z.string().min(1),
  versionId: z.string().min(1),
  createdNewVersion: z.boolean(),
  deduplicated: z.boolean(),
});

export async function registerCaptureRoutes(
  app: FastifyInstance,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  app.post("/captures/init", async (request, reply) => {
    const payload = captureInitRequestSchema.parse(request.body);
    const result = await repository.initCapture(payload);
    const response = captureInitResponseSchema.parse({
      ...result,
      uploadUrl: objectStorage.createUploadUrl(result.objectKey),
    });
    return reply.send(response);
  });

  app.post("/captures/complete", async (request, reply) => {
    const payload = captureCompleteRequestSchema.parse(request.body);
    const result = await repository.completeCapture(payload);
    const response = captureCompleteResponseSchema.parse({
      bookmarkId: result.bookmark.id,
      versionId: result.versionId,
      createdNewVersion: result.createdNewVersion,
      deduplicated: result.deduplicated,
    });
    return reply.send(response);
  });
}
