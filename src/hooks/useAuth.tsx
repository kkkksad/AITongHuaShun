import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ── Types ──────────────────────────────────────────────────

export interface AuthUser {
  username: string;
  role: string;
}

interface LoginResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

interface VerifyResponse {
  valid: boolean;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginError: string | null;
  login(username: string, password: string): Promise<boolean>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_TOKEN_KEY = "kairos_auth_token";
const AUTH_USER_KEY = "kairos_auth_user";

// ── API helpers ────────────────────────────────────────────

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `认证失败：${response.status}`);
  }
  return payload;
}

// ── Provider ───────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // 启动时从 localStorage 恢复会话
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUser = localStorage.getItem(AUTH_USER_KEY);

    if (storedToken && storedUser) {
      // 验证令牌是否仍然有效
      authRequest<VerifyResponse>("/api/auth/verify", {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
        .then((result) => {
          if (result.valid) {
            setToken(storedToken);
            setUser(result.user);
          } else {
            // 令牌无效，清除
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_USER_KEY);
          }
        })
        .catch(() => {
          // 后端不可用时也保留令牌（离线降级）
          try {
            const parsed = JSON.parse(storedUser) as AuthUser;
            setToken(storedToken);
            setUser(parsed);
          } catch {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_USER_KEY);
          }
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setLoginError(null);
    try {
      const result = await authRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      setToken(result.token);
      setUser(result.user);
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(result.user));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      setLoginError(message);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    // 尝试通知服务端（fire-and-forget）
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${storedToken}`,
        },
      }).catch(() => {
        // 忽略登出 API 错误
      });
    }

    setToken(null);
    setUser(null);
    setLoginError(null);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      isLoading,
      loginError,
      login,
      logout,
    }),
    [user, token, isLoading, loginError, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
