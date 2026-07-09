import {
  shareCreateRequestSchema,
  shareCreateResponseSchema,
  shareDetailResponseSchema,
  shareListResponseSchema,
  shareRevokeResponseSchema,
  shareUpdateRequestSchema,
  shareUpdateResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/http-error";
import { MemoryRateLimiter } from "../lib/rate-limit";
import type { AuthService } from "../services/auth/auth-service";
import type { ShareService } from "../services/shares/share-service";

const shareParamsSchema = z.object({
  shareId: z.string().uuid(),
});

const createShareLimiter = new MemoryRateLimiter({ max: 10, windowMs: 60_000 });

export async function registerShareRoutes(
  app: FastifyInstance,
  authService: AuthService,
  shareService: ShareService,
) {
  app.get("/shares", async (request, reply) => {
    const user = await authService.requireUser(request);
    const items = await shareService.listShares(user.id);
    return reply.send(shareListResponseSchema.parse({ items }));
  });

  app.post("/shares", async (request, reply) => {
    const user = await authService.requireUser(request);
    const limit = createShareLimiter.hit(`share-create:${user.id}`);
    if (!limit.allowed) {
      reply.header("retry-after", String(limit.retryAfterSec));
      throw new HttpError(429, "RateLimited", "创建分享过于频繁，请稍后再试。");
    }

    const body = shareCreateRequestSchema.parse(request.body);
    const share = await shareService.createShare(user.id, body);
    return reply.status(201).send(shareCreateResponseSchema.parse({ share }));
  });

  app.get<{ Params: { shareId: string } }>("/shares/:shareId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = shareParamsSchema.parse(request.params);
    const share = await shareService.getShareDetail(user.id, params.shareId);
    return reply.send(shareDetailResponseSchema.parse({ share }));
  });

  app.patch<{ Params: { shareId: string } }>("/shares/:shareId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = shareParamsSchema.parse(request.params);
    const body = shareUpdateRequestSchema.parse(request.body);
    const share = await shareService.updateShare(user.id, params.shareId, body);
    return reply.send(shareUpdateResponseSchema.parse({ share }));
  });

  app.post<{ Params: { shareId: string } }>("/shares/:shareId/revoke", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = shareParamsSchema.parse(request.params);
    const share = await shareService.revokeShare(user.id, params.shareId);
    return reply.send(shareRevokeResponseSchema.parse({ share }));
  });
}
