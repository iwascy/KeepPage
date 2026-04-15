import {
  bookmarks,
  bookmarkVersions,
  captureUploads,
  devices,
  folders,
  syncOps,
  tags,
  users,
} from "@keeppage/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RepositoryInfo } from "../repositories/bookmark-repository";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  storage: z.enum(["memory", "postgres"]),
  uptimeSec: z.number().nonnegative(),
  tables: z.array(z.string()),
  now: z.string().datetime(),
});

export async function registerHealthRoutes(
  app: FastifyInstance,
  repository: RepositoryInfo,
) {
  // 通过显式触达 schema 导出，确保 API 与 @keeppage/db 的表定义保持编译期关联。
  void users;
  void devices;
  void folders;
  void bookmarks;
  void captureUploads;
  void bookmarkVersions;
  void tags;
  void syncOps;

  const tableNames = [
    "users",
    "devices",
    "folders",
    "bookmarks",
    "capture_uploads",
    "bookmark_versions",
    "tags",
    "sync_ops",
  ];

  app.get("/health", async (_request, reply) => {
    const payload = healthResponseSchema.parse({
      status: "ok",
      storage: repository.kind,
      uptimeSec: process.uptime(),
      tables: tableNames,
      now: new Date().toISOString(),
    });
    return reply.send(payload);
  });
}
