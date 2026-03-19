import { z } from "zod";
import {
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

export type PrivateVaultSummary = z.infer<typeof privateVaultSummarySchema>;
export type PrivateCaptureTaskShell = z.infer<typeof privateCaptureTaskShellSchema>;
