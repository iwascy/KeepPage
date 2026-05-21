import type { PrivateVaultSummary } from "@keeppage/domain";
import type { PrivateModeConfigRecord } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function getPrivateModeConfig(
  core: InMemoryRepositoryCore,
  userId: string,
): Promise<PrivateModeConfigRecord | null> {
  return core.getPrivateModeConfig(userId);
}

export function enablePrivateMode(
  core: InMemoryRepositoryCore,
  input: {
    userId: string;
    passwordHash: string;
    passwordAlgo: string;
  },
): Promise<PrivateModeConfigRecord> {
  return core.enablePrivateMode(input);
}

export function getPrivateVaultSummary(
  core: InMemoryRepositoryCore,
  userId: string,
): Promise<PrivateVaultSummary> {
  return core.getPrivateVaultSummary(userId);
}
