import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { ApiConfig } from "../../config";
import { HttpError } from "../../lib/http-error";
import type { ObjectAccessRepository } from "../../repositories";
import type { ObjectStorage } from "../../storage/object-storage";

const gunzipAsync = promisify(gunzip);

type UploadServiceOptions = {
  config: ApiConfig;
  repository: ObjectAccessRepository;
  objectStorage: ObjectStorage;
};

type ChunkUploadInput = {
  userId: string;
  objectKey: string;
  uploadId: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type ObjectUploadInput = {
  userId: string;
  objectKey: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

export class UploadService {
  private readonly config: ApiConfig;
  private readonly repository: ObjectAccessRepository;
  private readonly objectStorage: ObjectStorage;

  constructor(options: UploadServiceOptions) {
    this.config = options.config;
    this.repository = options.repository;
    this.objectStorage = options.objectStorage;
  }

  decodeObjectKey(encodedObjectKey: string) {
    try {
      const objectKey = decodeURIComponent(encodedObjectKey);
      const normalized = path.posix.normalize(objectKey.replaceAll("\\", "/"));
      if (
        !normalized
        || normalized === "."
        || normalized === ".."
        || normalized.startsWith("../")
        || normalized.startsWith("/")
      ) {
        throw new Error("Object key is empty.");
      }
      return normalized;
    } catch {
      throw new HttpError(400, "InvalidUploadObjectKey", "Invalid upload object key.");
    }
  }

  async getObject(userId: string, objectKey: string) {
    const canRead = await this.repository.userCanReadObject(userId, objectKey);
    if (!canRead || !(await this.objectStorage.hasObject(objectKey))) {
      throw new HttpError(404, "ObjectNotFound", "Object not found.");
    }

    return {
      body: await this.objectStorage.readObject(objectKey),
      contentType: guessContentType(objectKey),
    };
  }

  async uploadObject(input: ObjectUploadInput) {
    const { userId, objectKey, body, headers } = input;
    await this.assertCanWrite(userId, objectKey);
    const decodedBody = await decodeUploadBody(body, headers["content-encoding"]);
    if (decodedBody.byteLength === 0) {
      throw new HttpError(400, "EmptyUploadBody", "Upload body is empty.");
    }

    await this.objectStorage.putObject(objectKey, decodedBody, {
      contentType: getHeaderValue(headers["content-type"]),
    });
  }

  async uploadChunk(input: ChunkUploadInput) {
    const { userId, objectKey, uploadId, body, headers } = input;
    await this.assertCanWrite(userId, objectKey);

    const chunk = toBuffer(body);
    if (chunk.byteLength === 0) {
      throw new HttpError(400, "EmptyUploadBody", "Upload chunk body is empty.");
    }

    const offset = parseRequiredIntegerHeader(
      headers["x-keeppage-upload-offset"],
      "x-keeppage-upload-offset",
    );
    const totalSize = parseOptionalIntegerHeader(
      headers["x-keeppage-upload-total-size"],
      "x-keeppage-upload-total-size",
    );
    const isComplete = parseBooleanHeader(headers["x-keeppage-upload-complete"]);
    const contentType = getHeaderValue(headers["x-keeppage-upload-content-type"])
      ?? getHeaderValue(headers["content-type"]);
    const contentEncoding = getHeaderValue(headers["x-keeppage-upload-content-encoding"]);
    const tempPath = resolveChunkUploadPath(this.config, objectKey, uploadId);

    await mkdir(path.dirname(tempPath), { recursive: true });
    const existingSize = await getFileSize(tempPath);
    if (existingSize !== offset) {
      throw new HttpError(409, "UploadOffsetMismatch", "Upload offset mismatch.", {
        expectedOffset: existingSize,
        receivedOffset: offset,
      });
    }

    await appendFile(tempPath, chunk);
    const receivedBytes = existingSize + chunk.byteLength;

    if (!isComplete) {
      return {
        statusCode: 202,
        payload: {
          uploadId,
          receivedBytes,
        },
      } as const;
    }

    if (totalSize !== undefined && totalSize !== receivedBytes) {
      throw new HttpError(409, "UploadSizeMismatch", "Upload size mismatch.", {
        expectedSize: totalSize,
        receivedBytes,
      });
    }

    const assembled = await readFile(tempPath);
    const decodedBody = await decodeUploadBody(assembled, contentEncoding);
    if (decodedBody.byteLength === 0) {
      throw new HttpError(400, "EmptyUploadBody", "Upload body is empty after reassembly.");
    }

    await this.objectStorage.putObject(objectKey, decodedBody, {
      contentType,
    });
    await rm(tempPath, { force: true });

    return {
      statusCode: 204,
    } as const;
  }

  private async assertCanWrite(userId: string, objectKey: string) {
    const canWrite = await this.repository.userCanWriteObject(userId, objectKey);
    if (!canWrite) {
      throw new HttpError(403, "UploadForbidden", "Current user cannot upload to this object key.");
    }
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
  if (parsed === undefined) {
    throw new HttpError(400, "InvalidUploadHeader", `Missing required header: ${headerName}`);
  }
  return parsed;
}

function parseOptionalIntegerHeader(
  value: string | string[] | undefined,
  headerName: string,
) {
  const raw = getHeaderValue(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "InvalidUploadHeader", `${headerName} must be a non-negative integer.`);
  }
  return parsed;
}

function parseBooleanHeader(value: string | string[] | undefined) {
  const raw = getHeaderValue(value);
  return raw === "1" || raw?.toLowerCase() === "true";
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
  return path.resolve(
    process.cwd(),
    config.OBJECT_STORAGE_ROOT,
    ".uploads",
    ...objectKey.split("/"),
    `${uploadId}.part`,
  );
}

async function decodeUploadBody(
  body: unknown,
  contentEncoding: string | string[] | undefined,
) {
  const buffer = toBuffer(body);
  const encoding = getHeaderValue(contentEncoding)?.toLowerCase();
  if (encoding === "gzip") {
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
  if (objectKey.endsWith(".png")) {
    return "image/png";
  }
  if (objectKey.endsWith(".jpg") || objectKey.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (objectKey.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}
