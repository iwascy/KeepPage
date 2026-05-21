import type { CaptureCompleteRequest, CaptureInitRequest } from "@keeppage/domain";
import type { CompleteCaptureResult, InitCaptureResult } from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function initPrivateCapture(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CaptureInitRequest,
): Promise<InitCaptureResult> {
  return core.initPrivateCapture(userId, input);
}

export function completePrivateCapture(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CaptureCompleteRequest,
): Promise<CompleteCaptureResult> {
  return core.completePrivateCapture(userId, input);
}
