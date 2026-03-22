import type {
  CapturePageSignals,
  CaptureProfile,
  CaptureScope,
  CaptureSource,
  CaptureTask,
  PrivateAutoLock,
  PrivateVaultSummary,
  SaveMode,
} from "@keeppage/domain";

export const MESSAGE_TYPE = {
  CollectLiveSignals: "keeppage/collect-live-signals",
  CaptureArchiveHtml: "keeppage/capture-archive-html",
  ShowInPageToast: "keeppage/show-in-page-toast",
  ListTasks: "keeppage/list-tasks",
  StartSelectionCapture: "keeppage/start-selection-capture",
  TriggerCaptureActiveTab: "keeppage/trigger-capture-active-tab",
  RetryTask: "keeppage/retry-task",
  OpenTaskPreview: "keeppage/open-task-preview",
  GetPrivateVaultState: "keeppage/get-private-vault-state",
  CreatePrivateVault: "keeppage/create-private-vault",
  UnlockPrivateVault: "keeppage/unlock-private-vault",
  LockPrivateVault: "keeppage/lock-private-vault",
  TaskUpdated: "keeppage/task-updated",
  DebugLog: "keeppage/debug-log",
} as const;

export interface CollectLiveSignalsRequest {
  type: typeof MESSAGE_TYPE.CollectLiveSignals;
  captureScope?: CaptureScope;
}

export interface CollectLiveSignalsResponse {
  ok: boolean;
  sourcePatch?: Partial<CaptureSource>;
  liveSignals?: CapturePageSignals;
  error?: string;
}

export interface CaptureArchiveHtmlRequest {
  type: typeof MESSAGE_TYPE.CaptureArchiveHtml;
  profile: CaptureProfile;
  captureScope?: CaptureScope;
}

export interface CaptureArchiveHtmlResponse {
  ok: boolean;
  archiveHtml?: string;
  readerHtml?: string;
  usedSingleFile?: boolean;
  error?: string;
}

export interface ShowInPageToastRequest {
  type: typeof MESSAGE_TYPE.ShowInPageToast;
  title: string;
  message?: string;
  tone?: "success";
}

export interface ShowInPageToastResponse {
  ok: boolean;
}

export interface ListTasksRequest {
  type: typeof MESSAGE_TYPE.ListTasks;
  limit?: number;
  saveMode?: SaveMode;
}

export interface ListTasksResponse {
  ok: boolean;
  tasks: CaptureTask[];
}

export interface StartSelectionCaptureRequest {
  type: typeof MESSAGE_TYPE.StartSelectionCapture;
  profile?: CaptureProfile;
  saveMode?: SaveMode;
}

export interface StartSelectionCaptureResponse {
  ok: boolean;
  error?: string;
}

export interface TriggerCaptureActiveTabRequest {
  type: typeof MESSAGE_TYPE.TriggerCaptureActiveTab;
  profile?: CaptureProfile;
  saveMode?: SaveMode;
  captureScope?: CaptureScope;
}

export interface RetryTaskRequest {
  type: typeof MESSAGE_TYPE.RetryTask;
  taskId: string;
  profile?: CaptureProfile;
  saveMode?: SaveMode;
}

export interface OpenTaskPreviewRequest {
  type: typeof MESSAGE_TYPE.OpenTaskPreview;
  taskId: string;
}

export interface GetPrivateVaultStateRequest {
  type: typeof MESSAGE_TYPE.GetPrivateVaultState;
}

export interface PrivateVaultStateResponse {
  ok: boolean;
  summary?: PrivateVaultSummary;
  recoveryCode?: string;
  error?: string;
}

export interface CreatePrivateVaultRequest {
  type: typeof MESSAGE_TYPE.CreatePrivateVault;
  passphrase: string;
  autoLock: PrivateAutoLock;
}

export interface UnlockPrivateVaultRequest {
  type: typeof MESSAGE_TYPE.UnlockPrivateVault;
  passphrase: string;
}

export interface LockPrivateVaultRequest {
  type: typeof MESSAGE_TYPE.LockPrivateVault;
}

export interface TaskUpdatedEvent {
  type: typeof MESSAGE_TYPE.TaskUpdated;
  task: CaptureTask;
}

export interface DebugLogEvent {
  type: typeof MESSAGE_TYPE.DebugLog;
  scope: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  details?: unknown;
}

export type ContentRequest =
  | CollectLiveSignalsRequest
  | CaptureArchiveHtmlRequest
  | StartSelectionCaptureRequest
  | ShowInPageToastRequest;
export type BackgroundRequest =
  | ListTasksRequest
  | StartSelectionCaptureRequest
  | TriggerCaptureActiveTabRequest
  | RetryTaskRequest
  | OpenTaskPreviewRequest
  | GetPrivateVaultStateRequest
  | CreatePrivateVaultRequest
  | UnlockPrivateVaultRequest
  | LockPrivateVaultRequest;

export function isContentRequest(message: unknown): message is ContentRequest {
  if (!message || typeof message !== "object") {
    return false;
  }
  const maybe = message as { type?: string };
  return (
    maybe.type === MESSAGE_TYPE.CollectLiveSignals ||
    maybe.type === MESSAGE_TYPE.CaptureArchiveHtml ||
    maybe.type === MESSAGE_TYPE.StartSelectionCapture ||
    maybe.type === MESSAGE_TYPE.ShowInPageToast
  );
}

export function isDebugLogEvent(message: unknown): message is DebugLogEvent {
  if (!message || typeof message !== "object") {
    return false;
  }
  const maybe = message as { type?: string };
  return maybe.type === MESSAGE_TYPE.DebugLog;
}

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  if (!message || typeof message !== "object") {
    return false;
  }
  const maybe = message as { type?: string };
  return (
    maybe.type === MESSAGE_TYPE.ListTasks ||
    maybe.type === MESSAGE_TYPE.StartSelectionCapture ||
    maybe.type === MESSAGE_TYPE.TriggerCaptureActiveTab ||
    maybe.type === MESSAGE_TYPE.RetryTask ||
    maybe.type === MESSAGE_TYPE.OpenTaskPreview ||
    maybe.type === MESSAGE_TYPE.GetPrivateVaultState ||
    maybe.type === MESSAGE_TYPE.CreatePrivateVault ||
    maybe.type === MESSAGE_TYPE.UnlockPrivateVault ||
    maybe.type === MESSAGE_TYPE.LockPrivateVault
  );
}
