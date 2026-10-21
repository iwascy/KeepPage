import { type FormEvent, useEffect } from "react";
import { useDialogFocus } from "../../app/use-dialog-focus";
import { Icon } from "../../components/Icon";

export type AuthMode = "login" | "register";

export function AuthDialog({
  isDemoMode,
  mode,
  name,
  email,
  password,
  submitting,
  error,
  onClose,
  onModeChange,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  isDemoMode: boolean;
  mode: AuthMode;
  name: string;
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose, submitting);
  const isRegister = mode === "register";
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div
      className="lp-auth-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="auth-card lp-auth-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        tabIndex={-1}
      >
        <button className="lp-auth-close" type="button" aria-label="关闭" disabled={submitting} onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><Icon name="bookmark" /></span>
          <span>KeepPage</span>
        </div>
        <header className="auth-heading">
          <h1 id="auth-title">{isRegister ? "创建你的资料库" : "欢迎回来"}</h1>
          <p>{isRegister ? "免费注册，开始保存值得留下的网页。" : "登录后，继续整理和浏览你的网页收藏。"}</p>
        </header>

        <div className="auth-switch" role="group" aria-label="账号操作">
          <button
            className={mode === "login" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            aria-pressed={mode === "login"}
            disabled={submitting}
            onClick={() => onModeChange("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            aria-pressed={mode === "register"}
            disabled={submitting}
            onClick={() => onModeChange("register")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit} aria-busy={submitting}>
          {isRegister ? (
            <label className="field">
              <span>昵称 <small>可选</small></span>
              <input
                name="name"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="怎么称呼你"
                autoComplete="nickname"
                disabled={submitting}
              />
            </label>
          ) : null}
          <label className="field">
            <span>邮箱</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder={isDemoMode ? "演示模式可留空" : "name@example.com"}
              autoComplete="email"
              required={!isDemoMode}
              disabled={submitting}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={isDemoMode ? "演示模式不校验密码" : isRegister ? "设置至少 8 位密码" : "输入你的密码"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required={!isDemoMode}
              disabled={submitting}
              aria-describedby={isRegister && !isDemoMode ? "auth-password-hint" : undefined}
            />
            {isRegister && !isDemoMode ? <small id="auth-password-hint" className="auth-field-hint">至少 8 位，建议组合使用字母、数字和符号。</small> : null}
          </label>
          {error ? <p className="auth-error" role="alert"><Icon name="info" aria-hidden="true" />{error}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? <><span className="auth-spinner" aria-hidden="true" />{isRegister ? "正在创建账号…" : "正在登录…"}</> : isRegister ? "创建账号" : "登录"}
          </button>
        </form>
        <p className="auth-footnote"><Icon name="bookmarks" aria-hidden="true" />收藏、整理，随时回看。</p>
      </section>
    </div>
  );
}
