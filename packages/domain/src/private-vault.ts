import { z } from "zod";
import {
  captureStatusSchema,
  captureTaskOwnerSchema,
} from "./capture";

export const saveModeValues = ["standard", "private"] as const;
export const privateModeValues = ["local-only", "encrypted-sync"] as const;
export const privateSyncStateValues = [
  "local-only",
  "sync-disabled",
  "sync-pending",
  "sync-failed",
] as const;
export const privateAutoLockValues = ["5m", "15m", "1h", "browser"] as const;

export const saveModeSchema = z.enum(saveModeValues);
export const privateModeSchema = z.enum(privateModeValues);
export const privateSyncStateSchema = z.enum(privateSyncStateValues);
export const privateAutoLockSchema = z.enum(privateAutoLockValues);

export const privateVaultSummarySchema = z.object({
  enabled: z.boolean(),
  unlocked: z.boolean(),
  autoLock: privateAutoLockSchema.default("15m"),
  totalItems: z.number().int().nonnegative().default(0),
  pendingSyncCount: z.number().int().nonnegative().default(0),
  syncEnabled: z.boolean().default(false),
  lastUpdatedAt: z.string().datetime().optional(),
});

export const privateCaptureTaskShellSchema = z.object({
  id: z.string().min(1),
  status: captureStatusSchema,
  owner: captureTaskOwnerSchema.optional(),
  isPrivate: z.literal(true),
  privateMode: privateModeSchema.default("local-only"),
  syncState: privateSyncStateSchema.default("local-only"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  failureReason: z.string().optional(),
});

export type SaveMode = z.infer<typeof saveModeSchema>;
export type PrivateMode = z.infer<typeof privateModeSchema>;
export type PrivateSyncState = z.infer<typeof privateSyncStateSchema>;
export type PrivateAutoLock = z.infer<typeof privateAutoLockSchema>;
export type PrivateVaultSummary = z.infer<typeof privateVaultSummarySchema>;
export type PrivateCaptureTaskShell = z.infer<typeof privateCaptureTaskShellSchema>;
