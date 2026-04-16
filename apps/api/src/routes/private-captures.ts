import type { ApiConfig } from "../config";
import {
  captureCompleteRequestSchema,
  captureInitRequestSchema,
  captureInitResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BookmarkRepository } from "../repositories";
import type { AuthService } from "../services/auth/auth-service";
import { PrivateModeService } from "../services/auth/private-mode-service";

const captureCompleteResponseSchema = z.object({
  bookmarkId: z.string().min(1),
  versionId: z.string().min(1),
  createdNewVersion: z.boolean(),
  deduplicated: z.boolean(),
});

export async function registerPrivateCaptureRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  authService: AuthService,
  privateModeService: PrivateModeService,
  repository: BookmarkRepository,
) {
  app.post("/private/captures/init", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    privateModeService.requireUnlocked(request, user.id);
    const payload = captureInitRequestSchema.parse(request.body);
    const result = await repository.initPrivateCapture(user.id, payload);
    const publicBaseUrl = resolvePublicBaseUrl(request, config);
    const response = captureInitResponseSchema.parse({
      ...result,
      uploadUrl: `${publicBaseUrl}/uploads/${encodeURIComponent(result.objectKey)}`,
    });
    return reply.send(response);
  });

  app.post("/private/captures/complete", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    privateModeService.requireUnlocked(request, user.id);
    const payload = captureCompleteRequestSchema.parse(request.body);
    const result = await repository.completePrivateCapture(user.id, payload);
    return reply.send(captureCompleteResponseSchema.parse({
      bookmarkId: result.bookmark.id,
      versionId: result.versionId,
      createdNewVersion: result.createdNewVersion,
      deduplicated: result.deduplicated,
    }));
  });
}

function resolvePublicBaseUrl(request: FastifyRequest, config: ApiConfig) {
  if (config.API_PUBLIC_BASE_URL?.trim()) {
    return config.API_PUBLIC_BASE_URL.trim().replace(/\/$/, "");
  }

  const requestedBaseUrl = getHeaderValue(request.headers["x-keeppage-public-base-url"]);
  if (requestedBaseUrl) {
    return requestedBaseUrl.replace(/\/$/, "");
  }

  const protocol = getHeaderValue(request.headers["x-forwarded-proto"])
    ?? request.protocol
    ?? "http";
  const host = getHeaderValue(request.headers["x-forwarded-host"])
    ?? getHeaderValue(request.headers.host);
  const prefix = normalizeForwardedPrefix(getHeaderValue(request.headers["x-forwarded-prefix"]));

  if (host) {
    return `${protocol}://${host}${prefix}`;
  }

  const hostFallback = config.API_HOST === "0.0.0.0" ? "127.0.0.1" : config.API_HOST;
  return `http://${hostFallback}:${config.API_PORT}`;
}

function getHeaderValue(header: string | string[] | undefined) {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return undefined;
  }
  return raw.split(",")[0]?.trim() || undefined;
}

function normalizeForwardedPrefix(prefix: string | undefined) {
  if (!prefix) {
    return "";
  }
  const trimmed = prefix.trim().replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
