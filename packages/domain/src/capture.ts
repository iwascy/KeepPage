import { z } from "zod";

export const captureStatusValues = [
  "queued",
  "capturing",
  "validating",
  "local_ready",
  "upload_pending",
  "uploading",
  "uploaded",
  "indexed",
  "synced",
  "failed",
] as const;

export const captureProfileValues = [
  "standard",
  "complete",
  "dynamic",
  "lightweight",
] as const;

export const qualityGradeValues = ["high", "medium", "low"] as const;

export const captureStatusSchema = z.enum(captureStatusValues);
export const captureProfileSchema = z.enum(captureProfileValues);
export const qualityGradeSchema = z.enum(qualityGradeValues);

export type CaptureStatus = z.infer<typeof captureStatusSchema>;
export type CaptureProfile = z.infer<typeof captureProfileSchema>;
export type QualityGrade = z.infer<typeof qualityGradeSchema>;

export const captureSourceSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  canonicalUrl: z.url().optional(),
  domain: z.string().min(1),
  faviconUrl: z.url().optional(),
  referrer: z.string().optional(),
  selectionText: z.string().optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  savedAt: z.string().datetime(),
});

export const capturePageSignalsSchema = z.object({
  textLength: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  iframeCount: z.number().int().nonnegative(),
  scrollHeight: z.number().int().nonnegative(),
  renderHeight: z.number().int().nonnegative().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  hasCanvas: z.boolean().default(false),
  hasVideo: z.boolean().default(false),
  previewable: z.boolean().default(true),
  screenshotGenerated: z.boolean().default(false),
});

export const qualityReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  impact: z.number().min(1).max(50),
});

export const qualityReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: qualityGradeSchema,
  reasons: z.array(qualityReasonSchema),
  liveSignals: capturePageSignalsSchema,
  archiveSignals: capturePageSignalsSchema,
});

export const captureArtifactsSchema = z.object({
  archiveHtml: z.string().min(1),
  extractedText: z.string().default(""),
  thumbnailDataUrl: z.string().optional(),
  screenshotDataUrl: z.string().optional(),
  pdfDataUrl: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const captureTaskOwnerSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).optional(),
});

export const captureTaskSchema = z.object({
  id: z.string().min(1),
  bookmarkId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  status: captureStatusSchema,
  profile: captureProfileSchema,
  owner: captureTaskOwnerSchema.optional(),
  source: captureSourceSchema,
  quality: qualityReportSchema.optional(),
  artifacts: captureArtifactsSchema.optional(),
  failureReason: z.string().optional(),
  localArchiveSha256: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const tagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
});

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});

export const authRegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().max(120).optional(),
});

export const authLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const authSessionSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});

export const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
});

export const bookmarkVersionSchema = z.object({
  id: z.string().min(1),
  bookmarkId: z.string().min(1),
  versionNo: z.number().int().positive(),
  htmlObjectKey: z.string().min(1),
  htmlSha256: z.string().min(1),
  textSha256: z.string().optional(),
  textSimhash: z.string().optional(),
  captureProfile: captureProfileSchema,
  quality: qualityReportSchema,
  createdAt: z.string().datetime(),
});

export const bookmarkSchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.url(),
  canonicalUrl: z.url().optional(),
  title: z.string().min(1),
  domain: z.string().min(1),
  note: z.string().default(""),
  tags: z.array(tagSchema).default([]),
  folder: folderSchema.optional(),
  latestVersionId: z.string().min(1).optional(),
  versionCount: z.number().int().positive().default(1),
  latestQuality: qualityReportSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const captureInitRequestSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  fileSize: z.number().int().positive(),
  htmlSha256: z.string().min(1),
  profile: captureProfileSchema,
  deviceId: z.string().min(1),
});

export const captureInitResponseSchema = z.object({
  alreadyExists: z.boolean(),
  bookmarkId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  objectKey: z.string().min(1),
  uploadUrl: z.url(),
});

export const captureCompleteRequestSchema = z.object({
  objectKey: z.string().min(1),
  htmlSha256: z.string().min(1),
  textSha256: z.string().optional(),
  textSimhash: z.string().optional(),
  extractedText: z.string().optional(),
  screenshotObjectKey: z.string().optional(),
  thumbnailObjectKey: z.string().optional(),
  quality: qualityReportSchema,
  source: captureSourceSchema,
  deviceId: z.string().min(1),
});

export const bookmarkSearchResponseSchema = z.object({
  items: z.array(bookmarkSchema),
  total: z.number().int().nonnegative(),
});

export const bookmarkDetailVersionSchema = bookmarkVersionSchema.extend({
  archiveAvailable: z.boolean(),
  archiveSizeBytes: z.number().int().positive().optional(),
});

export const bookmarkDetailResponseSchema = z.object({
  bookmark: bookmarkSchema,
  versions: z.array(bookmarkDetailVersionSchema),
});

