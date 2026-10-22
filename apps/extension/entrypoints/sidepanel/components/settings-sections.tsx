import type { ReactNode } from "react";
import type { AuthUser } from "@keeppage/domain";
import { Notice } from "./common";

export type Feedback = { tone: "info" | "success" | "error"; message: string } | null;

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="sp-settings-section">
      <div className="sp-settings-head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="sp-card sp-settings-body">{children}</div>
    </section>
  );
}

type AccountProps = {
  authUser: AuthUser | null;
  connecting: boolean;
  feedback: Feedback;
  connectLabel: string;
  onConnect: () => void;
  onLogout: () => void;
  extraAction?: ReactNode;
};

export function AccountBlock({ authUser, connecting, feedback, connectLabel, onConnect, onLogout, extraAction }: AccountProps) {
  return (
    <>
      {authUser ? (
        <div className="sp-account">
          <span className="sp-avatar is-large" aria-hidden="true">
            {(authUser.name || authUser.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="sp-account-copy">
            <strong>{authUser.name || authUser.email}</strong>
            <span>{authUser.email}</span>
          </div>
          <button className="sp-button is-secondary is-compact sp-account-logout" onClick={onLogout} type="button">
            退出登录
          </button>
        </div>
      ) : (
        <>
          <p className="sp-muted">尚未连接账号。连接后，保存的网页会同步到你的 KeepPage 资料库。</p>
          <button className="sp-button is-primary" disabled={connecting} onClick={onConnect} type="button">
            {connecting ? "正在打开…" : connectLabel}
          </button>
        </>
      )}
      {authUser && extraAction}
      {feedback && <Notice tone={feedback.tone}>{feedback.message}</Notice>}
    </>
  );
}

type ServerProps = {
  apiBaseUrl: string;
  placeholder: string;
  saving: boolean;
  testing: boolean;
  feedback: Feedback[];
  onChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onReset: () => void;
};

export function ServerBlock({ apiBaseUrl, placeholder, saving, testing, feedback, onChange, onSave, onTest, onReset }: ServerProps) {
  return (
    <>
      <input
        aria-label="服务器地址"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={apiBaseUrl}
      />
      <div className="sp-button-row">
        <button className="sp-button is-secondary" disabled={saving} onClick={onSave} type="button">
          {saving ? "保存中…" : "保存"}
        </button>
        <button className="sp-button is-secondary" disabled={testing} onClick={onTest} type="button">
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button className="sp-button is-ghost" onClick={onReset} type="button">恢复默认</button>
      </div>
      {feedback.map((item) => item && <Notice key={item.message} tone={item.tone}>{item.message}</Notice>)}
    </>
  );
}
