import { z } from "zod";
import { bookmarkSchema } from "./capture";

export const apiTokenScopeValues = ["bookmark:create"] as const;
export const ingestBookmarkStatusValues = ["created", "merged", "skipped"] as const;
export const ingestBookmarkDedupeStrategyValues = ["merge", "skip"] as const;

export const apiTokenScopeSchema = z.enum(apiTokenScopeValues);
export const ingestBookmarkStatusSchema = z.enum(ingestBookmarkStatusValues);
export const ingestBookmarkDedupeStrategySchema = z.enum(ingestBookmarkDedupeStrategyValues);

const apiTokenNameSchema = z.string().trim().min(1).max(120);
const apiTokenPreviewSchema = z.string().min(1).max(80);
const tagNameSchema = z.string().trim().min(1).max(80);
const folderPathSchema = z.string().trim().min(1).max(500);

export const apiTokenSchema = z.object({
  id: z.string().min(1),
  name: apiTokenNameSchema,
  tokenPreview: apiTokenPreviewSchema,
  scopes: z.array(apiTokenScopeSchema).min(1).max(10),
  lastUsedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export const apiTokenListResponseSchema = z.object({
  items: z.array(apiTokenSchema),
});

export const apiTokenCreateRequestSchema = z.object({
  name: apiTokenNameSchema,
  scopes: z.array(apiTokenScopeSchema).min(1).max(10).default(["bookmark:create"]),
  expiresAt: z.string().datetime().optional(),
});

export const apiTokenCreateResponseSchema = z.object({
  token: z.string().min(1),
  item: apiTokenSchema,
});

export const ingestBookmarkRequestSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1).max(500).optional(),
  note: z.string().max(4000).optional(),
  tags: z.array(tagNameSchema).max(100).optional(),
  folderPath: folderPathSchema.optional(),
  dedupeStrategy: ingestBookmarkDedupeStrategySchema.default("merge"),
});

export const ingestBookmarkResponseSchema = z.object({
  bookmarkId: z.string().min(1),
  status: ingestBookmarkStatusSchema,
  deduplicated: z.boolean(),
  bookmark: bookmarkSchema,
});

export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;
export type ApiToken = z.infer<typeof apiTokenSchema>;
export type ApiTokenCreateRequest = z.infer<typeof apiTokenCreateRequestSchema>;
export type ApiTokenCreateResponse = z.infer<typeof apiTokenCreateResponseSchema>;
export type ApiTokenListResponse = z.infer<typeof apiTokenListResponseSchema>;
export type IngestBookmarkStatus = z.infer<typeof ingestBookmarkStatusSchema>;
export type IngestBookmarkDedupeStrategy = z.infer<typeof ingestBookmarkDedupeStrategySchema>;
export type IngestBookmarkRequest = z.infer<typeof ingestBookmarkRequestSchema>;
export type IngestBookmarkResponse = z.infer<typeof ingestBookmarkResponseSchema>;
