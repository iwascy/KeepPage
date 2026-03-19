import {
  tagCreateRequestSchema,
  tagListResponseSchema,
  tagSchema,
  tagUpdateRequestSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../lib/auth-service";
import type { BookmarkRepository } from "../repositories";

const tagParamsSchema = z.object({
  tagId: z.string().min(1),
});

export async function registerTagRoutes(
  app: FastifyInstance,
  authService: AuthService,
  repository: BookmarkRepository,
) {
  app.get("/tags", async (request, reply) => {
    const user = await authService.requireUser(request);
    const items = await repository.listTags(user.id);
    return reply.send(tagListResponseSchema.parse({ items }));
  });

  app.post("/tags", async (request, reply) => {
    const user = await authService.requireUser(request);
    const body = tagCreateRequestSchema.parse(request.body);
    const tag = await repository.createTag(user.id, body);
    return reply.status(201).send(tagSchema.parse(tag));
  });

  app.patch<{ Params: { tagId: string } }>("/tags/:tagId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = tagParamsSchema.parse(request.params);
    const body = tagUpdateRequestSchema.parse(request.body);
    const tag = await repository.updateTag(user.id, params.tagId, body);
    if (!tag) {
      return reply.status(404).send({
        error: "TagNotFound",
        message: "Tag not found.",
      });
    }
    return reply.send(tagSchema.parse(tag));
  });

  app.delete<{ Params: { tagId: string } }>("/tags/:tagId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = tagParamsSchema.parse(request.params);
    const deleted = await repository.deleteTag(user.id, params.tagId);
    if (!deleted) {
      return reply.status(404).send({
        error: "TagNotFound",
        message: "Tag not found.",
      });
    }
    return reply.status(204).send();
  });
}
