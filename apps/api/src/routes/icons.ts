import {
  bookmarkIconRefreshRequestSchema,
  bookmarkIconRefreshResponseSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth/auth-service";
import type { IconRefreshService } from "../services/icons/icon-refresh-service";

export async function registerIconRoutes(
  app: FastifyInstance,
  authService: AuthService,
  iconRefreshService: IconRefreshService,
) {
  app.post("/bookmarks/icons/refresh", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowExtensionDevice: true,
    });
    const payload = bookmarkIconRefreshRequestSchema.parse(request.body);
    const result = await iconRefreshService.refreshOne(user.id, payload);
    return reply.send(bookmarkIconRefreshResponseSchema.parse(result));
  });

  app.post("/bookmarks/icons/refresh-all", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowExtensionDevice: true,
    });
    const result = await iconRefreshService.refreshAll(user.id);
    return reply.send(bookmarkIconRefreshResponseSchema.parse(result));
  });
}
