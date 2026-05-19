import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth/auth-service";
import type { ImportService } from "../services/imports/import-service";
import type { UserResponseCache } from "./http-cache";

export async function registerImportRoutes(
  app: FastifyInstance,
  authService: AuthService,
  importService: ImportService,
  responseCache: UserResponseCache,
) {
  app.post("/imports/preview", async (request, reply) => {
    const user = await authService.requireUser(request);
    return reply.send(await importService.previewImport(user.id, request.body));
  });

  app.post("/imports", async (request, reply) => {
    const user = await authService.requireUser(request);
    const result = await importService.createImportTask(user.id, request.body);
    responseCache.invalidateUser(user.id);
    return reply.send(result);
  });

  app.get("/imports", async (request, reply) => {
    const user = await authService.requireUser(request);
    return reply.send(await importService.listImportTasks(user.id));
  });

  app.get<{ Params: { taskId: string } }>("/imports/:taskId", async (request, reply) => {
    const user = await authService.requireUser(request);
    return reply.send(await importService.getImportTaskDetail(user.id, request.params.taskId ?? ""));
  });
}
