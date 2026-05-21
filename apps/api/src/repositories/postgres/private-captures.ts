import type { CaptureCompleteRequest, CaptureInitRequest } from "@keeppage/domain";
import type { CompleteCaptureResult, InitCaptureResult } from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function initPrivateCapture(
  core: PostgresRepositoryCore,
  userId: string,
  input: CaptureInitRequest,
): Promise<InitCaptureResult> {
  return core.initPrivateCapture(userId, input);
}

export function completePrivateCapture(
  core: PostgresRepositoryCore,
  userId: string,
  input: CaptureCompleteRequest,
): Promise<CompleteCaptureResult> {
  return core.completePrivateCapture(userId, input);
}
