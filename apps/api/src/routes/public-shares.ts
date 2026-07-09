import { publicShareResponseSchema } from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/http-error";
import { MemoryRateLimiter } from "../lib/rate-limit";
import type { ShareService } from "../services/shares/share-service";

const publicShareParamsSchema = z.object({
  token: z.string().min(8).max(128),
});

const publicGetLimiter = new MemoryRateLimiter({ max: 120, windowMs: 60_000 });

export async function registerPublicShareRoutes(
  app: FastifyInstance,
  shareService: ShareService,
) {
  app.get<{ Params: { token: string } }>("/public/shares/:token", async (request, reply) => {
    const ip = request.ip || "unknown";
    const limit = publicGetLimiter.hit(`public-share:${ip}`);
    if (!limit.allowed) {
      reply.header("retry-after", String(limit.retryAfterSec));
      throw new HttpError(429, "RateLimited", "请求过于频繁，请稍后再试。");
    }

    const params = publicShareParamsSchema.parse(request.params);
    const payload = await shareService.getPublicShare(params.token);

    // Prefer freshness after revoke over long browser/CDN reuse of public payloads.
    reply.header("cache-control", "public, max-age=0, s-maxage=15, must-revalidate");
    reply.header("x-robots-tag", "noindex, nofollow");

    try {
      return reply.send(publicShareResponseSchema.parse(payload));
    } catch (error) {
      request.log.error({ err: error, token: params.token }, "Public share response failed schema validation");
      throw new HttpError(500, "ShareProjectionError", "分享内容暂时无法展示，请稍后重试。");
    }
  });
}
