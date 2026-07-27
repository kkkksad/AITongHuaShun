import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const AUTH_COOKIE_NAME = "kairos_session";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const PASSWORD_HASH_PATTERN =
  /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;

const authEnvironmentSchema = z.object({
  AUTH_USERNAME: z.string().trim().min(1, "AUTH_USERNAME 不能为空").max(128),
  AUTH_PASSWORD_HASH: z
    .string()
    .regex(PASSWORD_HASH_PATTERN, "AUTH_PASSWORD_HASH 必须是 KAIROS scrypt 散列"),
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(28_800),
  AUTH_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_MAX_SESSIONS: z.coerce.number().int().min(1).max(20).default(3),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
  maxSessions: number;
  loginRateLimitMax: number;
}

export interface AuthUser {
  username: string;
  role: string;
}

export interface SessionRecord extends AuthUser {
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreatedSession extends SessionRecord {
  token: string;
}

interface StoredSession extends SessionRecord {
  tokenHash: string;
}

export interface SessionStoreOptions {
  ttlSeconds: number;
  maxSessions: number;
  now?: () => number;
}

export function parseAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const parsed = authEnvironmentSchema.parse(environment);
  return {
    username: parsed.AUTH_USERNAME,
    passwordHash: parsed.AUTH_PASSWORD_HASH,
    sessionTtlSeconds: parsed.AUTH_SESSION_TTL_SECONDS,
    cookieSecure: parsed.AUTH_COOKIE_SECURE,
    maxSessions: parsed.AUTH_MAX_SESSIONS,
    loginRateLimitMax: parsed.AUTH_LOGIN_RATE_LIMIT_MAX,
  };
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 256) {
    throw new Error("密码长度必须在 8 到 256 个字符之间");
  }
  const salt = crypto.randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (!PASSWORD_HASH_PATTERN.test(encodedHash) || password.length > 256) {
    return false;
  }

  try {
    const [, , , , saltText, digestText] = encodedHash.split("$");
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(digestText, "base64url");
    const actual = await derivePasswordKey(password, salt);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftDigest = crypto.createHash("sha256").update(left).digest();
  const rightDigest = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;

  constructor(options: SessionStoreOptions) {
    this.ttlMs = options.ttlSeconds * 1_000;
    this.maxSessions = options.maxSessions;
    this.now = options.now ?? Date.now;
  }

  create(username: string, role: string): CreatedSession {
    this.prune();
    const existing = [...this.sessions.values()]
      .filter((session) => session.username === username)
      .sort((left, right) => left.createdAt - right.createdAt);
    while (existing.length >= this.maxSessions) {
      const oldest = existing.shift();
      if (oldest) this.sessions.delete(oldest.tokenHash);
    }

    const now = this.now();
    const token = crypto.randomBytes(32).toString("base64url");
    const session: StoredSession = {
      tokenHash: hashToken(token),
      username,
      role,
      csrfToken: crypto.randomBytes(24).toString("base64url"),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(session.tokenHash, session);
    return { ...session, token };
  }

  verify(token: string): SessionRecord | null {
    if (!token || token.length > 256) return null;
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const { tokenHash: _tokenHash, ...record } = session;
    return record;
  }

  revoke(token: string): void {
    if (token && token.length <= 256) this.sessions.delete(hashToken(token));
  }

  clear(): void {
    this.sessions.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(tokenHash);
    }
  }
}

export function extractSessionToken(request: FastifyRequest): string | null {
  return request.cookies?.[AUTH_COOKIE_NAME] ?? null;
}

export const loginSchema = z.object({
  username: z.string().trim().min(1, "用户名不能为空").max(128),
  password: z.string().min(1, "密码不能为空").max(256),
});

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSession?: SessionRecord;
  }
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    error: "UNAUTHORIZED",
    message: "登录已失效，请重新登录",
  });
}

function hasValidCsrf(request: FastifyRequest, session: SessionRecord): boolean {
  const value = request.headers["x-csrf-token"];
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    timingSafeStringEqual(value, session.csrfToken)
  );
}

export function createAuthHook(sessions: SessionStore) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractSessionToken(request);
    const session = token ? sessions.verify(token) : null;
    if (!session) {
      await sendUnauthorized(reply);
      return;
    }

    request.authUser = { username: session.username, role: session.role };
    request.authSession = session;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !hasValidCsrf(request, session)) {
      await reply.status(403).send({
        error: "CSRF_VALIDATION_FAILED",
        message: "安全校验失败，请刷新页面后重试",
      });
    }
  };
}

function cookieOptions(config: AuthConfig) {
  return {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict" as const,
    maxAge: config.sessionTtlSeconds,
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: AuthConfig = parseAuthConfig(),
  sessions = new SessionStore({
    ttlSeconds: config.sessionTtlSeconds,
    maxSessions: config.maxSessions,
  }),
): void {
  app.post("/api/auth/login", {
    config: {
      rateLimit: {
        max: config.loginRateLimitMax,
        timeWindow: 60_000,
      },
    },
    schema: {
      tags: ["认证"],
      summary: "用户登录",
      description: "验证服务端 scrypt 密码散列并建立可撤销的 HttpOnly Cookie 会话",
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 128 },
          password: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: "INVALID_LOGIN_REQUEST",
        message: "请输入有效的用户名和密码",
      });
    }

    const usernameMatches = timingSafeStringEqual(result.data.username, config.username);
    const passwordMatches = await verifyPassword(result.data.password, config.passwordHash);
    if (!usernameMatches || !passwordMatches) {
      request.log.warn({ ip: request.ip }, "authentication failed");
      return reply.status(401).send({
        error: "INVALID_CREDENTIALS",
        message: "用户名或密码错误",
      });
    }

    const session = sessions.create(config.username, "admin");
    reply.setCookie(AUTH_COOKIE_NAME, session.token, cookieOptions(config));
    return reply.send({
      authenticated: true,
      expiresIn: config.sessionTtlSeconds,
      expiresAt: new Date(session.expiresAt).toISOString(),
      csrfToken: session.csrfToken,
      user: { username: session.username, role: session.role },
    });
  });

  app.get("/api/auth/session", {
    schema: {
      tags: ["认证"],
      summary: "读取当前会话",
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const token = extractSessionToken(request);
    const session = token ? sessions.verify(token) : null;
    if (!session) return sendUnauthorized(reply);
    return reply.send({
      authenticated: true,
      expiresAt: new Date(session.expiresAt).toISOString(),
      csrfToken: session.csrfToken,
      user: { username: session.username, role: session.role },
    });
  });

  app.post("/api/auth/logout", {
    schema: {
      tags: ["认证"],
      summary: "用户登出",
      description: "撤销服务端会话并删除浏览器 Cookie",
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const token = extractSessionToken(request);
    const session = token ? sessions.verify(token) : null;
    if (!token || !session) return sendUnauthorized(reply);
    if (!hasValidCsrf(request, session)) {
      return reply.status(403).send({
        error: "CSRF_VALIDATION_FAILED",
        message: "安全校验失败，请刷新页面后重试",
      });
    }

    sessions.revoke(token);
    reply.clearCookie(AUTH_COOKIE_NAME, cookieOptions(config));
    return reply.send({ message: "已安全退出" });
  });
}
