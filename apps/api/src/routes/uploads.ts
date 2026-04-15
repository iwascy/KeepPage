import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { UploadService } from "../services/uploads/upload-service";

const uploadParamsSchema = z.object({
  encodedObjectKey: z.string().min(1),
});

const objectQuerySchema = z.object({
  key: z.string().min(1),
});

const uploadChunkParamsSchema = z.object({
  encodedObjectKey: z.string().min(1),
  uploadId: z.string().min(1),
});

export async function registerUploadRoutes(
  app: FastifyInstance,
  authService: AuthService,
  uploadService: UploadService,
) {
  app.get<{ Querystring: { key: string } }>(
    "/objects",
    async (request, reply) => {
      const user = await authService.requireUser(request);
      const query = objectQuerySchema.parse(request.query);
      const result = await uploadService.getObject(user.id, query.key);
      reply.header("content-type", result.contentType);
      return reply.send(result.body);
    },
  );

  app.get<{ Params: { encodedObjectKey: string } }>(
    "/objects/:encodedObjectKey",
    async (request, reply) => {
      const user = await authService.requireUser(request);
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      const result = await uploadService.getObject(user.id, objectKey);
      reply.header("content-type", result.contentType);
      return reply.send(result.body);
    },
  );

  app.put<{ Params: { encodedObjectKey: string }; Body: Buffer }>(
    "/uploads/:encodedObjectKey",
    async (request, reply) => {
      const user = await authService.requireUser(request, {
        allowApiToken: true,
        requiredApiScope: "bookmark:create",
      });
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      await uploadService.uploadObject({
        userId: user.id,
        objectKey,
        body: request.body,
        headers: request.headers,
      });
      return reply.status(204).send();
    },
  );

  app.put<{ Params: { encodedObjectKey: string; uploadId: string }; Body: Buffer }>(
    "/uploads/:encodedObjectKey/chunks/:uploadId",
    async (request, reply) => {
      const user = await authService.requireUser(request, {
        allowApiToken: true,
        requiredApiScope: "bookmark:create",
      });
      const params = uploadChunkParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      const result = await uploadService.uploadChunk({
        userId: user.id,
        objectKey,
        uploadId: params.uploadId,
        body: request.body,
        headers: request.headers,
      });

      if (result.statusCode === 202) {
        return reply.status(202).send(result.payload);
      }

      return reply.status(204).send();
    },
  );
}
