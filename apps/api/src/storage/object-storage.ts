import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path, { dirname, posix } from "node:path";
import { Readable } from "node:stream";
import { type ApiConfig } from "../config";

export interface ObjectStorage {
  readonly kind: "localfs" | "r2";
  createUploadUrl(objectKey: string): string;
  createPublicUrl?(objectKey: string): string | null;
  putObject(
    objectKey: string,
    body: Buffer,
    options?: {
      contentType?: string;
      cacheControl?: string;
    },
  ): Promise<{ size: number }>;
  readObject(objectKey: string): Promise<Buffer>;
  hasObject(objectKey: string): Promise<boolean>;
  statObject(objectKey: string): Promise<{ size: number } | null>;
  deleteObject(objectKey: string): Promise<void>;
}

type LocalObjectStorageOptions = {
  rootDir: string;
  publicBaseUrl: string;
};

export class LocalObjectStorage implements ObjectStorage {
  readonly kind = "localfs" as const;

  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  constructor(options: LocalObjectStorageOptions) {
    this.rootDir = path.resolve(process.cwd(), options.rootDir);
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "");
  }

  createUploadUrl(objectKey: string) {
    return `${this.publicBaseUrl}/uploads/${encodeURIComponent(objectKey)}`;
  }

  async putObject(
    objectKey: string,
    body: Buffer,
    _options?: {
      contentType?: string;
      cacheControl?: string;
    },
  ) {
    const objectPath = this.resolveObjectPath(objectKey);
    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, body);
    return {
      size: body.byteLength,
    };
  }

  async hasObject(objectKey: string) {
    const fileStat = await this.statObject(objectKey);
    return fileStat !== null;
  }

  async readObject(objectKey: string) {
    return readFile(this.resolveObjectPath(objectKey));
  }

  async statObject(objectKey: string) {
    try {
      const fileStat = await stat(this.resolveObjectPath(objectKey));
      if (!fileStat.isFile()) {
        return null;
      }
      return {
        size: fileStat.size,
      };
    } catch {
      return null;
    }
  }

  async deleteObject(objectKey: string) {
    try {
      await rm(this.resolveObjectPath(objectKey), {
        force: true,
      });
    } catch {
      return;
    }
  }

  private resolveObjectPath(objectKey: string) {
    if (!objectKey || objectKey.includes("\0")) {
      throw new Error("Invalid object key.");
    }
    const normalized = posix.normalize(objectKey.replaceAll("\\", "/"));
    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/")
    ) {
      throw new Error("Invalid object key path.");
    }

    const resolved = path.resolve(this.rootDir, ...normalized.split("/"));
    const prefix = `${this.rootDir}${path.sep}`;
    if (resolved !== this.rootDir && !resolved.startsWith(prefix)) {
      throw new Error("Object key resolved outside storage root.");
    }
    return resolved;
  }
}

type R2ObjectStorageOptions = {
  endpoint: string;
  bucket: string;
  publicBucket?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  region: string;
};

export class R2ObjectStorage implements ObjectStorage {
  readonly kind = "r2" as const;

  private readonly bucket: string;
  private readonly publicBucket?: string;
  private readonly publicBaseUrl?: string;
  private readonly client: S3Client;

  constructor(options: R2ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.publicBucket = options.publicBucket;
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, "");
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  createUploadUrl(objectKey: string) {
    return `/uploads/${encodeURIComponent(objectKey)}`;
  }

  createPublicUrl(objectKey: string) {
    if (!this.publicBaseUrl || !isPublicAssetObjectKey(objectKey)) {
      return null;
    }
    return `${this.publicBaseUrl}/${encodeObjectKeyPath(objectKey)}`;
  }

  async putObject(
    objectKey: string,
    body: Buffer,
    options?: {
      contentType?: string;
      cacheControl?: string;
    },
  ) {
    const key = normalizeObjectKey(objectKey);
    await this.client.send(new PutObjectCommand({
      Bucket: this.resolveBucket(key),
      Key: key,
      Body: body,
      ContentType: options?.contentType,
      CacheControl: options?.cacheControl ?? cacheControlForObjectKey(key),
    }));
    return {
      size: body.byteLength,
    };
  }

  async hasObject(objectKey: string) {
    return (await this.statObject(objectKey)) !== null;
  }

