import type {
  CaptureStatus,
  CaptureTask,
} from "@keeppage/domain";
import { dbPromise } from "./extension-db";
import {
  assertCaptureStatusTransition,
  captureTaskSchema,
} from "./domain-runtime";

export async function putCaptureTask(task: CaptureTask) {
  captureTaskSchema.parse(task);
  const database = await dbPromise;
  await database.put("captureTasks", task);
  return task;
}

export async function getCaptureTask(taskId: string) {
  const database = await dbPromise;
  const task = await database.get("captureTasks", taskId);
  return task ? captureTaskSchema.parse(task) : null;
}

export async function listCaptureTasks(limit = 20, ownerUserId?: string) {
  const database = await dbPromise;
  const tasks = await database.getAll("captureTasks");
  return tasks
    .map((task) => captureTaskSchema.parse(task))
    .filter((task) => (ownerUserId ? task.owner?.userId === ownerUserId : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

export async function patchCaptureTask(
  taskId: string,
  patch: Partial<CaptureTask>,
) {
  const database = await dbPromise;
  const existing = await database.get("captureTasks", taskId);
  if (!existing) {
    throw new Error(`Capture task ${taskId} does not exist.`);
  }
  const merged = captureTaskSchema.parse({
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  });
  await database.put("captureTasks", merged);
  return merged;
}

export async function transitionCaptureTaskStatus(
  taskId: string,
  nextStatus: CaptureStatus,
  patch: Partial<CaptureTask> = {},
) {
  const database = await dbPromise;
  const existing = await database.get("captureTasks", taskId);
  if (!existing) {
    throw new Error(`Capture task ${taskId} does not exist.`);
  }
  assertCaptureStatusTransition(existing.status, nextStatus);
  const updated = captureTaskSchema.parse({
    ...existing,
    ...patch,
    id: existing.id,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });
  await database.put("captureTasks", updated);
  return updated;
}
