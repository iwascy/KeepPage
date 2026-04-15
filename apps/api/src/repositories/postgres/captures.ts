import type { CaptureCompleteRequest, CaptureInitRequest } from "@keeppage/domain";
import type { CompleteCaptureResult, InitCaptureResult } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function initCapture(
  core: PostgresRepositoryCore,
  userId: string,
  input: CaptureInitRequest,
): Promise<InitCaptureResult> {
  return core.initCapture(userId, input);
}

export function completeCapture(
  core: PostgresRepositoryCore,
  userId: string,
  input: CaptureCompleteRequest,
): Promise<CompleteCaptureResult> {
  return core.completeCapture(userId, input);
}
