import type { FastifyInstance } from "fastify";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerHealthRoutes } from "./health";
import { registerUploadRoutes } from "./uploads";

export async function registerRoutes(
  app: FastifyInstance,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, repository, objectStorage);
  await registerUploadRoutes(app, objectStorage);
  await registerBookmarkRoutes(app, repository, objectStorage);
}