export type CaptureSource = z.infer<typeof captureSourceSchema>;
export type CapturePageSignals = z.infer<typeof capturePageSignalsSchema>;
export type QualityReason = z.infer<typeof qualityReasonSchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
export type CaptureArtifacts = z.infer<typeof captureArtifactsSchema>;
export type CaptureTaskOwner = z.infer<typeof captureTaskOwnerSchema>;
export type CaptureTask = z.infer<typeof captureTaskSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkVersion = z.infer<typeof bookmarkVersionSchema>;
export type BookmarkDetailVersion = z.infer<typeof bookmarkDetailVersionSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthRegisterRequest = z.infer<typeof authRegisterRequestSchema>;
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type CaptureInitRequest = z.infer<typeof captureInitRequestSchema>;
export type CaptureInitResponse = z.infer<typeof captureInitResponseSchema>;
export type CaptureCompleteRequest = z.infer<typeof captureCompleteRequestSchema>;
export type BookmarkSearchResponse = z.infer<typeof bookmarkSearchResponseSchema>;
export type BookmarkDetailResponse = z.infer<typeof bookmarkDetailResponseSchema>;

const validStatusTransitions: Record<CaptureStatus, CaptureStatus[]> = {
  queued: ["capturing", "failed"],
  capturing: ["validating", "failed"],
  validating: ["local_ready", "failed"],
  local_ready: ["upload_pending", "uploading", "failed"],
  upload_pending: ["uploading", "failed"],
  uploading: ["upload_pending", "uploaded", "failed"],
  uploaded: ["indexed", "synced", "failed"],
  indexed: ["synced", "failed"],
  synced: [],
  failed: ["queued", "capturing"],
};

export function canTransitionCaptureStatus(
  current: CaptureStatus,
  next: CaptureStatus,
) {
  return validStatusTransitions[current].includes(next);
}

export function assertCaptureStatusTransition(
  current: CaptureStatus,
  next: CaptureStatus,
) {
  if (!canTransitionCaptureStatus(current, next)) {
    throw new Error(`Invalid capture status transition: ${current} -> ${next}`);
  }
}

export function createCaptureId() {
  return `cap_${crypto.randomUUID()}`;
}

export function createBookmarkId() {
  return `bm_${crypto.randomUUID()}`;
}

export function createVersionId() {
  return `ver_${crypto.randomUUID()}`;
}

export function deriveQualityGrade(score: number): QualityGrade {
  if (score >= 85) {
    return "high";
  }
  if (score >= 70) {
    return "medium";
  }
  return "low";
}

export function evaluateQuality(input: {
  liveSignals: CapturePageSignals;
  archiveSignals: CapturePageSignals;
  missingIframeLikely?: boolean;
}) {
  const reasons: QualityReason[] = [];
  let score = 100;
  const { liveSignals, archiveSignals, missingIframeLikely } = input;

  if (liveSignals.textLength > 0) {
    const textRetention = archiveSignals.textLength / Math.max(liveSignals.textLength, 1);
    if (textRetention < 0.65) {
      reasons.push({
        code: "text-loss",
        message: "归档文本长度显著低于原页面，疑似丢失正文内容。",
        impact: 25,
      });
      score -= 25;
    } else if (textRetention < 0.85) {
      reasons.push({
        code: "text-partial",
        message: "归档文本长度低于原页面，可能有部分内容未展开。",
        impact: 12,
      });
      score -= 12;
    }
  }

  if (liveSignals.imageCount > 0) {
    const imageRetention = archiveSignals.imageCount / Math.max(liveSignals.imageCount, 1);
    if (imageRetention < 0.5) {
      reasons.push({
        code: "image-loss",
        message: "图片保留率偏低，疑似有延迟加载图片未进入归档。",
        impact: 15,
      });
      score -= 15;
    }
  }

  if (liveSignals.iframeCount > 0 && missingIframeLikely) {
    reasons.push({
      code: "iframe-loss",
      message: "页面包含 iframe，当前归档结果疑似缺失部分嵌入内容。",
      impact: 18,
    });
    score -= 18;
  }

  if (liveSignals.hasCanvas) {
    reasons.push({
      code: "canvas-risk",
      message: "页面包含 canvas，归档中可能无法完整保留动态图形内容。",
      impact: 10,
    });
    score -= 10;
  }

  if (liveSignals.hasVideo) {
    reasons.push({
      code: "video-risk",
      message: "页面包含 video，归档中可能缺失视频画面或播放状态。",
      impact: 10,
    });
    score -= 10;
  }

  if (!archiveSignals.previewable) {
    reasons.push({
      code: "preview-failed",
      message: "本地预览失败，当前归档不可直接验证。",
      impact: 25,
    });
    score -= 25;
  }

  if (!archiveSignals.screenshotGenerated) {
    reasons.push({
      code: "screenshot-missing",
      message: "没有生成截图，列表缩略图与人工回看能力会受影响。",
      impact: 5,
    });
    score -= 5;
  }

  if ((archiveSignals.fileSize ?? 0) > 0 && (archiveSignals.fileSize ?? 0) < 20_000) {
    reasons.push({
      code: "archive-too-small",
      message: "归档文件体积异常小，可能只保存了骨架页面。",
      impact: 12,
    });
    score -= 12;
  }

  const normalizedScore = Math.max(0, Math.min(100, score));

  return qualityReportSchema.parse({
    score: normalizedScore,
    grade: deriveQualityGrade(normalizedScore),
    reasons,
    liveSignals,
    archiveSignals,
  });
}
