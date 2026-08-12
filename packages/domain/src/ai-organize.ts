import { z } from "zod";

export const aiConnectionStatusSchema = z.enum(["unverified", "verified", "failed"]);

export const aiSettingsSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  hasApiKey: z.boolean(),
  keyPreview: z.string().optional(),
  connectionStatus: aiConnectionStatusSchema,
  verifiedAt: z.string().datetime().optional(),
});

export const aiSettingsUpdateRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(4096).optional(),
  model: z.string().trim().min(1).max(120),
});

export const aiSettingsTestRequestSchema = aiSettingsUpdateRequestSchema;

export const aiSettingsTestResponseSchema = z.object({
  ok: z.boolean(),
  responseModel: z.string().optional(),
  latencyMs: z.number().int().nonnegative(),
});

export const aiOrganizationJobStatusSchema = z.enum([
  "queued",
  "classifying",
  "applying",
  "completed",
  "failed",
  "cancelled",
]);

export const aiOrganizationJobSchema = z.object({
  id: z.string().min(1),
  status: aiOrganizationJobStatusSchema,
  totalItems: z.number().int().nonnegative(),
  processedItems: z.number().int().nonnegative(),
  updatedItems: z.number().int().nonnegative(),
  unchangedItems: z.number().int().nonnegative(),
  lowConfidenceItems: z.number().int().nonnegative(),
  skippedItems: z.number().int().nonnegative(),
  folderUpdatedItems: z.number().int().nonnegative(),
  tagsUpdatedItems: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export const aiOrganizationJobItemStatusSchema = z.enum([
  "updated",
  "unchanged",
  "low_confidence",
  "skipped",
]);

export const aiOrganizationJobItemSchema = z.object({
  bookmarkId: z.string().min(1),
  title: z.string(),
  site: z.string(),
  status: aiOrganizationJobItemStatusSchema,
  sourceFolderPath: z.string().optional(),
  targetFolderPath: z.string().optional(),
  sourceTags: z.array(z.string()),
  targetTags: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
  errorCode: z.string().optional(),
});

export const aiOrganizationJobItemListSchema = z.object({
  items: z.array(aiOrganizationJobItemSchema),
  total: z.number().int().nonnegative(),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiSettingsUpdateRequest = z.infer<typeof aiSettingsUpdateRequestSchema>;
export type AiSettingsTestRequest = z.infer<typeof aiSettingsTestRequestSchema>;
export type AiSettingsTestResponse = z.infer<typeof aiSettingsTestResponseSchema>;
export type AiOrganizationJob = z.infer<typeof aiOrganizationJobSchema>;
export type AiOrganizationJobStatus = z.infer<typeof aiOrganizationJobStatusSchema>;
export type AiOrganizationJobItem = z.infer<typeof aiOrganizationJobItemSchema>;
export type AiOrganizationJobItemStatus = z.infer<typeof aiOrganizationJobItemStatusSchema>;
export type AiOrganizationJobItemList = z.infer<typeof aiOrganizationJobItemListSchema>;
