import type { ExtensionDevice } from "@keeppage/domain";
import type {
  CreateExtensionDeviceInput,
  ExtensionDeviceAuthRecord,
} from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function createExtensionDevice(
  core: PostgresRepositoryCore,
  userId: string,
  input: CreateExtensionDeviceInput,
): Promise<ExtensionDevice> {
  return core.createExtensionDevice(userId, input);
}

export function listExtensionDevices(
  core: PostgresRepositoryCore,
  userId: string,
): Promise<ExtensionDevice[]> {
  return core.listExtensionDevices(userId);
}

export function getExtensionDeviceAuthRecord(
  core: PostgresRepositoryCore,
  deviceId: string,
): Promise<ExtensionDeviceAuthRecord | null> {
  return core.getExtensionDeviceAuthRecord(deviceId);
}

export function revokeExtensionDevice(
  core: PostgresRepositoryCore,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  return core.revokeExtensionDevice(userId, deviceId);
}

export function touchExtensionDevice(
  core: PostgresRepositoryCore,
  deviceId: string,
  usedAt: string,
): Promise<void> {
  return core.touchExtensionDevice(deviceId, usedAt);
}
