import type {
  AuthSession,
  AuthUser,
  CaptureArtifacts,
  CaptureInitResponse,
  CapturePageSignals,
  CaptureProfile,
  CaptureScope,
  CaptureSource,
  CaptureStatus,
  CaptureTask,
  CaptureTaskOwner,
  PrivateAutoLock,
  PrivateCaptureTaskShell,
  PrivateMode,
  PrivateSyncState,
  PrivateVaultSummary,
  QualityGrade,
  QualityReason,
  QualityReport,
  SaveMode,
} from "@keeppage/domain";
import type { PrivateTaskPayload } from "./extension-db";

type SafeParseSuccess<T> = {
  success: true;
  data: T;
};

type SafeParseFailure = {
  success: false;
  error: Error;
};

type Schema<T> = {
  parse(input: unknown): T;
  safeParse(input: unknown): SafeParseSuccess<T> | SafeParseFailure;
};

const captureStatusValues = [
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
] as const satisfies readonly CaptureStatus[];

const captureProfileValues = [
  "standard",
  "complete",
  "dynamic",
  "lightweight",
] as const satisfies readonly CaptureProfile[];
const captureScopeValues = [
  "page",
  "selection",
] as const satisfies readonly CaptureScope[];

const qualityGradeValues = ["high", "medium", "low"] as const satisfies readonly QualityGrade[];
const saveModeValues = ["standard", "private"] as const satisfies readonly SaveMode[];
const privateModeValues = [
  "local-only",
  "encrypted-sync",
  "password-gated",
] as const satisfies readonly PrivateMode[];
const privateSyncStateValues = [
  "local-only",
  "sync-disabled",
  "sync-pending",
  "sync-failed",
] as const satisfies readonly PrivateSyncState[];
const privateAutoLockValues = [
  "5m",
  "15m",
  "1h",
  "browser",
] as const satisfies readonly PrivateAutoLock[];

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

export const captureStatusSchema = createSchema(parseCaptureStatus);
export const captureProfileSchema = createSchema(parseCaptureProfile);
export const captureScopeSchema = createSchema(parseCaptureScope);
export const qualityGradeSchema = createSchema(parseQualityGrade);
export const saveModeSchema = createSchema(parseSaveMode);
export const privateModeSchema = createSchema(parsePrivateMode);
export const privateSyncStateSchema = createSchema(parsePrivateSyncState);
export const privateAutoLockSchema = createSchema(parsePrivateAutoLock);
export const capturePageSignalsSchema = createSchema(parseCapturePageSignals);
export const captureSourceSchema = createSchema(parseCaptureSource);
export const captureArtifactsSchema = createSchema(parseCaptureArtifacts);
export const authUserSchema = createSchema(parseAuthUser);
export const authSessionSchema = createSchema(parseAuthSession);
export const captureTaskSchema = createSchema(parseCaptureTask);
export const qualityReportSchema = createSchema(parseQualityReport);
export const captureInitResponseSchema = createSchema(parseCaptureInitResponse);
export const privateVaultSummarySchema = createSchema(parsePrivateVaultSummary);
export const privateCaptureTaskShellSchema = createSchema(parsePrivateCaptureTaskShell);
export const privateTaskPayloadSchema = createSchema(parsePrivateTaskPayload);

export function canTransitionCaptureStatus(current: CaptureStatus, next: CaptureStatus) {
  return validStatusTransitions[current].includes(next);
}

export function assertCaptureStatusTransition(current: CaptureStatus, next: CaptureStatus) {
  if (!canTransitionCaptureStatus(current, next)) {
    throw new Error(`Invalid capture status transition: ${current} -> ${next}`);
  }
}

export function createCaptureId() {
  return `cap_${crypto.randomUUID()}`;
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
}): QualityReport {
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
  return parseQualityReport({
    score: normalizedScore,
    grade: deriveQualityGrade(normalizedScore),
    reasons,
    liveSignals,
    archiveSignals,
  });
}

export function ensureArchiveBaseHref(html: string, sourceUrl: string) {
  if (!html.trim() || !sourceUrl.trim() || /<base\b[^>]*href=/i.test(html)) {
    return html;
  }

  const normalizedBaseUrl = escapeHtmlAttribute(normalizeBaseUrl(sourceUrl));
  const baseTag = `<base href="${normalizedBaseUrl}" />`;

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n    ${baseTag}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}\n  <head>\n    <meta charset="UTF-8" />\n    ${baseTag}\n  </head>`,
    );
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    ${baseTag}
  </head>
  <body>
${html}
  </body>
</html>`;
}

