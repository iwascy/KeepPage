import { z } from "zod";

export const SHARE_MAX_ITEMS = 100;
export const SHARE_MAX_ACTIVE_PER_USER = 50;

export const shareStatusValues = ["active", "revoked"] as const;
export const shareStatusSchema = z.enum(shareStatusValues);

const shareTitleSchema = z.string().trim().min(1).max(80);
const shareDescriptionSchema = z.string().trim().max(500);
const shareBookmarkIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(SHARE_MAX_ITEMS);

export const publicShareTagSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().max(32).optional(),
});

export const publicShareItemSchema = z.object({
  title: z.string().min(1),
  sourceUrl: z.url(),
  domain: z.string().min(1),
  faviconUrl: z.url().optional(),
  note: z.string().default(""),
  tags: z.array(publicShareTagSchema).default([]),
  updatedAt: z.string().datetime(),
  hasArchive: z.boolean().default(false),
});

export const publicShareResponseSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  ownerDisplayName: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  items: z.array(publicShareItemSchema),
});

export const shareSchema = z.object({
  id: z.string().min(1),
  title: shareTitleSchema,
  description: z.string().default(""),
  status: shareStatusSchema,
  publicToken: z.string().min(1),
  publicUrl: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
});

export const shareOwnerItemSchema = z.object({
  bookmarkId: z.string().min(1),
  position: z.number().int().nonnegative(),
  title: z.string().min(1),
  domain: z.string().min(1),
  sourceUrl: z.url(),
});

export const shareDetailSchema = shareSchema.extend({
  items: z.array(shareOwnerItemSchema),
});

export const shareListResponseSchema = z.object({
  items: z.array(shareSchema),
});

export const shareCreateRequestSchema = z.object({
  title: shareTitleSchema,
  description: shareDescriptionSchema.optional(),
  bookmarkIds: shareBookmarkIdsSchema,
});

export const shareCreateResponseSchema = z.object({
  share: shareSchema,
});

export const shareDetailResponseSchema = z.object({
  share: shareDetailSchema,
});

export const shareUpdateRequestSchema = z.object({
  title: shareTitleSchema.optional(),
  description: shareDescriptionSchema.optional(),
  bookmarkIds: shareBookmarkIdsSchema.optional(),
}).refine(
  (value) =>
    value.title !== undefined
    || value.description !== undefined
    || value.bookmarkIds !== undefined,
  { message: "At least one field must be updated." },
);

export const shareUpdateResponseSchema = z.object({
  share: shareDetailSchema,
});

export const shareRevokeResponseSchema = z.object({
  share: shareSchema,
});

export type ShareStatus = z.infer<typeof shareStatusSchema>;
export type PublicShareTag = z.infer<typeof publicShareTagSchema>;
export type PublicShareItem = z.infer<typeof publicShareItemSchema>;
export type PublicShareResponse = z.infer<typeof publicShareResponseSchema>;
export type Share = z.infer<typeof shareSchema>;
export type ShareOwnerItem = z.infer<typeof shareOwnerItemSchema>;
export type ShareDetail = z.infer<typeof shareDetailSchema>;
export type ShareListResponse = z.infer<typeof shareListResponseSchema>;
export type ShareCreateRequest = z.infer<typeof shareCreateRequestSchema>;
export type ShareCreateResponse = z.infer<typeof shareCreateResponseSchema>;
export type ShareDetailResponse = z.infer<typeof shareDetailResponseSchema>;
export type ShareUpdateRequest = z.infer<typeof shareUpdateRequestSchema>;
export type ShareUpdateResponse = z.infer<typeof shareUpdateResponseSchema>;
export type ShareRevokeResponse = z.infer<typeof shareRevokeResponseSchema>;

export function createShareId() {
  return crypto.randomUUID();
}

export function buildOwnerDisplayName(input: { name?: string | null; email: string }) {
  const name = input.name?.trim();
  if (name) {
    return name;
  }
  const local = input.email.split("@")[0]?.trim();
  if (local) {
    return local;
  }
  return "KeepPage 用户";
}

export function buildSharePublicUrl(webBaseUrl: string, publicToken: string) {
  const path = `/s/${encodeURIComponent(publicToken)}`;
  const base = webBaseUrl.trim().replace(/\/$/, "");
  if (!base) {
    // Relative path when WEB_PUBLIC_BASE_URL is unset (Web can prefix origin on copy).
    return path;
  }
  return `${base}${path}`;
}

/** Prefer absolute origin for clipboard / open-in-browser on the Web client. */
export function resolveSharePublicUrl(input: {
  publicToken: string;
  publicUrl?: string;
  origin?: string;
}) {
  if (input.publicUrl && /^https?:\/\//i.test(input.publicUrl)) {
    return input.publicUrl;
  }
  const origin = (input.origin ?? "").replace(/\/$/, "");
  if (origin) {
    return `${origin}/s/${encodeURIComponent(input.publicToken)}`;
  }
  return input.publicUrl || `/s/${encodeURIComponent(input.publicToken)}`;
}

export function isValidHttpUrl(value: string | undefined | null): value is string {
  if (!value?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizePublicShareResponse(input: PublicShareResponse): PublicShareResponse {
  const items = input.items
    .map((item) => {
      if (!isValidHttpUrl(item.sourceUrl)) {
        return null;
      }
      return {
        title: item.title.trim() || item.domain || "未命名书签",
        sourceUrl: item.sourceUrl,
        domain: item.domain.trim() || "unknown",
        faviconUrl: isValidHttpUrl(item.faviconUrl) ? item.faviconUrl : undefined,
        note: item.note ?? "",
        tags: (item.tags ?? [])
          .filter((tag) => tag.name?.trim())
          .map((tag) => ({
            name: tag.name.trim(),
            color: tag.color,
          })),
        updatedAt: item.updatedAt,
        hasArchive: Boolean(item.hasArchive),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    title: input.title.trim() || "未命名分享",
    description: input.description ?? "",
    ownerDisplayName: input.ownerDisplayName.trim() || "KeepPage 用户",
    itemCount: items.length,
    updatedAt: input.updatedAt,
    items,
  };
}