  async readObject(objectKey: string) {
    const key = normalizeObjectKey(objectKey);
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.resolveBucket(key),
      Key: key,
    }));
    return streamToBuffer(result.Body);
  }

  async statObject(objectKey: string) {
    const key = normalizeObjectKey(objectKey);
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.resolveBucket(key),
        Key: key,
      }));
      return {
        size: result.ContentLength ?? 0,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(objectKey: string) {
    const key = normalizeObjectKey(objectKey);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.resolveBucket(key),
      Key: key,
    }));
  }

  private resolveBucket(objectKey: string) {
    return isPublicAssetObjectKey(objectKey) && this.publicBucket
      ? this.publicBucket
      : this.bucket;
  }
}

class FallbackObjectStorage implements ObjectStorage {
  readonly kind = "r2" as const;

  constructor(
    private readonly primary: ObjectStorage,
    private readonly fallback: ObjectStorage,
  ) {}

  createUploadUrl(objectKey: string) {
    return this.primary.createUploadUrl(objectKey);
  }

  createPublicUrl(objectKey: string) {
    return this.primary.createPublicUrl?.(objectKey) ?? this.fallback.createPublicUrl?.(objectKey) ?? null;
  }

  putObject(
    objectKey: string,
    body: Buffer,
    options?: {
      contentType?: string;
      cacheControl?: string;
    },
  ) {
    return this.primary.putObject(objectKey, body, options);
  }

  async readObject(objectKey: string) {
    try {
      return await this.primary.readObject(objectKey);
    } catch (error) {
      if (isNotFoundError(error)) {
        return this.fallback.readObject(objectKey);
      }
      throw error;
    }
  }

  async hasObject(objectKey: string) {
    return (await this.statObject(objectKey)) !== null;
  }

  async statObject(objectKey: string) {
    const primaryStat = await this.primary.statObject(objectKey);
    return primaryStat ?? this.fallback.statObject(objectKey);
  }

  async deleteObject(objectKey: string) {
    await Promise.allSettled([
      this.primary.deleteObject(objectKey),
      this.fallback.deleteObject(objectKey),
    ]);
  }
}

export function createObjectStorage(config: ApiConfig): ObjectStorage {
  if (config.OBJECT_STORAGE_DRIVER === "r2") {
    return createR2ObjectStorage(config);
  }

  return new LocalObjectStorage({
    rootDir: config.OBJECT_STORAGE_ROOT,
    publicBaseUrl: resolvePublicBaseUrl(config),
  });
}

function createR2ObjectStorage(config: ApiConfig) {
  const endpoint = config.R2_ENDPOINT?.trim();
  const bucket = config.R2_BUCKET?.trim();
  const publicBucket = config.R2_PUBLIC_BUCKET?.trim();
  const accessKeyId = config.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = config.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when OBJECT_STORAGE_DRIVER=r2.");
  }

  const primary = new R2ObjectStorage({
    endpoint,
    bucket,
    publicBucket: publicBucket || undefined,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: config.R2_PUBLIC_BASE_URL?.trim() || undefined,
    region: config.R2_REGION,
  });
  const fallback = new LocalObjectStorage({
    rootDir: config.OBJECT_STORAGE_ROOT,
    publicBaseUrl: resolvePublicBaseUrl(config),
  });
  return new FallbackObjectStorage(primary, fallback);
}

function resolvePublicBaseUrl(config: ApiConfig) {
  if (config.API_PUBLIC_BASE_URL?.trim()) {
    return config.API_PUBLIC_BASE_URL.trim();
  }
  const host = config.API_HOST === "0.0.0.0" ? "127.0.0.1" : config.API_HOST;
  return `http://${host}:${config.API_PORT}`;
}

function normalizeObjectKey(objectKey: string) {
  if (!objectKey || objectKey.includes("\0")) {
    throw new Error("Invalid object key.");
  }
  const normalized = posix.normalize(objectKey.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
    || normalized.startsWith("/")
  ) {
    throw new Error("Invalid object key path.");
  }
  return normalized;
}

function encodeObjectKeyPath(objectKey: string) {
  return normalizeObjectKey(objectKey)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

async function streamToBuffer(body: unknown) {
  if (!body) {
    return Buffer.alloc(0);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof body === "object" && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  throw new Error("Unsupported object body stream.");
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as {
    name?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };
  return maybeError.name === "NotFound" || maybeError.$metadata?.httpStatusCode === 404;
}
