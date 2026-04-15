import {
  cloudArchiveRequestSchema,
  cloudArchiveResponseSchema,
  cloudArchiveTaskSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { CloudArchiveManager } from "../services/cloud-archive/cloud-archive-manager";

const taskParamsSchema = z.object({
  taskId: z.string().min(1),
});

export async function registerCloudArchiveRoutes(
  app: FastifyInstance,
  authService: AuthService,
  manager: CloudArchiveManager,
) {
  app.post("/cloud-archive", async (request, reply) => {
    const user = await authService.requireUser(request);
    const body = cloudArchiveRequestSchema.parse(request.body);
    const task = manager.submit(user.id, body);
    const response = cloudArchiveResponseSchema.parse({
      taskId: task.taskId,
      status: task.status,
    });
    return reply.status(202).send(response);
  });

  app.get<{ Params: { taskId: string } }>("/cloud-archive/:taskId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = taskParamsSchema.parse(request.params);
    const task = manager.getTask(user.id, params.taskId);
    if (!task) {
      return reply.status(404).send({
        error: "TaskNotFound",
        message: "Cloud archive task not found.",
      });
    }
    const response = cloudArchiveTaskSchema.parse(task);
    return reply.send(response);
  });
}
