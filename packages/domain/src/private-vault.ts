import { z } from "zod";
import {
  bookmarkDetailResponseSchema,
  bookmarkSearchResponseSchema,
  captureStatusSchema,
  captureTaskOwnerSchema,
} from "./capture";
import {
  privateAutoLockSchema,
  privateModeSchema,
  privateSyncStateSchema,
} from "./private-mode";

export const privateVaultSummarySchema = z.object({
  enabled: z.boolean(),
  unlocked: z.boolean(),
  autoLock: privateAutoLockSchema.default("browser"),
  totalItems: z.number().int().nonnegative().default(0),
  pendingSyncCount: z.number().int().nonnegative().default(0),
  syncEnabled: z.boolean().default(true),
  lastUpdatedAt: z.string().datetime().optional(),
});

export const privateCaptureTaskShellSchema = z.object({
  id: z.string().min(1),
  status: captureStatusSchema,
  owner: captureTaskOwnerSchema.optional(),
  isPrivate: z.literal(true),
  privateMode: privateModeSchema.default("password-gated"),
  syncState: privateSyncStateSchema.default("sync-pending"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  failureReason: z.string().optional(),
});

export const privateModeSetupRequestSchema = z.object({
  password: z.string().min(8).max(128),
});

export const privateModeUnlockRequestSchema = z.object({
  password: z.string().min(1).max(128),
});

export const privateModeUnlockResponseSchema = z.object({
  summary: privateVaultSummarySchema,
  privateToken: z.string().min(1),
});

export const privateBookmarkSearchResponseSchema = bookmarkSearchResponseSchema;
export const privateBookmarkDetailResponseSchema = bookmarkDetailResponseSchema;

export type PrivateVaultSummary = z.infer<typeof privateVaultSummarySchema>;
export type PrivateCaptureTaskShell = z.infer<typeof privateCaptureTaskShellSchema>;
export type PrivateModeSetupRequest = z.infer<typeof privateModeSetupRequestSchema>;
export type PrivateModeUnlockRequest = z.infer<typeof privateModeUnlockRequestSchema>;
export type PrivateModeUnlockResponse = z.infer<typeof privateModeUnlockResponseSchema>;
