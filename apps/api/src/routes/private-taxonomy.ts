import {
  folderCreateRequestSchema,
  folderListResponseSchema,
  folderSchema,
  folderUpdateRequestSchema,
  privateWorkspaceBootstrapResponseSchema,
  tagCreateRequestSchema,
  tagListResponseSchema,
  tagSchema,
  tagUpdateRequestSchema,
} from "@keeppage/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrivateTaxonomyRepository } from "../repositories";
import type { AuthService } from "../services/auth/auth-service";
import type { PrivateModeService } from "../services/auth/private-mode-service";
import type { BookmarkService } from "../services/bookmarks/bookmark-service";
import type { UserResponseCache } from "./http-cache";

const folderParamsSchema = z.object({
  folderId: z.string().min(1),
});

const tagParamsSchema = z.object({
  tagId: z.string().min(1),
});

/**
 * Private folders/tags and the private workspace bootstrap. These mirror
 * `/folders`, `/tags` and `/workspace/bootstrap` but only ever touch the
 * private_* taxonomy (see docs/private-workspace.md).
 */
export async function registerPrivateTaxonomyRoutes(
  app: FastifyInstance,
  authService: AuthService,
  privateModeService: PrivateModeService,
  repository: PrivateTaxonomyRepository,
  bookmarkService: BookmarkService,
  responseCache: UserResponseCache,
) {
  const requirePrivateUser = async (request: FastifyRequest) => {
    const user = await authService.requireUser(request, {
      allowExtensionDevice: true,
    });
    await privateModeService.requireUnlocked(request, user.id);
    return user;
  };

  app.get("/private/workspace/bootstrap", async (request, reply) => {
    const user = await requirePrivateUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "private-workspace-bootstrap",
      userId: user.id,
      load: async () => {
        const [folders, tags, stats] = await Promise.all([
          repository.listPrivateFolders(user.id),
          repository.listPrivateTags(user.id),
          bookmarkService.getPrivateBookmarkSidebarStats(user.id),
        ]);

        return privateWorkspaceBootstrapResponseSchema.parse({
          folders,
          tags,
          folderCounts: stats.folderCounts,
        });
      },
    });
  });

  app.get("/private/folders", async (request, reply) => {
    const user = await requirePrivateUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "private-folders",
      userId: user.id,
      load: async () => {
        const items = await repository.listPrivateFolders(user.id);
        return folderListResponseSchema.parse({ items });
      },
    });
  });

  app.post("/private/folders", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const body = folderCreateRequestSchema.parse(request.body);
    const folder = await repository.createPrivateFolder(user.id, body);
    responseCache.invalidateUser(user.id);
    return reply.status(201).send(folderSchema.parse(folder));
  });

  app.patch<{ Params: { folderId: string } }>("/private/folders/:folderId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = folderParamsSchema.parse(request.params);
    const body = folderUpdateRequestSchema.parse(request.body);
    const folder = await repository.updatePrivateFolder(user.id, params.folderId, body);
    if (!folder) {
      return reply.status(404).send({
        error: "FolderNotFound",
        message: "Folder not found.",
      });
    }
    responseCache.invalidateUser(user.id);
    return reply.send(folderSchema.parse(folder));
  });

  app.delete<{ Params: { folderId: string } }>("/private/folders/:folderId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = folderParamsSchema.parse(request.params);
    const deleted = await repository.deletePrivateFolder(user.id, params.folderId);
    if (!deleted) {
      return reply.status(404).send({
        error: "FolderNotFound",
        message: "Folder not found.",
      });
    }
    responseCache.invalidateUser(user.id);
    return reply.status(204).send();
  });

  app.get("/private/tags", async (request, reply) => {
    const user = await requirePrivateUser(request);
    return responseCache.sendJson(request, reply, {
      scope: "private-tags",
      userId: user.id,
      load: async () => {
        const items = await repository.listPrivateTags(user.id);
        return tagListResponseSchema.parse({ items });
      },
    });
  });

  app.post("/private/tags", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const body = tagCreateRequestSchema.parse(request.body);
    const tag = await repository.createPrivateTag(user.id, body);
    responseCache.invalidateUser(user.id);
    return reply.status(201).send(tagSchema.parse(tag));
  });

  app.patch<{ Params: { tagId: string } }>("/private/tags/:tagId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = tagParamsSchema.parse(request.params);
    const body = tagUpdateRequestSchema.parse(request.body);
    const tag = await repository.updatePrivateTag(user.id, params.tagId, body);
    if (!tag) {
      return reply.status(404).send({
        error: "TagNotFound",
        message: "Tag not found.",
      });
    }
    responseCache.invalidateUser(user.id);
    return reply.send(tagSchema.parse(tag));
  });

  app.delete<{ Params: { tagId: string } }>("/private/tags/:tagId", async (request, reply) => {
    const user = await requirePrivateUser(request);
    const params = tagParamsSchema.parse(request.params);
    const deleted = await repository.deletePrivateTag(user.id, params.tagId);
    if (!deleted) {
      return reply.status(404).send({
        error: "TagNotFound",
        message: "Tag not found.",
      });
    }
    responseCache.invalidateUser(user.id);
    return reply.status(204).send();
  });
}
