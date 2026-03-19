import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerHealthRoutes } from "./health";
import { registerUploadRoutes } from "./uploads";

export async function registerRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  repository: BookmarkRepository,
  objectStorage: ObjectStorage,
) {
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, config, repository, objectStorage);
  await registerUploadRoutes(app, config, objectStorage);
  await registerBookmarkRoutes(app, repository, objectStorage);
}
