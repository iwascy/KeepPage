import type {
  CapturePageSignals,
  CaptureProfile,
  CaptureSource,
  CaptureTask,
} from "@keeppage/domain";

export const MESSAGE_TYPE = {
  CollectLiveSignals: "keeppage/collect-live-signals",
  CaptureArchiveHtml: "keeppage/capture-archive-html",
  ListTasks: "keeppage/list-tasks",
  TriggerCaptureActiveTab: "keeppage/trigger-capture-active-tab",
  RetryTask: "keeppage/retry-task",
  OpenTaskPreview: "keeppage/open-task-preview",
  TaskUpdated: "keeppage/task-updated",
} as const;

export interface CollectLiveSignalsRequest {
  type: typeof MESSAGE_TYPE.CollectLiveSignals;
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
}

export interface CaptureArchiveHtmlResponse {
  ok: boolean;
  archiveHtml?: string;
  usedSingleFile?: boolean;
  error?: string;
}

export interface ListTasksRequest {
  type: typeof MESSAGE_TYPE.ListTasks;
  limit?: number;
}

export interface ListTasksResponse {
  ok: boolean;
  tasks: CaptureTask[];
}

export interface TriggerCaptureActiveTabRequest {
  type: typeof MESSAGE_TYPE.TriggerCaptureActiveTab;
  profile?: CaptureProfile;
}

export interface RetryTaskRequest {
  type: typeof MESSAGE_TYPE.RetryTask;
  taskId: string;
  profile?: CaptureProfile;
}

export interface OpenTaskPreviewRequest {
  type: typeof MESSAGE_TYPE.OpenTaskPreview;
  taskId: string;
}

export interface TaskUpdatedEvent {
  type: typeof MESSAGE_TYPE.TaskUpdated;
  task: CaptureTask;
}

export type ContentRequest = CollectLiveSignalsRequest | CaptureArchiveHtmlRequest;
export type BackgroundRequest =
  | ListTasksRequest
  | TriggerCaptureActiveTabRequest
  | RetryTaskRequest
  | OpenTaskPreviewRequest;

export function isContentRequest(message: unknown): message is ContentRequest {
  if (!message || typeof message !== "object") {
    return false;
  }
  const maybe = message as { type?: string };
  return (
    maybe.type === MESSAGE_TYPE.CollectLiveSignals ||
    maybe.type === MESSAGE_TYPE.CaptureArchiveHtml
  );
}

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  if (!message || typeof message !== "object") {
    return false;
  }
  const maybe = message as { type?: string };
  return (
    maybe.type === MESSAGE_TYPE.ListTasks ||
    maybe.type === MESSAGE_TYPE.TriggerCaptureActiveTab ||
    maybe.type === MESSAGE_TYPE.RetryTask ||
    maybe.type === MESSAGE_TYPE.OpenTaskPreview
  );
}
