import type { PrivateVaultSummary } from "@keeppage/domain";
import type { PrivateModeConfigRecord } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function getPrivateModeConfig(
  core: PostgresRepositoryCore,
  userId: string,
): Promise<PrivateModeConfigRecord | null> {
  return core.getPrivateModeConfig(userId);
}

export function enablePrivateMode(
  core: PostgresRepositoryCore,
  input: {
    userId: string;
    passwordHash: string;
    passwordAlgo: string;
  },
): Promise<PrivateModeConfigRecord> {
  return core.enablePrivateMode(input);
}

export function getPrivateVaultSummary(
  core: PostgresRepositoryCore,
  userId: string,
): Promise<PrivateVaultSummary> {
  return core.getPrivateVaultSummary(userId);
}
