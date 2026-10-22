import type { PrivateVaultSummary } from "@keeppage/domain";
import {
  formatRelativeWhen,
  formatWhen,
} from "../../lib/date-format";
import { Icon } from "../../components/Icon";

export function PrivateModePage({
  summary,
  onRetryStatus,
  privateToken,
  error,
  setupPassword,
  setupConfirm,
  unlockPassword,
  passwordChangeLogin,
  passwordChangeNew,
  passwordChangeConfirm,
  passwordChangeMessage,
  busy,
  onSetupPasswordChange,
  onSetupConfirmChange,
  onUnlockPasswordChange,
  onPasswordChangeLoginChange,
  onPasswordChangeNewChange,
  onPasswordChangeConfirmChange,
  onSetup,
  onUnlock,
  onChangePassword,
  onLock,
  onOpenWorkspace,
}: {
  summary: PrivateVaultSummary | null;
  onRetryStatus: () => void;
  privateToken: string | null;
  error: string | null;
  setupPassword: string;
  setupConfirm: string;
  unlockPassword: string;
  passwordChangeLogin: string;
  passwordChangeNew: string;
  passwordChangeConfirm: string;
  passwordChangeMessage: string | null;
  busy: boolean;
  onSetupPasswordChange: (value: string) => void;
  onSetupConfirmChange: (value: string) => void;
  onUnlockPasswordChange: (value: string) => void;
  onPasswordChangeLoginChange: (value: string) => void;
  onPasswordChangeNewChange: (value: string) => void;
  onPasswordChangeConfirmChange: (value: string) => void;
  onSetup: () => void;
  onUnlock: () => void;
  onChangePassword: () => void;
  onLock: () => void;
  onOpenWorkspace: () => void;
}) {
  const enabled = Boolean(summary?.enabled);
  const unlocked = Boolean(privateToken);

  return (
    <section className="private-mode-page" aria-labelledby="private-mode-title">
      <header className="private-mode-header settings-page-heading">
        <div>
          <p className="settings-kicker">资料库</p>
          <h1 id="private-mode-title">私密模式</h1>
          <p>为私密收藏设置独立密码。私密书签拥有独立的收藏夹和标签，普通列表和搜索中不显示这些内容。</p>
        </div>
        {enabled && unlocked ? (
          <button className="secondary-button" type="button" onClick={onLock} disabled={busy}>
            <Icon name="lock" />{busy ? "处理中…" : "锁定私密空间"}
          </button>
        ) : null}
      </header>

      {error ? <p className="private-mode-feedback is-error" role="alert">{error}</p> : null}
      {!summary ? (
        <div className="private-mode-state" role="status" aria-busy={!error}>
          <Icon name={error ? "lock" : "refresh"} />
          <h2>{error ? "暂时无法读取私密设置" : "正在加载私密设置…"}</h2>
          <p>{error ? "请检查连接后重试。" : "正在确认当前状态和私密内容数量。"}</p>
          {error ? <button className="secondary-button" type="button" onClick={onRetryStatus}>重新加载</button> : null}
        </div>
      ) : (
        <>
          <section className="private-mode-card" aria-labelledby="private-overview-title">
            <div className="private-mode-section-heading">
              <h2 id="private-overview-title">空间概览</h2>
              <span className="private-mode-status"><span aria-hidden="true" />{!enabled ? "未启用" : unlocked ? "已解锁" : "已锁定"}</span>
            </div>
            <dl className="private-mode-overview">
              <div><dt>私密收藏</dt><dd>{summary.totalItems ?? 0}<span> 条</span></dd></div>
              <div><dt>最近更新</dt><dd title={summary.lastUpdatedAt ? formatWhen(summary.lastUpdatedAt) : undefined}>{summary.lastUpdatedAt ? formatRelativeWhen(summary.lastUpdatedAt) : "暂无内容"}</dd></div>
              <div><dt>访问方式</dt><dd>独立密码</dd></div>
            </dl>
            <p className="private-mode-boundary"><Icon name="info" />私密模式提供密码访问控制和内容隔离，不是端到端加密保险箱。</p>
          </section>

          {!enabled ? (
            <section className="private-mode-card" aria-labelledby="private-enable-title">
              <div className="private-mode-section-copy"><h2 id="private-enable-title">启用私密空间</h2><p>设置独立密码后，即可从浏览器扩展保存私密收藏。</p></div>
              <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onSetup(); }}>
                <label><span>私密密码</span><input type="password" value={setupPassword} onChange={(event) => onSetupPasswordChange(event.target.value)} placeholder="至少 8 位" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                <label><span>确认私密密码</span><input type="password" value={setupConfirm} onChange={(event) => onSetupConfirmChange(event.target.value)} placeholder="再次输入私密密码" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}>{busy ? "启用中…" : "启用私密模式"}</button></div>
              </form>
            </section>
          ) : !unlocked ? (
            <section className="private-mode-card" aria-labelledby="private-unlock-title">
              <div className="private-mode-section-copy"><h2 id="private-unlock-title">解锁私密空间</h2><p>本次页面会话内保持解锁。刷新或关闭页面后需要重新输入密码。</p></div>
              <PrivateUnlockForm unlockPassword={unlockPassword} busy={busy} onUnlockPasswordChange={onUnlockPasswordChange} onUnlock={onUnlock} />
            </section>
          ) : (
            <section className="private-mode-card" aria-labelledby="private-content-title">
              <div className="private-mode-section-copy"><h2 id="private-content-title">私密书签</h2><p>在首页切换到「私密」即可像普通书签一样浏览、搜索、分类和批量整理私密内容。</p></div>
              <div className="private-mode-action-row"><button className="primary-button" type="button" onClick={onOpenWorkspace}><Icon name="lock_open" />进入私密书签</button></div>
            </section>
          )}

          {enabled ? (
            <section className="private-mode-card private-mode-security" aria-labelledby="private-password-title">
              <details className="private-mode-password-settings">
                <summary><span><strong id="private-password-title">修改或重设私密密码</strong><span>忘记私密密码时，也可通过账号登录密码完成验证。</span></span><Icon name="keyboard_arrow_right" /></summary>
                <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onChangePassword(); }}>
                  <p>验证通过后将设置新密码，并重新解锁当前私密空间。</p>
                  <label><span>账号登录密码</span><input type="password" value={passwordChangeLogin} onChange={(event) => onPasswordChangeLoginChange(event.target.value)} placeholder="输入当前账号的登录密码" autoComplete="current-password" required disabled={busy} /></label>
                  <label><span>新的私密密码</span><input type="password" value={passwordChangeNew} onChange={(event) => onPasswordChangeNewChange(event.target.value)} placeholder="至少 8 位" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                  <label><span>确认新密码</span><input type="password" value={passwordChangeConfirm} onChange={(event) => onPasswordChangeConfirmChange(event.target.value)} placeholder="再次输入新的私密密码" minLength={8} autoComplete="new-password" required disabled={busy} /></label>
                  <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}>{busy ? "更新中…" : "更新私密密码"}</button></div>
                  {passwordChangeMessage ? <p className="private-mode-feedback" role="status">{passwordChangeMessage}</p> : null}
                </form>
              </details>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function PrivateUnlockForm({
  unlockPassword,
  busy,
  onUnlockPasswordChange,
  onUnlock,
}: {
  unlockPassword: string;
  busy: boolean;
  onUnlockPasswordChange: (value: string) => void;
  onUnlock: () => void;
}) {
  return (
    <form className="private-mode-form" onSubmit={(event) => { event.preventDefault(); onUnlock(); }}>
      <label><span>私密密码</span><input type="password" value={unlockPassword} onChange={(event) => onUnlockPasswordChange(event.target.value)} placeholder="输入私密密码" autoComplete="current-password" required disabled={busy} /></label>
      <div className="private-mode-action-row"><button className="primary-button" type="submit" disabled={busy}><Icon name="lock_open" />{busy ? "解锁中…" : "解锁私密空间"}</button></div>
    </form>
  );
}

