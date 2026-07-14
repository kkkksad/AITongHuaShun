import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  BarChart3,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { login, type AuthUser } from "../lib/tradingApi";

interface LoginPageProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const response = await login(username, password);
      onAuthenticated(response.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-surface" aria-labelledby="login-title">
        <header className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <BarChart3 size={24} strokeWidth={2} />
          </span>
          <span>
            <strong>玄枢 Quant</strong>
            <small>AI A股研究系统</small>
          </span>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-heading">
            <span className="auth-access-label">
              <LockKeyhole size={14} />
              受保护访问
            </span>
            <h1 id="login-title">登录工作台</h1>
            <p>请输入服务器管理员凭据。</p>
          </div>

          <label className="auth-field">
            <span>用户名</span>
            <span className="auth-input-wrap">
              <UserRound aria-hidden="true" size={18} />
              <input
                autoComplete="username"
                autoFocus
                disabled={pending}
                maxLength={128}
                name="username"
                onChange={(event) => setUsername(event.target.value)}
                required
                spellCheck={false}
                type="text"
                value={username}
              />
            </span>
          </label>

          <label className="auth-field">
            <span>密码</span>
            <span className="auth-input-wrap">
              <LockKeyhole aria-hidden="true" size={18} />
              <input
                autoComplete="current-password"
                disabled={pending}
                maxLength={256}
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="auth-password-toggle"
                disabled={pending}
                onClick={() => setShowPassword((current) => !current)}
                title={showPassword ? "隐藏密码" : "显示密码"}
                type="button"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error && (
            <div className="auth-error" role="alert">
              <AlertCircle aria-hidden="true" size={17} />
              <span>{error}</span>
            </div>
          )}

          <button
            className="auth-submit"
            disabled={pending || !username.trim() || !password}
            type="submit"
          >
            {pending ? <LoaderCircle className="auth-spinner" size={18} /> : <LockKeyhole size={18} />}
            <span>{pending ? "正在验证" : "登录"}</span>
          </button>
        </form>

        <footer className="auth-footer">仅限授权用户访问</footer>
      </section>
    </main>
  );
}
