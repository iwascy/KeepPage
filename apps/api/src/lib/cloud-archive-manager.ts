import {
  createCloudArchiveTaskId,
  type CloudArchiveRequest,
  type CloudArchiveStatus,
  type CloudArchiveTask,
} from "@keeppage/domain";
import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "../repositories";
import type { ObjectStorage } from "../storage/object-storage";
import { processCloudArchive } from "./cloud-archive-worker";

type InternalTask = {
  taskId: string;
  userId: string;
  status: CloudArchiveStatus;
  url: string;
  title?: string;
  folderId?: string;
  tagIds?: string[];
  bookmarkId?: string;
  versionId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export class CloudArchiveManager {
  private readonly tasks = new Map<string, InternalTask>();
  private activeCount = 0;
  private readonly pending: string[] = [];

  constructor(
    private readonly config: ApiConfig,
    private readonly repository: BookmarkRepository,
    private readonly objectStorage: ObjectStorage,
  ) {}

  submit(userId: string, input: CloudArchiveRequest): CloudArchiveTask {
    const now = new Date().toISOString();
    const task: InternalTask = {
      taskId: createCloudArchiveTaskId(),
      userId,
      status: "queued",
      url: input.url,
      title: input.title,
      folderId: input.folderId,
      tagIds: input.tagIds,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.taskId, task);
    this.pending.push(task.taskId);
    this.drain();
    return this.toPublicTask(task);
  }

  getTask(userId: string, taskId: string): CloudArchiveTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      return null;
    }
    return this.toPublicTask(task);
  }

  private drain() {
    while (
      this.activeCount < this.config.CLOUD_ARCHIVE_MAX_CONCURRENT &&
      this.pending.length > 0
    ) {
      const taskId = this.pending.shift()!;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "queued") {
        continue;
      }
      this.activeCount++;
      this.execute(task);
    }
  }

  private execute(task: InternalTask) {
    this.updateStatus(task, "fetching");

    processCloudArchive({
      userId: task.userId,
      url: task.url,
      title: task.title,
      folderId: task.folderId,
      tagIds: task.tagIds,
      config: this.config,
      repository: this.repository,
      objectStorage: this.objectStorage,
    })
      .then((result) => {
        task.bookmarkId = result.bookmarkId;
        task.versionId = result.versionId;
        this.updateStatus(task, "completed");
      })
      .catch((error) => {
        task.errorMessage = error instanceof Error
          ? error.message
          : "Unknown error";
        this.updateStatus(task, "failed");
      })
      .finally(() => {
        this.activeCount--;
        this.drain();
      });
  }

  private updateStatus(task: InternalTask, status: CloudArchiveStatus) {
    task.status = status;
    task.updatedAt = new Date().toISOString();
  }

  private toPublicTask(task: InternalTask): CloudArchiveTask {
    return {
      taskId: task.taskId,
      status: task.status,
      url: task.url,
      title: task.title,
      bookmarkId: task.bookmarkId,
      versionId: task.versionId,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}
