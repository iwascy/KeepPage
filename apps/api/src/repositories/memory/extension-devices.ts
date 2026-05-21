import type { ExtensionDevice } from "@keeppage/domain";
import type {
  CreateExtensionDeviceInput,
  ExtensionDeviceAuthRecord,
} from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function createExtensionDevice(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CreateExtensionDeviceInput,
): Promise<ExtensionDevice> {
  return core.createExtensionDevice(userId, input);
}

export function listExtensionDevices(
  core: InMemoryRepositoryCore,
  userId: string,
): Promise<ExtensionDevice[]> {
  return core.listExtensionDevices(userId);
}

export function getExtensionDeviceAuthRecord(
  core: InMemoryRepositoryCore,
  deviceId: string,
): Promise<ExtensionDeviceAuthRecord | null> {
  return core.getExtensionDeviceAuthRecord(deviceId);
}

export function revokeExtensionDevice(
  core: InMemoryRepositoryCore,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  return core.revokeExtensionDevice(userId, deviceId);
}

export function touchExtensionDevice(
  core: InMemoryRepositoryCore,
  deviceId: string,
  usedAt: string,
): Promise<void> {
  return core.touchExtensionDevice(deviceId, usedAt);
}