/** Shown in place of the private library while the vault is locked or not set up. */
export function PrivateWorkspaceGate({
  summary,
  error,
  unlockPassword,
  busy,
  onUnlockPasswordChange,
  onUnlock,
  onOpenSettings,
  onBack,
}: {
  summary: PrivateVaultSummary | null;
  error: string | null;
  unlockPassword: string;
  busy: boolean;
  onUnlockPasswordChange: (value: string) => void;
  onUnlock: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}) {
  const enabled = Boolean(summary?.enabled);
  return (
    <section className="private-gate private-mode-page" aria-labelledby="private-gate-title">
      <div className="private-gate-card">
        <Icon name="lock" />
        <h2 id="private-gate-title">{!summary ? "正在读取私密设置…" : enabled ? "私密书签已锁定" : "还没有启用私密模式"}</h2>
        <p>{enabled ? "输入私密密码后，即可浏览和整理私密书签。刷新或关闭页面后需要重新解锁。" : "先在设置中为私密模式设置独立密码，再从浏览器扩展保存私密书签。"}</p>
        {error ? <p className="private-mode-feedback is-error" role="alert">{error}</p> : null}
        {enabled ? (
          <PrivateUnlockForm unlockPassword={unlockPassword} busy={busy} onUnlockPasswordChange={onUnlockPasswordChange} onUnlock={onUnlock} />
        ) : summary ? (
          <div className="private-mode-action-row"><button className="primary-button" type="button" onClick={onOpenSettings}>前往启用</button></div>
        ) : null}
        <div className="private-gate-links">
          <button type="button" onClick={onBack}>返回普通书签</button>
          {enabled ? <button type="button" onClick={onOpenSettings}>私密模式设置</button> : null}
        </div>
      </div>
    </section>
  );
}
