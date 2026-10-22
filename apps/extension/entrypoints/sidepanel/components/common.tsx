import { useState, type ReactNode } from "react";
import type { CaptureTask } from "@keeppage/domain";
import {
  captureStatusLabel,
  captureStatusTone,
  type CaptureStatusTone,
} from "../../../src/lib/ui-shared/capture-status";
import { CloseIcon } from "./icons";

export function SiteIcon({ favIconUrl, label, size = "md" }: { favIconUrl?: string; label: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const monogram = label.replace(/^www\./, "").slice(0, 2).toUpperCase() || "··";
  return (
    <span className={`sp-site-icon is-${size}`} aria-hidden="true">
      {favIconUrl && !failed ? (
        <img alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={favIconUrl} />
      ) : (
        <span>{monogram}</span>
      )}
    </span>
  );
}

export function taskTone(task: CaptureTask): CaptureStatusTone {
  // Private captures stay local until synced, so a ready local copy is already a finished save.
  if (task.isPrivate && task.status === "local_ready") {
    return "success";
  }
  return captureStatusTone(task.status);
}

export function StatusChip({ task }: { task: CaptureTask }) {
  const tone = taskTone(task);
  return (
    <span className={`sp-chip is-${tone}`}>
      {tone === "pending" && <span className="sp-chip-dot" aria-hidden="true" />}
      {captureStatusLabel(task.status)}
    </span>
  );
}

export function Notice({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: "info" | "success" | "error";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`sp-notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="sp-notice-text">{children}</span>
      {onDismiss && (
        <button aria-label="关闭提示" className="sp-icon-button is-small" onClick={onDismiss} type="button">
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

export function formatDateTime(input: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(input));
  } catch {
    return input;
  }
}
