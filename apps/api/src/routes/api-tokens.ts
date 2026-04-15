import {
  apiTokenCreateRequestSchema,
  apiTokenListResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { ApiTokenService } from "../services/api-tokens/api-token-service";

const apiTokenParamsSchema = z.object({
  tokenId: z.string().uuid(),
});

export async function registerApiTokenRoutes(
  app: FastifyInstance,
  authService: AuthService,
  apiTokenService: ApiTokenService,
) {
  app.get("/api-tokens", async (request, reply) => {
    const user = await authService.requireUser(request);
    const items = await apiTokenService.listTokens(user.id);
    return reply.send(apiTokenListResponseSchema.parse({ items }));
  });

  app.post("/api-tokens", async (request, reply) => {
    const user = await authService.requireUser(request);
    const body = apiTokenCreateRequestSchema.parse(request.body);
    const result = await apiTokenService.createToken(user.id, body);
    return reply.status(201).send(result);
  });

  app.delete<{ Params: { tokenId: string } }>("/api-tokens/:tokenId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = apiTokenParamsSchema.parse(request.params);
    const deleted = await apiTokenService.revokeToken(user.id, params.tokenId);
    if (!deleted) {
      return reply.status(404).send({
        error: "ApiTokenNotFound",
        message: "API token not found.",
      });
    }
    return reply.status(204).send();
  });
}
