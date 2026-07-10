import { useState, type FormEvent } from "react";
import { BarChart3, Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n";

export function LoginPage() {
  const { login, isLoading, error, clearError } = useAuth();
  const { t, locale } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(username, password);
    } catch {
      // error is handled by auth context
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <BarChart3 size={32} />
          </div>
          <h1>KAIROS</h1>
          <p>
            {locale === "zh" ? "量化研究工作台" : "Quant Research Workbench"}
          </p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{locale === "zh" ? "登录" : "Sign In"}</h2>

          {/* Error */}
          {error && (
            <div className="login-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {/* Username */}
          <div className="login-field">
            <label htmlFor="login-username">
              {locale === "zh" ? "用户名" : "Username"}
            </label>
            <input
              autoComplete="username"
              autoFocus
              disabled={isLoading}
              id="login-username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              type="text"
              value={username}
            />
          </div>

          {/* Password */}
          <div className="login-field">
            <label htmlFor="login-password">
              {locale === "zh" ? "密码" : "Password"}
            </label>
            <div className="login-password-wrap">
              <input
                autoComplete="current-password"
                disabled={isLoading}
                id="login-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? (locale === "zh" ? "隐藏密码" : "Hide password") : (locale === "zh" ? "显示密码" : "Show password")}
                className="login-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                type="button"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            className="login-submit"
            disabled={isLoading || !username || !password}
            type="submit"
          >
            {isLoading ? (
              <>
                <span className="login-spinner" />
                {locale === "zh" ? "登录中..." : "Signing in..."}
              </>
            ) : (
              <>
                <LogIn size={18} />
                {locale === "zh" ? "登录" : "Sign In"}
              </>
            )}
          </button>

          {/* Footer */}
          <p className="login-footer">
            {locale === "zh"
              ? "本地开发环境 \u00B7 默认凭据: admin / kairos2026"
              : "Local dev environment \u00B7 Default: admin / kairos2026"}
          </p>
        </form>
      </div>
    </div>
  );
}
