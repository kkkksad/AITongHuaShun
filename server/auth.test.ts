import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  parseAuthConfig,
  registerAuthRoutes,
  signToken,
  verifyCredentials,
  verifyToken,
  type AuthConfig,
} from "./auth";

const config: AuthConfig = {
  username: "local-admin",
  password: "correct-horse-battery-staple",
  jwtSecret: "0123456789abcdef0123456789abcdef",
  tokenTtlSeconds: 3_600,
};

describe("auth configuration", () => {
  it("rejects missing or weak credentials", () => {
    expect(() => parseAuthConfig({})).toThrow();
    expect(() =>
      parseAuthConfig({
        AUTH_USERNAME: "admin",
        AUTH_PASSWORD: "short",
        JWT_SECRET: "short",
      }),
    ).toThrow();
  });

  it("parses explicit secure local configuration", () => {
    expect(
      parseAuthConfig({
        AUTH_USERNAME: config.username,
        AUTH_PASSWORD: config.password,
        JWT_SECRET: config.jwtSecret,
        AUTH_TOKEN_TTL_SECONDS: "1800",
      }),
    ).toEqual({ ...config, tokenTtlSeconds: 1_800 });
  });
});

describe("auth tokens", () => {
  it("signs and verifies a token with explicit configuration", () => {
    const token = signToken(
      { sub: config.username, role: "admin" },
      config,
      1_000,
    );
    expect(verifyToken(token, config, 1_001)).toMatchObject({
      sub: config.username,
      role: "admin",
      iat: 1_000,
      exp: 4_600,
    });
  });

  it("rejects expired and tampered tokens", () => {
    const token = signToken(
      { sub: config.username, role: "admin" },
      config,
      1_000,
    );
    expect(verifyToken(token, config, 4_600)).toBeNull();
    expect(verifyToken(`${token}tampered`, config, 1_001)).toBeNull();
  });

  it("compares both username and password", () => {
    expect(
      verifyCredentials(config.username, config.password, config),
    ).toBe(true);
    expect(
      verifyCredentials("wrong-user", config.password, config),
    ).toBe(false);
    expect(
      verifyCredentials(config.username, "wrong-password", config),
    ).toBe(false);
  });
});

describe("auth routes", () => {
  it("logs in and verifies a bearer token", async () => {
    const app = Fastify();
    registerAuthRoutes(app, config);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: config.username,
        password: "wrong-password",
      },
    });
    expect(rejected.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: config.username,
        password: config.password,
      },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json<{ token: string; expiresIn: number }>();
    expect(body.expiresIn).toBe(config.tokenTtlSeconds);

    const verified = await app.inject({
      method: "GET",
      url: "/api/auth/verify",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      valid: true,
      user: { username: config.username, role: "admin" },
    });

    await app.close();
  });
});
