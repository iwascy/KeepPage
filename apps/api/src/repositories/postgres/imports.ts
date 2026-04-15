import type { ImportTask, ImportTaskDetailResponse } from "@keeppage/domain";
import type {
  CreateImportTaskInput,
  ImportBookmarkMatch,
} from "../bookmark-repository";
import type { PostgresRepositoryCore } from "./core";

export function findImportBookmarkMatches(
  core: PostgresRepositoryCore,
  userId: string,
  normalizedUrlHashes: string[],
): Promise<ImportBookmarkMatch[]> {
  return core.findImportBookmarkMatches(userId, normalizedUrlHashes);
}

export function createImportTask(
  core: PostgresRepositoryCore,
  userId: string,
  input: CreateImportTaskInput,
): Promise<ImportTaskDetailResponse> {
  return core.createImportTask(userId, input);
}

export function listImportTasks(core: PostgresRepositoryCore, userId: string): Promise<ImportTask[]> {
  return core.listImportTasks(userId);
}

export function getImportTaskDetail(
  core: PostgresRepositoryCore,
  userId: string,
  taskId: string,
): Promise<ImportTaskDetailResponse | null> {
  return core.getImportTaskDetail(userId, taskId);
}
