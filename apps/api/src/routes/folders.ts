import {
  folderCreateRequestSchema,
  folderListResponseSchema,
  folderSchema,
  folderUpdateRequestSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth-service";
import type { BookmarkRepository } from "../repositories";

const folderParamsSchema = z.object({
  folderId: z.string().min(1),
});

export async function registerFolderRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: BookmarkRepository,
) {
  app.get("/folders", async (request, reply) => {
    const user = await authService.requireUser(request);
    const items = await repository.listFolders(user.id);
    return reply.send(folderListResponseSchema.parse({ items }));
  });

  app.post("/folders", async (request, reply) => {
    const user = await authService.requireUser(request);
    const body = folderCreateRequestSchema.parse(request.body);
    const folder = await repository.createFolder(user.id, body);
    return reply.status(201).send(folderSchema.parse(folder));
  });

  app.patch<{ Params: { folderId: string } }>("/folders/:folderId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = folderParamsSchema.parse(request.params);
    const body = folderUpdateRequestSchema.parse(request.body);
    const folder = await repository.updateFolder(user.id, params.folderId, body);
    if (!folder) {
      return reply.status(404).send({
        error: "FolderNotFound",
        message: "Folder not found.",
      });
    }
    return reply.send(folderSchema.parse(folder));
  });

  app.delete<{ Params: { folderId: string } }>("/folders/:folderId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = folderParamsSchema.parse(request.params);
    const deleted = await repository.deleteFolder(user.id, params.folderId);
    if (!deleted) {
      return reply.status(404).send({
        error: "FolderNotFound",
        message: "Folder not found.",
      });
    }
    return reply.status(204).send();
  });
}
