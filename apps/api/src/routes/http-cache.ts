import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

type CacheEntry = {
  etag: string;
  expiresAt: number;
  payload: unknown;
};

type UserResponseCacheOptions = {
  maxEntries?: number;
  ttlMs?: number;
};

type CacheableJsonOptions<T> = {
  scope: string;
  userId: string;
  ttlMs?: number;
  load: () => Promise<T>;
};

const DEFAULT_CACHE_TTL_MS = 10_000;
const DEFAULT_MAX_ENTRIES = 500;
const CACHE_CONTROL_HEADER = "private, max-age=0, stale-while-revalidate=30";

export class UserResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: UserResponseCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async sendJson<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    options: CacheableJsonOptions<T>,
  ) {
    const cacheKey = createCacheKey(options.scope, options.userId, request);
    const now = Date.now();
    const cached = this.entries.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return sendJsonWithEtag(request.headers["if-none-match"], reply, cached.payload, cached.etag);
    }
    if (cached) {
      this.entries.delete(cacheKey);
    }

    const payload = await options.load();
    const etag = createWeakEtag(payload);
    this.set(cacheKey, {
      etag,
      expiresAt: now + (options.ttlMs ?? this.ttlMs),
      payload,
    });
    return sendJsonWithEtag(request.headers["if-none-match"], reply, payload, etag);
  }

  invalidateUser(userId: string) {
    const token = `:${userId}:`;
    for (const key of this.entries.keys()) {
      if (key.includes(token)) {
        this.entries.delete(key);
      }
    }
  }

  private set(cacheKey: string, entry: CacheEntry) {
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(cacheKey, entry);
  }
}

export function sendCacheableJson(
  ifNoneMatch: string | string[] | undefined,
  reply: FastifyReply,
  payload: unknown,
) {
  const etag = createWeakEtag(payload);
  return sendJsonWithEtag(ifNoneMatch, reply, payload, etag);
}

function sendJsonWithEtag(
  ifNoneMatch: string | string[] | undefined,
  reply: FastifyReply,
  payload: unknown,
  etag: string,
) {
  reply
    .header("etag", etag)
    .header("cache-control", CACHE_CONTROL_HEADER)
    .header("vary", "authorization, x-keeppage-private-token");
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return reply.status(304).send();
  }
  return reply.send(payload);
}

function createWeakEtag(payload: unknown) {
  const hash = createHash("sha1").update(JSON.stringify(payload)).digest("base64url");
  return `W/"${hash}"`;
}

function matchesIfNoneMatch(header: string | string[] | undefined, etag: string) {
  const rawValue = Array.isArray(header) ? header.join(",") : header;
  if (!rawValue) {
    return false;
  }
  return rawValue.split(",").map((value) => value.trim()).includes(etag);
}

function createCacheKey(scope: string, userId: string, request: FastifyRequest) {
  return `${scope}:${userId}:${request.method}:${request.url}`;
}
