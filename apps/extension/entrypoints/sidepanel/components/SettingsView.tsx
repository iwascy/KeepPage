import type { ReactNode } from "react";
import { Notice } from "./common";
import { BackIcon } from "./icons";
import { SettingsSection, type Feedback } from "./settings-sections";

type ToggleProps = { checked: boolean; label: string; description?: string; onChange: (checked: boolean) => void };

function ToggleRow({ checked, label, description, onChange }: ToggleProps) {
  return (
    <label className="sp-toggle">
      <span className="sp-toggle-copy">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} role="switch" type="checkbox" />
    </label>
  );
}

type SettingsViewProps = {
  account: ReactNode;
  server: ReactNode;
  incognitoPrivateDefault: boolean;
  onIncognitoPrivateDefaultChange: (checked: boolean) => void;
  debugMode: boolean;
  onDebugModeChange: (checked: boolean) => void;
  refreshingIcons: boolean;
  iconFeedback: Feedback;
  onRefreshIcons: () => void;
  onBack: () => void;
};

export function SettingsView(props: SettingsViewProps) {
  return (
    <div className="sp-settings">
      <div className="sp-subnav">
        <button className="sp-back" onClick={props.onBack} type="button">
          <BackIcon />
          返回
        </button>
        <h1>设置</h1>
      </div>

      <SettingsSection title="账号">{props.account}</SettingsSection>

      <SettingsSection description="使用自部署服务时修改。" title="服务器地址">{props.server}</SettingsSection>

      <SettingsSection title="偏好">
        <ToggleRow
          checked={props.incognitoPrivateDefault}
          description="在无痕窗口中打开侧栏时，默认切到私密模式。"
          label="无痕窗口默认私密"
          onChange={props.onIncognitoPrivateDefaultChange}
        />
        <ToggleRow
          checked={props.debugMode}
          description="在控制台输出保存和同步日志，便于排查问题。"
          label="调试模式"
          onChange={props.onDebugModeChange}
        />
      </SettingsSection>

      <SettingsSection title="维护">
        <div className="sp-settings-row">
          <span className="sp-muted">重新获取资料库中所有书签的网站图标。</span>
          <button className="sp-button is-secondary" disabled={props.refreshingIcons} onClick={props.onRefreshIcons} type="button">
            {props.refreshingIcons ? "刷新中…" : "刷新图标"}
          </button>
        </div>
        {props.iconFeedback && <Notice tone={props.iconFeedback.tone}>{props.iconFeedback.message}</Notice>}
      </SettingsSection>

      <p className="sp-version">KeepPage 扩展 v{chrome.runtime.getManifest().version}</p>
    </div>
  );
}
