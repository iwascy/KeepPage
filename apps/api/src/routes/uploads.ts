import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObjectStorage } from "../storage/object-storage";

const uploadParamsSchema = z.object({
  encodedObjectKey: z.string().min(1),
});

export async function registerUploadRoutes(
  app: FastifyInstance,
  objectStorage: ObjectStorage,
) {
  app.get<{ Params: { encodedObjectKey: string } }>(
    "/objects/:encodedObjectKey",
    async (request, reply) => {
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = decodeObjectKey(params.encodedObjectKey);
      if (!(await objectStorage.hasObject(objectKey))) {
        return reply.status(404).send({
          error: "ObjectNotFound",
          message: "Object not found.",
        });
      }

      const body = await objectStorage.readObject(objectKey);
      reply.header("content-type", guessContentType(objectKey));
      return reply.send(body);
    },
  );

  app.put<{ Params: { encodedObjectKey: string }; Body: Buffer }>(
    "/uploads/:encodedObjectKey",
    async (request, reply) => {
      const params = uploadParamsSchema.parse(request.params);
      const objectKey = decodeObjectKey(params.encodedObjectKey);
      const body = toBuffer(request.body);
      if (body.byteLength === 0) {
        return reply.status(400).send({
          error: "EmptyUploadBody",
          message: "Upload body is empty.",
        });
      }

      await objectStorage.putObject(objectKey, body, {
        contentType: request.headers["content-type"],
      });
      return reply.status(204).send();
    },
  );
}

function decodeObjectKey(encodedObjectKey: string) {
  try {
    const objectKey = decodeURIComponent(encodedObjectKey);
    if (!objectKey) {
      throw new Error("Object key is empty.");
    }
    return objectKey;
  } catch {
    throw new Error("Invalid upload object key.");
  }
}

function toBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  return Buffer.alloc(0);
}

function guessContentType(objectKey: string) {
  if (objectKey.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (objectKey.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}
