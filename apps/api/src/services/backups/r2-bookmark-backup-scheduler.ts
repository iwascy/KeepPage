import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { ApiConfig } from "../../config";
import type { BookmarkRepository } from "../../repositories";
import type { BookmarkBackupService } from "./bookmark-backup-service";

type R2BookmarkBackupSchedulerOptions = {
  config: ApiConfig;
  repository: BookmarkRepository;
  backupService: BookmarkBackupService;
  logger: FastifyBaseLogger;
};

type UploadedUserBackup = {
  userId: string;
  email: string;
  key: string;
  fileName: string;
  sizeBytes: number;
};

export class R2BookmarkBackupScheduler {
  private readonly config: ApiConfig;
  private readonly repository: BookmarkRepository;
  private readonly backupService: BookmarkBackupService;
  private readonly logger: FastifyBaseLogger;
  private readonly client: S3Client | null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: R2BookmarkBackupSchedulerOptions) {
    this.config = options.config;
    this.repository = options.repository;
    this.backupService = options.backupService;
    this.logger = options.logger;
    this.client = this.config.BACKUP_R2_ENABLED ? this.createClient() : null;
  }

  start() {
    if (!this.config.BACKUP_R2_ENABLED) {
      return;
    }

    this.scheduleNextRun();
    if (this.config.BACKUP_R2_RUN_ON_STARTUP) {
      setTimeout(() => {
        this.runNow("startup").catch((error) => {
          this.logger.error({ err: error }, "Startup R2 bookmark backup failed");
        });
      }, 1000);
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runNow(trigger: "startup" | "schedule" | "manual" = "manual") {
    if (!this.config.BACKUP_R2_ENABLED || !this.client) {
      return {
        skipped: true,
        reason: "disabled",
      };
    }
    if (this.running) {
      return {
        skipped: true,
        reason: "already_running",
      };
    }

    this.running = true;
    const startedAt = new Date();
    const runId = startedAt.toISOString().replaceAll(/[:.]/g, "-");
    const backupDate = formatLocalDate(startedAt);
    const runPrefix = `${normalizeR2Prefix(this.config.BACKUP_R2_PREFIX)}${backupDate}/${runId}/`;
    const uploadedUsers: UploadedUserBackup[] = [];
    const failures: Array<{ userId: string; email: string; message: string }> = [];

    try {
      const users = await this.repository.listUsersForBackup();
      this.logger.info({
        trigger,
        userCount: users.length,
        prefix: runPrefix,
      }, "Starting R2 bookmark backup");

      for (const user of users) {
        try {
          const backup = await this.backupService.exportUserBookmarks(user);
          const key = `${runPrefix}users/${user.id}.kpkg`;
          await this.uploadObject(key, backup.body, {
            contentType: "application/x-keeppage-package",
            metadata: {
              userId: user.id,
              source: "keeppage-bookmark-backup",
              packageFormat: backup.manifest.format,
              packageVersion: String(backup.manifest.version),
            },
          });
          uploadedUsers.push({
            userId: user.id,
            email: user.email,
            key,
            fileName: backup.fileName,
            sizeBytes: backup.body.byteLength,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          failures.push({
            userId: user.id,
            email: user.email,
            message,
          });
          this.logger.error({
            err: error,
            userId: user.id,
          }, "Failed to upload user bookmark backup to R2");
        }
      }

      const finishedAt = new Date();
      const manifest = {
        backupType: "keeppage-bookmarks-r2-auto",
        trigger,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: failures.length > 0 ? "warning" : "success",
        r2Bucket: this.config.R2_BUCKET,
        r2Prefix: runPrefix,
        counts: {
          users: users.length,
          uploadedUsers: uploadedUsers.length,
          failedUsers: failures.length,
          totalBytes: uploadedUsers.reduce((sum, item) => sum + item.sizeBytes, 0),
        },
        uploadedUsers,
        failures,
      };
      const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await this.uploadObject(`${runPrefix}manifest.json`, manifestBody, {
        contentType: "application/json; charset=utf-8",
      });
      await this.uploadObject(`${normalizeR2Prefix(this.config.BACKUP_R2_PREFIX)}latest-manifest.json`, manifestBody, {
        contentType: "application/json; charset=utf-8",
      });

      this.logger.info({
        status: manifest.status,
        uploadedUsers: uploadedUsers.length,
        failedUsers: failures.length,
        prefix: runPrefix,
      }, "R2 bookmark backup completed");
      return manifest;
    } finally {
      this.running = false;
    }
  }

  private scheduleNextRun() {
    this.stop();
    const delayMs = millisecondsUntilNextLocalTime(this.config.BACKUP_R2_TIME);
    this.timer = setTimeout(() => {
      this.runNow("schedule")
        .catch((error) => {
          this.logger.error({ err: error }, "Scheduled R2 bookmark backup failed");
        })
        .finally(() => {
          this.scheduleNextRun();
        });
    }, delayMs);
    this.timer.unref?.();

    this.logger.info({
      time: this.config.BACKUP_R2_TIME,
      nextRunInMs: delayMs,
      prefix: this.config.BACKUP_R2_PREFIX,
    }, "R2 bookmark backup scheduler started");
  }

  private createClient() {
    const endpoint = this.config.R2_ENDPOINT?.trim();
    const bucket = this.config.R2_BUCKET?.trim();
    const accessKeyId = this.config.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = this.config.R2_SECRET_ACCESS_KEY?.trim();
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when BACKUP_R2_ENABLED=true.",
      );
    }

    return new S3Client({
      region: this.config.R2_REGION,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private async uploadObject(
    key: string,
    body: Buffer,
    options: {
      contentType: string;
      metadata?: Record<string, string>;
    },
  ) {
    if (!this.client || !this.config.R2_BUCKET) {
      throw new Error("R2 backup client is not configured.");
    }

    await this.client.send(new PutObjectCommand({
      Bucket: this.config.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: "private, max-age=0, no-store",
      Metadata: options.metadata,
    }));
  }
}

function normalizeR2Prefix(prefix: string) {
  const normalized = prefix
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return normalized ? `${normalized}/` : "";
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function millisecondsUntilNextLocalTime(time: string) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid BACKUP_R2_TIME: ${time}. Expected HH:mm.`);
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}
