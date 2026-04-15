import {
  privateModeSetupRequestSchema,
  privateModeUnlockRequestSchema,
  privateModeUnlockResponseSchema,
  privateVaultSummarySchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth/auth-service";
import { PrivateModeService } from "../services/auth/private-mode-service";

export async function registerPrivateModeRoutes(
  app: FastifyInstance,
  authService: AuthService,
  privateModeService: PrivateModeService,
) {
  app.get("/private-mode/status", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    const privateToken = Array.isArray(request.headers["x-keeppage-private-token"])
      ? request.headers["x-keeppage-private-token"][0]
      : request.headers["x-keeppage-private-token"];
    const summary = await privateModeService.getStatus(user.id, privateToken);
    return reply.send(privateVaultSummarySchema.parse(summary));
  });

  app.post("/private-mode/setup", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    const payload = privateModeSetupRequestSchema.parse(request.body);
    const response = await privateModeService.setup(user.id, payload);
    return reply.status(201).send(privateModeUnlockResponseSchema.parse(response));
  });

  app.post("/private-mode/unlock", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    const payload = privateModeUnlockRequestSchema.parse(request.body);
    const response = await privateModeService.unlock(user.id, payload);
    return reply.send(privateModeUnlockResponseSchema.parse(response));
  });

  app.post("/private-mode/lock", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    const summary = await privateModeService.getStatus(user.id);
    return reply.send(privateVaultSummarySchema.parse({
      ...summary,
      unlocked: false,
    }));
  });
}
