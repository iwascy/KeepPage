import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";

export function sendCacheableJson(
  ifNoneMatch: string | string[] | undefined,
  reply: FastifyReply,
  payload: unknown,
) {
  const etag = createWeakEtag(payload);
  reply
    .header("etag", etag)
    .header("cache-control", "private, max-age=0, stale-while-revalidate=30");
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
