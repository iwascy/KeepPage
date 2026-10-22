import type { AuthUser, SaveMode } from "@keeppage/domain";
import { BrandMark } from "../../../src/lib/ui-shared/brand-mark";
import { LockIcon, SettingsIcon } from "./icons";

type HeaderProps = {
  saveMode: SaveMode;
  onChangeSaveMode: (mode: SaveMode) => void;
  authUser: AuthUser | null;
  onConnect: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onToggleSettings: () => void;
};

export function Header({ saveMode, onChangeSaveMode, authUser, onConnect, settingsOpen, onOpenSettings, onToggleSettings }: HeaderProps) {
  const displayName = authUser ? authUser.name || authUser.email : "";
  return (
    <header className="sp-header">
      <span className="sp-header-brand" title="KeepPage">
        <BrandMark size={24} />
      </span>

      <div aria-label="保存模式" className="sp-segmented" role="group">
        <button aria-pressed={saveMode === "standard"} onClick={() => onChangeSaveMode("standard")} type="button">
          普通
        </button>
        <button aria-pressed={saveMode === "private"} onClick={() => onChangeSaveMode("private")} type="button">
          <LockIcon size={12} />
          私密
        </button>
      </div>

      <div className="sp-header-actions">
        {authUser ? (
          <button
            aria-label={`账号：${authUser.email}`}
            className="sp-avatar"
            onClick={onOpenSettings}
            title={authUser.email}
            type="button"
          >
            {displayName.slice(0, 1).toUpperCase()}
          </button>
        ) : (
          <button className="sp-button is-secondary is-compact" onClick={onConnect} type="button">
            连接账号
          </button>
        )}
        <button
          aria-label={settingsOpen ? "关闭设置" : "打开设置"}
          aria-pressed={settingsOpen}
          className="sp-icon-button"
          onClick={onToggleSettings}
          title={settingsOpen ? "关闭设置" : "设置"}
          type="button"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}

export function PrivateStrip({ unlocked, enabled }: { unlocked: boolean; enabled: boolean }) {
  return (
    <div className="sp-private-strip" role="status">
      <LockIcon size={12} />
      <span>私密模式</span>
      <span className="sp-private-strip-state">{!enabled ? "未启用" : unlocked ? "已解锁" : "已锁定"}</span>
    </div>
  );
}
