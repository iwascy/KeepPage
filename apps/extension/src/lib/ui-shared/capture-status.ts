import type {
  CaptureProfile,
  CaptureTask,
  QualityGrade,
} from "@keeppage/domain";

export const PROFILE_META: Record<CaptureProfile, {
  label: string;
  description: string;
}> = {
  standard: {
    label: "标准保真",
    description: "默认方案，平衡质量与体积。",
  },
  complete: {
    label: "完整保留",
    description: "尽量少裁剪，适合复杂页面。",
  },
  dynamic: {
    label: "动态增强",
    description: "更适合延迟内容和 SPA。",
  },
  lightweight: {
    label: "轻量快照",
    description: "更快更小，优先搜索和快速归档。",
  },
};

export function isSuccessStatus(status: CaptureTask["status"]) {
  return status === "uploaded" || status === "indexed" || status === "synced";
}

export function getTaskStepLabel(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "已入队";
    case "capturing":
      return "抓取中";
    case "validating":
      return "整理中";
    case "local_ready":
      return "本地归档完成";
    case "upload_pending":
      return "等待同步";
    case "uploading":
      return "同步中";
    case "uploaded":
      return "已上传";
    case "indexed":
      return "已索引";
    case "synced":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "处理中";
  }
}

export function getTaskStepDescription(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "任务已创建，马上开始保存。";
    case "capturing":
      return "正在抓取页面内容和当前渲染结果。";
    case "validating":
      return "正在整理归档内容并生成质量信息。";
    case "local_ready":
      return "本地归档已完成，正在准备同步。";
    case "upload_pending":
      return "归档已就绪，正在排队同步到 KeepPage。";
    case "uploading":
      return "正在把归档上传到 KeepPage。";
    case "uploaded":
      return "归档已上传，正在完成最后确认。";
    case "indexed":
      return "归档已完成索引。";
    case "synced":
      return "页面已经成功保存到 KeepPage。";
    case "failed":
      return "保存过程失败。";
    default:
      return "正在处理当前页面。";
  }
}

export function getTaskProgressValue(
  task: CaptureTask | null,
  captureState: "saving" | "success" | "error",
): number {
  if (captureState === "success") {
    return 100;
  }
  if (captureState === "error") {
    return task ? getTaskProgressValue(task, "saving") : 0;
  }
  if (!task) {
    return 8;
  }
  switch (task.status) {
    case "queued":
      return 16;
    case "capturing":
      return 32;
    case "validating":
      return 54;
    case "local_ready":
      return 70;
    case "upload_pending":
      return 78;
    case "uploading":
      return 88;
    case "uploaded":
      return 95;
    case "indexed":
      return 98;
    case "synced":
      return 100;
    case "failed":
      return 0;
    default:
      return 24;
  }
}

export function looksLikeAuthError(message?: string | null) {
  if (!message) {
    return false;
  }
  return message.includes("登录") || message.includes("未登录") || message.includes("账号");
}

export function captureStatusLabel(status: CaptureTask["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "capturing":
      return "抓取中";
    case "validating":
      return "校验中";
    case "local_ready":
      return "本地就绪";
    case "upload_pending":
      return "等待同步";
    case "uploading":
      return "同步中";
    case "uploaded":
      return "已上传";
    case "indexed":
      return "建索引中";
    case "synced":
      return "已入库";
    case "failed":
      return "失败";
  }
}

export function captureProfileLabel(profile: CaptureProfile) {
  return PROFILE_META[profile]?.label ?? profile;
}

export function captureScopeLabel(scope: CaptureTask["source"]["captureScope"]) {
  return scope === "selection" ? "选中区域" : "整页";
}

export function privateSyncStateLabel(syncState?: CaptureTask["syncState"]) {
  switch (syncState) {
    case "local-only":
      return "仅本机";
    case "sync-disabled":
      return "未启用同步";
    case "sync-pending":
      return "等待同步";
    case "sync-failed":
      return "同步失败";
    default:
      return null;
  }
}

export function qualityGradeLabel(grade?: QualityGrade) {
  switch (grade) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "待评估";
  }
}

export function privateModeLabel(mode?: CaptureTask["privateMode"]) {
  switch (mode) {
    case "password-gated":
      return "密码进入";
    case "encrypted-sync":
      return "旧版加密同步";
    case "local-only":
    default:
      return "本地私密";
  }
}
