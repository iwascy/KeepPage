import type { ActiveTabInfo } from "../use-active-tab";
import { SiteIcon } from "./common";
import { LockIcon, SaveIcon, SelectionIcon, SpinnerIcon } from "./icons";

type CapturePanelProps = {
  activeTab: ActiveTabInfo | null;
  isPrivate: boolean;
  capturing: boolean;
  primaryLabel: string;
  hint: string;
  blockedHint: string | null;
  onCapture: () => void;
  onCaptureSelection: () => void;
};

export function CapturePanel({
  activeTab,
  isPrivate,
  capturing,
  primaryLabel,
  hint,
  blockedHint,
  onCapture,
  onCaptureSelection,
}: CapturePanelProps) {
  const unsupported = activeTab !== null && !activeTab.supported;
  const disabled = capturing || unsupported || blockedHint !== null;
  return (
    <section aria-label="保存当前页面" className="sp-card sp-capture">
      <div className="sp-current-page">
        <SiteIcon favIconUrl={activeTab?.favIconUrl} label={activeTab?.hostname || "KP"} />
        <div className="sp-current-page-copy">
          <strong title={activeTab?.title}>{activeTab?.title ?? "正在读取当前页面…"}</strong>
          <span>{activeTab ? activeTab.hostname : "当前标签页"}</span>
        </div>
      </div>

      <div className="sp-capture-actions">
        <button
          className="sp-button is-primary is-grow"
          disabled={disabled}
          onClick={onCapture}
          type="button"
        >
          {capturing ? <SpinnerIcon /> : isPrivate ? <LockIcon /> : <SaveIcon />}
          {primaryLabel}
        </button>
        <button
          className="sp-button is-secondary"
          disabled={disabled}
          onClick={onCaptureSelection}
          title="在页面上框选一块内容单独保存"
          type="button"
        >
          <SelectionIcon />
          选区
        </button>
      </div>

      <p className={`sp-capture-hint ${unsupported ? "is-warning" : ""}`}>
        {unsupported ? "这个页面无法保存，仅支持 http/https 网页。" : blockedHint ?? hint}
      </p>
    </section>
  );
}
