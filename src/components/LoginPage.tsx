import { Lock, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { useI18n } from "../i18n";

export function LoginPage() {
  const { login, loginError, isLoading } = useAuth();
  const { t, locale } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setSubmitting(true);
    await login(username.trim(), password);
    setSubmitting(false);
  };

  const iszh = locale === "zh";

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="page-loader">
          <div className="page-loader-spinner" />
          <span>{iszh ? "正在验证会话..." : "Verifying session..."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </div>
          <h1>KAIROS</h1>
          <p>{t("brand.subtitle")}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{iszh ? "登录" : "Sign In"}</h2>

          {loginError && (
            <div className="login-error" role="alert">
              {loginError}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="login-username">
              {iszh ? "用户名" : "Username"}
            </label>
            <div className="login-input-wrapper">
              <User size={18} className="login-input-icon" />
              <input
                autoComplete="username"
                autoFocus
                disabled={submitting}
                id="login-username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder={iszh ? "请输入用户名" : "Enter username"}
                type="text"
                value={username}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="login-password">
              {iszh ? "密码" : "Password"}
            </label>
            <div className="login-input-wrapper">
              <Lock size={18} className="login-input-icon" />
              <input
                autoComplete="current-password"
                disabled={submitting}
                id="login-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder={iszh ? "请输入密码" : "Enter password"}
                type="password"
                value={password}
              />
            </div>
          </div>

          <button
            className="login-submit"
            disabled={submitting || !username.trim() || !password.trim()}
            type="submit"
          >
            {submitting
              ? (iszh ? "登录中..." : "Signing in...")
              : (iszh ? "登录" : "Sign In")}
          </button>

          <p className="login-hint">
            {iszh
              ? "本地开发环境 · 默认凭据: admin / kairos2026"
              : "Local dev environment · Default: admin / kairos2026"}
          </p>
        </form>
      </div>
    </div>
  );
}
