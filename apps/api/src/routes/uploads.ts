import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import { z } from "zod";
import type { ObjectStorage } from "../storage/object-storage";

const gunzipAsync = promisify(gunzip);

const uploadParamsSchema = z.object({
  encodedObjectKey: z.string().min(1),
});

const uploadChunkParamsSchema = z.object({
  encodedObjectKey: z.string().min(1),
  uploadId: z.string().min(1),
});

export async function registerUploadRoutes(
  app: FastifyInstance,
  config: ApiConfig,
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
      const body = await decodeUploadBody(request.body, request.headers["content-encoding"]);
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

  app.put<{ Params: { encodedObjectKey: string; uploadId: string }; Body: Buffer }>(
    "/uploads/:encodedObjectKey/chunks/:uploadId",
    async (request, reply) => {
      const params = uploadChunkParamsSchema.parse(request.params);
      const objectKey = decodeObjectKey(params.encodedObjectKey);
      const chunk = toBuffer(request.body);
      if (chunk.byteLength === 0) {
        return reply.status(400).send({
          error: "EmptyUploadBody",
          message: "Upload chunk body is empty.",
        });
      }

      const offsetHeader = parseRequiredIntegerHeader(
        request.headers["x-keeppage-upload-offset"],
        "x-keeppage-upload-offset",
      );
      if ("error" in offsetHeader) {
        return reply.status(400).send({
          error: "InvalidUploadHeader",
          message: offsetHeader.error,
        });
      }

      const totalSizeHeader = parseOptionalIntegerHeader(
        request.headers["x-keeppage-upload-total-size"],
        "x-keeppage-upload-total-size",
      );
      if ("error" in totalSizeHeader) {
        return reply.status(400).send({
          error: "InvalidUploadHeader",
          message: totalSizeHeader.error,
        });
      }

      const offset = offsetHeader.value;
      const totalSize = totalSizeHeader.value;
      const isComplete = parseBooleanHeader(request.headers["x-keeppage-upload-complete"]);
      const contentType = getHeaderValue(request.headers["x-keeppage-upload-content-type"])
        ?? request.headers["content-type"];
      const contentEncoding = getHeaderValue(request.headers["x-keeppage-upload-content-encoding"]);
      const tempPath = resolveChunkUploadPath(config, objectKey, params.uploadId);

      await mkdir(path.dirname(tempPath), { recursive: true });
      const existingSize = await getFileSize(tempPath);
      if (existingSize !== offset) {
        return reply.status(409).send({
          error: "UploadOffsetMismatch",
          expectedOffset: existingSize,
          receivedOffset: offset,
        });
      }

      await appendFile(tempPath, chunk);
      const receivedBytes = existingSize + chunk.byteLength;

      if (!isComplete) {
        return reply.status(202).send({
          uploadId: params.uploadId,
          receivedBytes,
        });
      }

      if (totalSize !== undefined && totalSize !== receivedBytes) {
        return reply.status(409).send({
          error: "UploadSizeMismatch",
          expectedSize: totalSize,
          receivedBytes,
        });
      }

      const assembled = await readFile(tempPath);
      const body = await decodeUploadBody(assembled, contentEncoding);
      if (body.byteLength === 0) {
        return reply.status(400).send({
          error: "EmptyUploadBody",
          message: "Upload body is empty after reassembly.",
        });
      }

      await objectStorage.putObject(objectKey, body, {
        contentType,
      });
      await rm(tempPath, { force: true });
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

async function getFileSize(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? fileStat.size : 0;
  } catch {
    return 0;
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

function parseRequiredIntegerHeader(
  value: string | string[] | undefined,
  headerName: string,
) {
  const parsed = parseOptionalIntegerHeader(value, headerName);
  if (parsed.value === undefined) {
    return {
      error: `Missing required header: ${headerName}`,
    };
  }
  return parsed;
}

function parseOptionalIntegerHeader(
  value: string | string[] | undefined,
  headerName: string,
) {
  const raw = getHeaderValue(value);
  if (raw === undefined) {
    return {
      value: undefined,
    };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      error: `Invalid integer header: ${headerName}`,
    };
  }
  return {
    value: parsed,
  };
}

function parseBooleanHeader(value: string | string[] | undefined) {
  const raw = getHeaderValue(value);
  if (!raw) {
    return false;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

function getHeaderValue(header: string | string[] | undefined) {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.trim() || undefined;
}

function resolveChunkUploadPath(
  config: ApiConfig,
  objectKey: string,
  uploadId: string,
) {
  const storageRoot = path.resolve(process.cwd(), config.OBJECT_STORAGE_ROOT);
  const chunkRoot = path.join(storageRoot, ".tmp", "uploads");
  const hash = createHash("sha256")
    .update(`${objectKey}:${uploadId}`)
    .digest("hex");
  return path.join(chunkRoot, `${hash}.part`);
}

async function decodeUploadBody(
  body: unknown,
  contentEncoding: string | string[] | undefined,
) {
  const buffer = toBuffer(body);
  if (buffer.byteLength === 0) {
    return buffer;
  }

  const encoding = Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding;
  if (!encoding) {
    return buffer;
  }

  const normalized = encoding
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (normalized.includes("gzip")) {
    return await gunzipAsync(buffer);
  }

  return buffer;
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
