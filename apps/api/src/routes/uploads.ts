import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import { PrivateModeService } from "../services/auth/private-mode-service";
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
  privateModeService: PrivateModeService,
  uploadService: UploadService,
) {
  app.get<{ Querystring: { key: string } }>(
    "/public/objects",
    async (request, reply) => {
      const query = objectQuerySchema.parse(request.query);
      if (!isPublicAssetObjectKey(query.key)) {
        return reply.status(404).send({
          error: "ObjectNotFound",
          message: "Object not found.",
        });
      }
      const result = await uploadService.getPublicObject(query.key);
      if (result.publicUrl) {
        return reply.redirect(result.publicUrl, 302);
      }
      reply.header("content-type", result.contentType);
      reply.header("cache-control", cacheControlForObjectKey(query.key));
      return reply.send(result.body);
    },
  );

  app.get<{ Querystring: { key: string } }>(
    "/objects",
    async (request, reply) => {
      const user = await authService.requireUser(request);
      const query = objectQuerySchema.parse(request.query);
      if (isPrivateObjectKey(query.key)) {
        privateModeService.requireUnlocked(request, user.id);
      }
      const result = await uploadService.getObject(user.id, query.key);
      if (result.publicUrl) {
        return reply.redirect(result.publicUrl, 302);
      }
      reply.header("content-type", result.contentType);
      reply.header("cache-control", cacheControlForObjectKey(query.key));
      return reply.send(result.body);
    },
  );

  app.get<{ Params: { encodedObjectKey: string } }>(
    "/objects/:encodedObjectKey",
    async (request, reply) => {
      const user = await authService.requireUser(request);
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      if (isPrivateObjectKey(objectKey)) {
        privateModeService.requireUnlocked(request, user.id);
      }
      const result = await uploadService.getObject(user.id, objectKey);
      if (result.publicUrl) {
        return reply.redirect(result.publicUrl, 302);
      }
      reply.header("content-type", result.contentType);
      reply.header("cache-control", cacheControlForObjectKey(objectKey));
      return reply.send(result.body);
    },
  );

  app.put<{ Params: { encodedObjectKey: string }; Body: Buffer }>(
    "/uploads/:encodedObjectKey",
    async (request, reply) => {
      const user = await authService.requireUser(request, {
        allowApiToken: true,
        allowExtensionDevice: true,
        requiredApiScope: "bookmark:create",
      });
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      if (isPrivateObjectKey(objectKey)) {
        privateModeService.requireUnlocked(request, user.id);
      }
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
        allowExtensionDevice: true,
        requiredApiScope: "bookmark:create",
      });
      const params = uploadChunkParamsSchema.parse(request.params);
      const objectKey = uploadService.decodeObjectKey(params.encodedObjectKey);
      if (isPrivateObjectKey(objectKey)) {
        privateModeService.requireUnlocked(request, user.id);
      }
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

function isPrivateObjectKey(objectKey: string) {
  return objectKey.startsWith("private-captures/");
}

function isPublicAssetObjectKey(objectKey: string) {
  return !isPrivateObjectKey(objectKey) && /\.(avif|gif|jpe?g|png|svg|webp|mp4|webm|mov)$/i.test(objectKey);
}

function cacheControlForObjectKey(objectKey: string) {
  return isPublicAssetObjectKey(objectKey)
    ? "public, max-age=31536000, immutable"
    : "private, max-age=0, no-store";
}
