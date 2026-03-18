import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path, { dirname, posix } from "node:path";
import { type ApiConfig } from "../config";

export interface ObjectStorage {
  readonly kind: "localfs";
  createUploadUrl(objectKey: string): string;
  putObject(
    objectKey: string,
    body: Buffer,
    options?: {
      contentType?: string;
    },
  ): Promise<{ size: number }>;
  readObject(objectKey: string): Promise<Buffer>;
  hasObject(objectKey: string): Promise<boolean>;
  statObject(objectKey: string): Promise<{ size: number } | null>;
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

export function createObjectStorage(config: ApiConfig): ObjectStorage {
  if (config.OBJECT_STORAGE_DRIVER !== "localfs") {
    throw new Error(`Unsupported object storage driver: ${config.OBJECT_STORAGE_DRIVER}`);
  }

  return new LocalObjectStorage({
    rootDir: config.OBJECT_STORAGE_ROOT,
    publicBaseUrl: resolvePublicBaseUrl(config),
  });
}

function resolvePublicBaseUrl(config: ApiConfig) {
  if (config.API_PUBLIC_BASE_URL?.trim()) {
    return config.API_PUBLIC_BASE_URL.trim();
  }
  const host = config.API_HOST === "0.0.0.0" ? "127.0.0.1" : config.API_HOST;
  return `http://${host}:${config.API_PORT}`;
}
