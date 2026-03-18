import type { FastifyInstance } from "fastify";
import type { BookmarkRepository } from "../repositories";
import { registerBookmarkRoutes } from "./bookmarks";
import { registerCaptureRoutes } from "./captures";
import { registerHealthRoutes } from "./health";

export async function registerRoutes(app: FastifyInstance, repository: BookmarkRepository) {
  await registerHealthRoutes(app, repository);
  await registerCaptureRoutes(app, repository);
  await registerBookmarkRoutes(app, repository);
}
