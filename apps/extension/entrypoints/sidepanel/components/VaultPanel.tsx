import { useState } from "react";
import type { PrivateAutoLock, PrivateVaultSummary } from "@keeppage/domain";

export const AUTO_LOCK_OPTIONS: Array<{ value: PrivateAutoLock; label: string }> = [
  { value: "5m", label: "5 分钟" },
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "browser", label: "浏览器关闭后" },
];

type VaultPanelProps = {
  summary: PrivateVaultSummary | null;
  onCreate: (passphrase: string, confirm: string, autoLock: PrivateAutoLock) => Promise<boolean>;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onLock: () => void;
  onChangeAutoLock: (autoLock: PrivateAutoLock) => void;
};

export function VaultPanel({ summary, onCreate, onUnlock, onLock, onChangeAutoLock }: VaultPanelProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [autoLock, setAutoLock] = useState<PrivateAutoLock>("15m");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<boolean>, reset: () => void) {
    setBusy(true);
    try {
      if (await action()) {
        reset();
      }
    } finally {
      setBusy(false);
    }
  }

  if (summary?.enabled && summary.unlocked) {
    return (
      <section aria-label="私密空间" className="sp-vault-bar">
        <span>已保存 {summary.totalItems ?? 0}</span>
        <span>待同步 {summary.pendingSyncCount ?? 0}</span>
        <label className="sp-vault-autolock">
          <span>自动锁定</span>
          <select onChange={(event) => onChangeAutoLock(event.target.value as PrivateAutoLock)} value={summary.autoLock ?? "15m"}>
            {AUTO_LOCK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button className="sp-button is-secondary is-compact" onClick={onLock} type="button">
          锁定
        </button>
      </section>
    );
  }

  if (!summary?.enabled) {
    return (
      <section aria-labelledby="sp-vault-setup-title" className="sp-card sp-vault">
        <h2 id="sp-vault-setup-title">启用私密模式</h2>
        <p>设置一个私密密码。私密条目与普通书签分开存放，进入时需要输入密码。</p>
        <form
          className="sp-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => onCreate(passphrase, confirm, autoLock), () => {
              setPassphrase("");
              setConfirm("");
            });
          }}
        >
          <input
            aria-label="私密密码"
            autoComplete="new-password"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="私密密码（至少 8 位）"
            type="password"
            value={passphrase}
          />
          <input
            aria-label="确认私密密码"
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="再次输入密码"
            type="password"
            value={confirm}
          />
          <label className="sp-field-inline">
            <span>自动锁定</span>
            <select onChange={(event) => setAutoLock(event.target.value as PrivateAutoLock)} value={autoLock}>
              {AUTO_LOCK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button className="sp-button is-primary" disabled={busy} type="submit">
            {busy ? "启用中…" : "启用私密模式"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="sp-vault-unlock-title" className="sp-card sp-vault">
      <h2 id="sp-vault-unlock-title">私密模式已锁定</h2>
      <p>输入私密密码后，才能查看和保存私密条目。</p>
      <form
        className="sp-form is-inline"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => onUnlock(unlockPassphrase), () => setUnlockPassphrase(""));
        }}
      >
        <input
          aria-label="私密密码"
          autoComplete="current-password"
          onChange={(event) => setUnlockPassphrase(event.target.value)}
          placeholder="私密密码"
          type="password"
          value={unlockPassphrase}
        />
        <button className="sp-button is-primary" disabled={busy || !unlockPassphrase} type="submit">
          {busy ? "解锁中…" : "解锁"}
        </button>
      </form>
    </section>
  );
}
