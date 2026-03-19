import {
  assertCaptureStatusTransition,
  captureTaskSchema,
  type CaptureStatus,
  type CaptureTask,
} from "@keeppage/domain";
import { openDB, type DBSchema } from "idb";

const DB_NAME = "keeppage-extension";
const DB_VERSION = 1;

interface KeepPageExtensionDB extends DBSchema {
  captureTasks: {
    key: string;
    value: CaptureTask;
    indexes: {
      "by-updated-at": string;
      "by-status": CaptureStatus;
    };
  };
}

const dbPromise = openDB<KeepPageExtensionDB>(DB_NAME, DB_VERSION, {
  upgrade(database) {
    const taskStore = database.createObjectStore("captureTasks", {
      keyPath: "id",
    });
    taskStore.createIndex("by-updated-at", "updatedAt");
    taskStore.createIndex("by-status", "status");
  },
});

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
