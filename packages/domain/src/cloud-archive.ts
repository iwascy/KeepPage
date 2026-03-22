import { z } from "zod";

export const cloudArchiveStatusValues = [
  "queued",
  "fetching",
  "processing",
  "completed",
  "failed",
] as const;

export const cloudArchiveStatusSchema = z.enum(cloudArchiveStatusValues);

export type CloudArchiveStatus = z.infer<typeof cloudArchiveStatusSchema>;

export const cloudArchiveRequestSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1).max(500).optional(),
  folderId: z.string().min(1).optional(),
  tagIds: z.array(z.string().min(1)).max(100).optional(),
});

export const cloudArchiveResponseSchema = z.object({
  taskId: z.string().min(1),
  status: cloudArchiveStatusSchema,
});

export const cloudArchiveTaskSchema = z.object({
  taskId: z.string().min(1),
  status: cloudArchiveStatusSchema,
  url: z.string().min(1),
  title: z.string().optional(),
  bookmarkId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CloudArchiveRequest = z.infer<typeof cloudArchiveRequestSchema>;
export type CloudArchiveResponse = z.infer<typeof cloudArchiveResponseSchema>;
export type CloudArchiveTask = z.infer<typeof cloudArchiveTaskSchema>;

export function createCloudArchiveTaskId() {
  return `ca_${crypto.randomUUID()}`;
}
