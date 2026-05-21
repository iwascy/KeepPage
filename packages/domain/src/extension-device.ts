import { z } from "zod";
import { authUserSchema } from "./capture";

const extensionDeviceNameSchema = z.string().trim().min(1).max(120);
const extensionDevicePlatformSchema = z.string().trim().min(1).max(80);
const extensionDeviceTokenPreviewSchema = z.string().min(1).max(80);

export const extensionDeviceSchema = z.object({
  id: z.string().min(1),
  name: extensionDeviceNameSchema,
  platform: extensionDevicePlatformSchema,
  tokenPreview: extensionDeviceTokenPreviewSchema,
  lastUsedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export const extensionDeviceListResponseSchema = z.object({
  items: z.array(extensionDeviceSchema),
});

export const extensionConnectInitRequestSchema = z.object({
  deviceName: extensionDeviceNameSchema,
  platform: extensionDevicePlatformSchema,
  extensionId: z.string().trim().min(1).max(120).optional(),
});

export const extensionConnectInitResponseSchema = z.object({
  code: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const extensionConnectRedeemRequestSchema = z.object({
  code: z.string().trim().min(1),
});

export const extensionDeviceSessionSchema = z.object({
  token: z.string().min(1),
  device: extensionDeviceSchema,
  user: authUserSchema,
});

export type ExtensionDevice = z.infer<typeof extensionDeviceSchema>;
export type ExtensionDeviceListResponse = z.infer<typeof extensionDeviceListResponseSchema>;
export type ExtensionConnectInitRequest = z.infer<typeof extensionConnectInitRequestSchema>;
export type ExtensionConnectInitResponse = z.infer<typeof extensionConnectInitResponseSchema>;
export type ExtensionConnectRedeemRequest = z.infer<typeof extensionConnectRedeemRequestSchema>;
export type ExtensionDeviceSession = z.infer<typeof extensionDeviceSessionSchema>;
