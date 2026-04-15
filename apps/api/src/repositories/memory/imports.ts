import type { ImportTask, ImportTaskDetailResponse } from "@keeppage/domain";
import type {
  CreateImportTaskInput,
  ImportBookmarkMatch,
} from "../bookmark-repository";
import type { InMemoryRepositoryCore } from "./core";

export function findImportBookmarkMatches(
  core: InMemoryRepositoryCore,
  userId: string,
  normalizedUrlHashes: string[],
): Promise<ImportBookmarkMatch[]> {
  return core.findImportBookmarkMatches(userId, normalizedUrlHashes);
}

export function createImportTask(
  core: InMemoryRepositoryCore,
  userId: string,
  input: CreateImportTaskInput,
): Promise<ImportTaskDetailResponse> {
  return core.createImportTask(userId, input);
}

export function listImportTasks(core: InMemoryRepositoryCore, userId: string): Promise<ImportTask[]> {
  return core.listImportTasks(userId);
}

export function getImportTaskDetail(
  core: InMemoryRepositoryCore,
  userId: string,
  taskId: string,
): Promise<ImportTaskDetailResponse | null> {
  return core.getImportTaskDetail(userId, taskId);
}
