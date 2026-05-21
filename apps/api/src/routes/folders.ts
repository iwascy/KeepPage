import {
  folderCreateRequestSchema,
  folderListResponseSchema,
  folderSchema,
  folderUpdateRequestSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TaxonomyRepository } from "../repositories";
import type { AuthService } from "../services/auth/auth-service";
import type { UserResponseCache } from "./http-cache";

const folderParamsSchema = z.object({
  folderId: z.string().min(1),
});

export async function registerFolderRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: TaxonomyRepository,
  responseCache: UserResponseCache,
) {
  app.get("/folders", async (request, reply) => {
    const user = await authService.requireUser(request, {
      allowExtensionDevice: true,
    });
    return responseCache.sendJson(request, reply, {
      scope: "folders",
      userId: user.id,
      load: async () => {
        const items = await repository.listFolders(user.id);
        return folderListResponseSchema.parse({ items });
      },
    });
  });

  app.post("/folders", async (request, reply) => {
    const user = await authService.requireUser(request);
    const body = folderCreateRequestSchema.parse(request.body);
    const folder = await repository.createFolder(user.id, body);
    responseCache.invalidateUser(user.id);
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
    responseCache.invalidateUser(user.id);
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
    responseCache.invalidateUser(user.id);
    return reply.status(204).send();
  });
}
