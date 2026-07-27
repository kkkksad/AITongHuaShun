import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SessionStore,
  hashPassword,
  parseAuthConfig,
  registerAuthRoutes,
  verifyPassword,
  type AuthConfig,
} from "./auth";

const rawPassword = "correct-horse-battery-staple";
let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(rawPassword);
});

function createAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    username: "local-admin",
    passwordHash,
    sessionTtlSeconds: 3_600,
    cookieSecure: false,
    maxSessions: 3,
    loginRateLimitMax: 5,
    ...overrides,
  };
}

describe("auth configuration", () => {
  it("rejects missing or malformed password hashes", () => {
    expect(() => parseAuthConfig({})).toThrow();
    expect(() =>
      parseAuthConfig({
        AUTH_USERNAME: "admin",
        AUTH_PASSWORD_HASH: "plaintext-password",
      }),
    ).toThrow();
  });

  it("parses explicit session security configuration", () => {
    expect(
      parseAuthConfig({
        AUTH_USERNAME: "local-admin",
        AUTH_PASSWORD_HASH: passwordHash,
        AUTH_SESSION_TTL_SECONDS: "1800",
        AUTH_COOKIE_SECURE: "true",
        AUTH_MAX_SESSIONS: "2",
        AUTH_LOGIN_RATE_LIMIT_MAX: "4",
      }),
    ).toEqual({
      username: "local-admin",
      passwordHash,
      sessionTtlSeconds: 1_800,
      cookieSecure: true,
      maxSessions: 2,
      loginRateLimitMax: 4,
    });
  });
});

describe("password hashing", () => {
  it("stores a scrypt hash instead of the raw password", async () => {
    expect(passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(passwordHash).not.toContain(rawPassword);
    expect(await verifyPassword(rawPassword, passwordHash)).toBe(true);
  });

  it("rejects wrong passwords and malformed hashes", async () => {
    expect(await verifyPassword("wrong-password", passwordHash)).toBe(false);
    expect(await verifyPassword(rawPassword, "not-a-password-hash")).toBe(false);
  });

  it("accepts an explicit eight-character password and rejects shorter values", async () => {
    const minimumPassword = "12345678";
    const minimumHash = await hashPassword(minimumPassword);

    expect(await verifyPassword(minimumPassword, minimumHash)).toBe(true);
    await expect(hashPassword("1234567")).rejects.toThrow("8 到 256");
  });
});

describe("server sessions", () => {
  it("creates, verifies, expires, and revokes opaque sessions", () => {
    let now = 1_000_000;
    const sessions = new SessionStore({
      ttlSeconds: 60,
      maxSessions: 2,
      now: () => now,
    });

    const first = sessions.create("local-admin", "admin");
    expect(first.token).toHaveLength(43);
    expect(sessions.verify(first.token)).toMatchObject({
      username: "local-admin",
      role: "admin",
      csrfToken: first.csrfToken,
      expiresAt: 1_060_000,
    });

    sessions.revoke(first.token);
    expect(sessions.verify(first.token)).toBeNull();

    const expiring = sessions.create("local-admin", "admin");
    now = 1_060_001;
    expect(sessions.verify(expiring.token)).toBeNull();
  });

  it("evicts the oldest session when the per-user limit is reached", () => {
    let now = 1_000_000;
    const sessions = new SessionStore({
      ttlSeconds: 3_600,
      maxSessions: 2,
      now: () => now,
    });
    const first = sessions.create("local-admin", "admin");
    now += 1;
    const second = sessions.create("local-admin", "admin");
    now += 1;
    const third = sessions.create("local-admin", "admin");

    expect(sessions.verify(first.token)).toBeNull();
    expect(sessions.verify(second.token)).not.toBeNull();
    expect(sessions.verify(third.token)).not.toBeNull();
  });
});

describe("auth routes", () => {
  it("uses an HttpOnly cookie and revokes it on CSRF-protected logout", async () => {
    const app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit);
    const sessions = new SessionStore({ ttlSeconds: 3_600, maxSessions: 3 });
    registerAuthRoutes(app, createAuthConfig(), sessions);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "local-admin", password: "wrong-password" },
    });
    expect(rejected.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "local-admin", password: rawPassword },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).not.toHaveProperty("token");
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toContain("kairos_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const sessionCookie = setCookie.split(";")[0];

    const verified = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: sessionCookie },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      authenticated: true,
      csrfToken,
      user: { username: "local-admin", role: "admin" },
    });

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: sessionCookie },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: sessionCookie, "x-csrf-token": csrfToken },
    });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: sessionCookie },
    });
    expect(afterLogout.statusCode).toBe(401);
    await app.close();
  });
});
