/**
 * KAIROS 认证模块
 * 基于 JWT 的轻量级本地认证，用于保护模拟交易 API。
 * 生产环境使用前需替换 JWT_SECRET 为强随机密钥。
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

// ── 配置 ──────────────────────────────────────────────────

const DEFAULT_SECRET = "kairos-local-dev-secret-change-in-production";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
const TOKEN_EXPIRY = "24h";

// 默认管理员凭据（仅用于本地开发）
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "kairos2026";

// ── JWT 工具函数 ──────────────────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function hmacSign(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export interface JwtPayload {
  sub: string;      // 用户名
  role: string;     // 角色
  iat: number;      // 签发时间
  exp: number;      // 过期时间
}

export function signToken(payload: { sub: string; role: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncode(
    JSON.stringify({
      sub: payload.sub,
      role: payload.role,
      iat: now,
      exp: now + 86400, // 24 hours
    }),
  );

  const signature = hmacSign(`${header}.${body}`, JWT_SECRET);
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, signature] = parts;
    const expectedSig = hmacSign(`${headerB64}.${bodyB64}`, JWT_SECRET);

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(base64urlDecode(bodyB64)) as JwtPayload;

    // 检查过期
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  return token;
}

// ── Zod 验证 Schema ───────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().trim().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
});

export type LoginRequest = z.infer<typeof loginSchema>;

// ── Fastify 认证装饰器 ────────────────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

/**
 * 认证中间件：验证 JWT token 并注入用户信息到 request.user
 */
export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.status(401).send({
      error: "UNAUTHORIZED",
      message: "缺少认证令牌，请先登录",
    });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return reply.status(401).send({
      error: "UNAUTHORIZED",
      message: "认证令牌无效或已过期",
    });
  }

  request.user = payload;
}

/**
 * 在 Fastify 实例上注册认证路由
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  // ── 登录 ──────────────────────────────────────────────
  app.post("/api/auth/login", {
    schema: {
      tags: ["认证"],
      summary: "用户登录",
      description: "使用用户名和密码登录，返回 JWT 访问令牌",
      body: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", description: "用户名" },
          password: { type: "string", description: "密码" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            token: { type: "string", description: "JWT 访问令牌" },
            expiresIn: { type: "number", description: "过期时间（秒）" },
            user: {
              type: "object",
              properties: {
                username: { type: "string" },
                role: { type: "string" },
              },
            },
          },
        },
        401: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body);

    // 本地开发简单验证
    const adminUser = process.env.AUTH_USERNAME || DEFAULT_USERNAME;
    const adminPass = process.env.AUTH_PASSWORD || DEFAULT_PASSWORD;

    if (username !== adminUser || password !== adminPass) {
      return reply.status(401).send({
        error: "INVALID_CREDENTIALS",
        message: "用户名或密码错误",
      });
    }

    const token = signToken({ sub: username, role: "admin" });

    return reply.send({
      token,
      expiresIn: 86400,
      user: { username, role: "admin" },
    });
  });

  // ── 验证令牌 ──────────────────────────────────────────
  app.get("/api/auth/verify", {
    schema: {
      tags: ["认证"],
      summary: "验证令牌",
      description: "验证当前 Bearer 令牌是否有效",
      headers: {
        type: "object",
        properties: {
          authorization: {
            type: "string",
            description: "Bearer <token>",
          },
        },
        required: ["authorization"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            user: {
              type: "object",
              properties: {
                username: { type: "string" },
                role: { type: "string" },
              },
            },
          },
        },
        401: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "缺少认证令牌",
      });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "认证令牌无效或已过期",
      });
    }

    return reply.send({
      valid: true,
      user: { username: payload.sub, role: payload.role },
    });
  });

  // ── 登出 ──────────────────────────────────────────────
  app.post("/api/auth/logout", {
    schema: {
      tags: ["认证"],
      summary: "用户登出",
      description: "客户端应丢弃本地存储的令牌。服务端为无状态设计，不维护会话。",
      response: {
        200: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
      },
    },
  }, async () => ({
    message: "已登出，请丢弃本地令牌",
  }));
}