function createSchema<T>(parse: (input: unknown) => T): Schema<T> {
  return {
    parse,
    safeParse(input) {
      try {
        return {
          success: true,
          data: parse(input),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}

function parseCaptureStatus(input: unknown): CaptureStatus {
  return parseEnum(input, captureStatusValues, "capture status");
}

function parseCaptureProfile(input: unknown): CaptureProfile {
  return parseEnum(input, captureProfileValues, "capture profile");
}

function parseCaptureScope(input: unknown): CaptureScope {
  return parseEnum(input, captureScopeValues, "capture scope");
}

function parseQualityGrade(input: unknown): QualityGrade {
  return parseEnum(input, qualityGradeValues, "quality grade");
}

function parseSaveMode(input: unknown): SaveMode {
  return parseEnum(input, saveModeValues, "save mode");
}

function parsePrivateMode(input: unknown): PrivateMode {
  return parseEnum(input, privateModeValues, "private mode");
}

function parsePrivateSyncState(input: unknown): PrivateSyncState {
  return parseEnum(input, privateSyncStateValues, "private sync state");
}

function parsePrivateAutoLock(input: unknown): PrivateAutoLock {
  return parseEnum(input, privateAutoLockValues, "private auto lock");
}

function parseAuthUser(input: unknown): AuthUser {
  const record = expectRecord(input, "auth user");
  return {
    id: expectString(record.id, "auth user id"),
    email: expectEmail(record.email, "auth user email"),
    name: expectOptionalNonEmptyString(record.name, "auth user name"),
    createdAt: expectDateTimeString(record.createdAt, "auth user createdAt"),
  };
}

function parseAuthSession(input: unknown): AuthSession {
  const record = expectRecord(input, "auth session");
  return {
    token: expectString(record.token, "auth token"),
    user: parseAuthUser(record.user),
  };
}

function parseCapturePageSignals(input: unknown): CapturePageSignals {
  const record = expectRecord(input, "capture page signals");
  return {
    textLength: expectInt(record.textLength, "textLength", { min: 0 }),
    imageCount: expectInt(record.imageCount, "imageCount", { min: 0 }),
    iframeCount: expectInt(record.iframeCount, "iframeCount", { min: 0 }),
    scrollHeight: expectInt(record.scrollHeight, "scrollHeight", { min: 0 }),
    renderHeight: expectOptionalInt(record.renderHeight, "renderHeight", { min: 0 }),
    fileSize: expectOptionalInt(record.fileSize, "fileSize", { min: 0 }),
    hasCanvas: expectBoolean(record.hasCanvas ?? false, "hasCanvas"),
    hasVideo: expectBoolean(record.hasVideo ?? false, "hasVideo"),
    previewable: expectBoolean(record.previewable ?? true, "previewable"),
    screenshotGenerated: expectBoolean(record.screenshotGenerated ?? false, "screenshotGenerated"),
  };
}

function parseCaptureSource(input: unknown): CaptureSource {
  const record = expectRecord(input, "capture source");
  const viewport = expectRecord(record.viewport, "capture source viewport");
  return {
    url: expectUrlString(record.url, "capture source url"),
    title: expectString(record.title, "capture source title"),
    canonicalUrl: expectOptionalUrlString(record.canonicalUrl, "capture source canonicalUrl"),
    domain: expectString(record.domain, "capture source domain"),
    faviconUrl: expectOptionalUrlString(record.faviconUrl, "capture source faviconUrl"),
    coverImageUrl: expectOptionalUrlString(record.coverImageUrl, "capture source coverImageUrl"),
    referrer: expectOptionalString(record.referrer, "capture source referrer"),
    selectionText: expectOptionalString(record.selectionText, "capture source selectionText"),
    captureScope: parseCaptureScope(record.captureScope ?? "page"),
    viewport: {
      width: expectInt(viewport.width, "capture source viewport width", { min: 1 }),
      height: expectInt(viewport.height, "capture source viewport height", { min: 1 }),
    },
    savedAt: expectDateTimeString(record.savedAt, "capture source savedAt"),
  };
}

function parseQualityReason(input: unknown): QualityReason {
  const record = expectRecord(input, "quality reason");
  return {
    code: expectString(record.code, "quality reason code"),
    message: expectString(record.message, "quality reason message"),
    impact: expectNumber(record.impact, "quality reason impact", { min: 1, max: 50 }),
  };
}

function parseQualityReport(input: unknown): QualityReport {
  const record = expectRecord(input, "quality report");
  return {
    score: expectInt(record.score, "quality report score", { min: 0, max: 100 }),
    grade: parseQualityGrade(record.grade),
    reasons: expectArray(record.reasons, "quality report reasons").map(parseQualityReason),
    liveSignals: parseCapturePageSignals(record.liveSignals),
    archiveSignals: parseCapturePageSignals(record.archiveSignals),
  };
}

function parseCaptureArtifacts(input: unknown): CaptureArtifacts {
  const record = expectRecord(input, "capture artifacts");
  return {
    archiveHtml: expectString(record.archiveHtml, "capture artifacts archiveHtml"),
    readerHtml: expectOptionalString(record.readerHtml, "capture artifacts readerHtml"),
    extractedText: expectOptionalString(record.extractedText, "capture artifacts extractedText") ?? "",
    thumbnailDataUrl: expectOptionalString(record.thumbnailDataUrl, "capture artifacts thumbnailDataUrl"),
    screenshotDataUrl: expectOptionalString(record.screenshotDataUrl, "capture artifacts screenshotDataUrl"),
    pdfDataUrl: expectOptionalString(record.pdfDataUrl, "capture artifacts pdfDataUrl"),
    downloadableMedia: expectArray(
      record.downloadableMedia ?? [],
      "capture artifacts downloadableMedia",
    ).map((item) => {
      const media = expectRecord(item, "capture artifacts downloadable media");
      return {
        id: expectString(media.id, "capture artifacts downloadable media id"),
        kind: parseEnum(media.kind, ["image", "video", "video_cover"], "capture media kind"),
        url: expectUrlString(media.url, "capture artifacts downloadable media url"),
        mimeType: expectOptionalString(
          media.mimeType,
          "capture artifacts downloadable media mimeType",
        ),
        width: media.width == null
          ? undefined
          : expectInt(media.width, "capture artifacts downloadable media width", { min: 1 }),
        height: media.height == null
          ? undefined
          : expectInt(media.height, "capture artifacts downloadable media height", { min: 1 }),
      };
    }),
    meta: expectRecord(record.meta ?? {}, "capture artifacts meta"),
  };
}

function parseCaptureTaskOwner(input: unknown): CaptureTaskOwner {
  const record = expectRecord(input, "capture task owner");
  return {
    userId: expectString(record.userId, "capture task owner userId"),
    email: expectEmail(record.email, "capture task owner email"),
    name: expectOptionalNonEmptyString(record.name, "capture task owner name"),
  };
}

function parseCaptureTask(input: unknown): CaptureTask {
  const record = expectRecord(input, "capture task");
  return {
    id: expectString(record.id, "capture task id"),
    bookmarkId: expectOptionalNonEmptyString(record.bookmarkId, "capture task bookmarkId"),
    versionId: expectOptionalNonEmptyString(record.versionId, "capture task versionId"),
    status: parseCaptureStatus(record.status),
    saveMode: parseSaveMode(record.saveMode ?? "standard"),
    isPrivate: expectBoolean(record.isPrivate ?? false, "capture task isPrivate"),
    privateMode: record.privateMode == null ? undefined : parsePrivateMode(record.privateMode),
    syncState: record.syncState == null ? undefined : parsePrivateSyncState(record.syncState),
    profile: parseCaptureProfile(record.profile),
    owner: record.owner == null ? undefined : parseCaptureTaskOwner(record.owner),
    source: parseCaptureSource(record.source),
    quality: record.quality == null ? undefined : parseQualityReport(record.quality),
    artifacts: record.artifacts == null ? undefined : parseCaptureArtifacts(record.artifacts),
    failureReason: expectOptionalString(record.failureReason, "capture task failureReason"),
    localArchiveSha256: expectOptionalString(record.localArchiveSha256, "capture task localArchiveSha256"),
    createdAt: expectDateTimeString(record.createdAt, "capture task createdAt"),
    updatedAt: expectDateTimeString(record.updatedAt, "capture task updatedAt"),
  };
}

function parseCaptureInitResponse(input: unknown): CaptureInitResponse {
  const record = expectRecord(input, "capture init response");
  return {
    alreadyExists: expectBoolean(record.alreadyExists, "capture init response alreadyExists"),
    bookmarkId: expectOptionalNonEmptyString(record.bookmarkId, "capture init response bookmarkId"),
    versionId: expectOptionalNonEmptyString(record.versionId, "capture init response versionId"),
    objectKey: expectString(record.objectKey, "capture init response objectKey"),
    uploadUrl: expectUrlString(record.uploadUrl, "capture init response uploadUrl"),
  };
}

function parsePrivateVaultSummary(input: unknown): PrivateVaultSummary {
  const record = expectRecord(input, "private vault summary");
  return {
    enabled: expectBoolean(record.enabled, "private vault summary enabled"),
    unlocked: expectBoolean(record.unlocked, "private vault summary unlocked"),
    autoLock: parsePrivateAutoLock(record.autoLock ?? "browser"),
    totalItems: expectInt(record.totalItems ?? 0, "private vault summary totalItems", { min: 0 }),
    pendingSyncCount: expectInt(record.pendingSyncCount ?? 0, "private vault summary pendingSyncCount", { min: 0 }),
    syncEnabled: expectBoolean(record.syncEnabled ?? true, "private vault summary syncEnabled"),
    lastUpdatedAt: record.lastUpdatedAt == null
      ? undefined
      : expectDateTimeString(record.lastUpdatedAt, "private vault summary lastUpdatedAt"),
  };
}

function parsePrivateCaptureTaskShell(input: unknown): PrivateCaptureTaskShell {
  const record = expectRecord(input, "private capture task shell");
  return {
    id: expectString(record.id, "private capture task shell id"),
    status: parseCaptureStatus(record.status),
    owner: record.owner == null ? undefined : parseCaptureTaskOwner(record.owner),
    isPrivate: expectLiteralTrue(record.isPrivate, "private capture task shell isPrivate"),
    privateMode: parsePrivateMode(record.privateMode ?? "password-gated"),
    syncState: parsePrivateSyncState(record.syncState ?? "sync-pending"),
    createdAt: expectDateTimeString(record.createdAt, "private capture task shell createdAt"),
    updatedAt: expectDateTimeString(record.updatedAt, "private capture task shell updatedAt"),
    failureReason: expectOptionalString(record.failureReason, "private capture task shell failureReason"),
  };
}

function parsePrivateTaskPayload(input: unknown): PrivateTaskPayload {
  const record = expectRecord(input, "private task payload");
  return {
    profile: parseCaptureProfile(record.profile),
    source: parseCaptureSource(record.source),
    quality: record.quality == null ? undefined : parseQualityReport(record.quality),
    artifacts: record.artifacts == null ? undefined : parseCaptureArtifacts(record.artifacts),
    localArchiveSha256: expectOptionalString(record.localArchiveSha256, "private task payload localArchiveSha256"),
    bookmarkId: expectOptionalNonEmptyString(record.bookmarkId, "private task payload bookmarkId"),
    versionId: expectOptionalNonEmptyString(record.versionId, "private task payload versionId"),
  };
}

function parseEnum<T extends string>(
  input: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof input === "string" && values.includes(input as T)) {
    return input as T;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectArray(input: unknown, label: string): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectString(input: unknown, label: string): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectOptionalString(input: unknown, label: string) {
  if (input == null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectOptionalNonEmptyString(input: unknown, label: string) {
  if (input == null) {
    return undefined;
  }
  return expectString(input, label);
}

function expectEmail(input: unknown, label: string) {
  const value = expectString(input, label);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function expectDateTimeString(input: unknown, label: string) {
  const value = expectString(input, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function expectUrlString(input: unknown, label: string) {
  const value = expectString(input, label);
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function expectOptionalUrlString(input: unknown, label: string) {
  if (input == null) {
    return undefined;
  }
  return expectUrlString(input, label);
}

function expectBoolean(input: unknown, label: string) {
  if (typeof input === "boolean") {
    return input;
  }
  throw new Error(`Invalid ${label}.`);
}

function expectNumber(
  input: unknown,
  label: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`Invalid ${label}.`);
  }
  if (options.min != null && input < options.min) {
    throw new Error(`Invalid ${label}.`);
  }
  if (options.max != null && input > options.max) {
    throw new Error(`Invalid ${label}.`);
  }
  return input;
}

function expectInt(
  input: unknown,
  label: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  const value = expectNumber(input, label, options);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function expectOptionalInt(
  input: unknown,
  label: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  if (input == null) {
    return undefined;
  }
  return expectInt(input, label, options);
}

function expectLiteralTrue(input: unknown, label: string): true {
  if (input === true) {
    return true;
  }
  throw new Error(`Invalid ${label}.`);
}

function normalizeBaseUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
