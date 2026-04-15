import {
  authLoginRequestSchema,
  authRegisterRequestSchema,
  authSessionSchema,
  authUserSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth/auth-service";

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
) {
  app.post("/auth/register", async (request, reply) => {
    const payload = authRegisterRequestSchema.parse(request.body);
    const session = await authService.register(payload);
    return reply.status(201).send(authSessionSchema.parse(session));
  });

  app.post("/auth/login", async (request, reply) => {
    const payload = authLoginRequestSchema.parse(request.body);
    const session = await authService.login(payload);
    return reply.send(authSessionSchema.parse(session));
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowApiToken: true,
      requiredApiScope: "bookmark:create",
    });
    return reply.send(authUserSchema.parse(user));
  });
}
