import { z } from "zod";

export const saveModeValues = ["standard", "private"] as const;
export const privateModeValues = ["local-only", "encrypted-sync", "password-gated"] as const;
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

export type SaveMode = z.infer<typeof saveModeSchema>;
export type PrivateMode = z.infer<typeof privateModeSchema>;
export type PrivateSyncState = z.infer<typeof privateSyncStateSchema>;
export type PrivateAutoLock = z.infer<typeof privateAutoLockSchema>;
