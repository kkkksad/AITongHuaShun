/**
 * KAIROS 认证原型。
 *
 * 当前模块尚未注册到主 Fastify 服务。未来启用前必须显式提供账号、
 * 密码和至少 32 字符的 JWT 密钥；缺少配置时默认拒绝启动认证路由。
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const authEnvironmentSchema = z.object({
  AUTH_USERNAME: z.string().trim().min(1, "AUTH_USERNAME 不能为空"),
  AUTH_PASSWORD: z.string().min(12, "AUTH_PASSWORD 至少需要 12 个字符"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET 至少需要 32 个字符"),
  AUTH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
});

const jwtHeaderSchema = z.object({
  alg: z.literal("HS256"),
  typ: z.literal("JWT"),
});

const jwtPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenTtlSeconds: number;
}

export interface JwtPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
}

export function parseAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const parsed = authEnvironmentSchema.parse(environment);
  return {
    username: parsed.AUTH_USERNAME,
    password: parsed.AUTH_PASSWORD,
    jwtSecret: parsed.JWT_SECRET,
    tokenTtlSeconds: parsed.AUTH_TOKEN_TTL_SECONDS,
  };
}

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function hmacSign(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftDigest = crypto.createHash("sha256").update(left).digest();
  const rightDigest = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export function verifyCredentials(
  username: string,
  password: string,
  config: AuthConfig,
): boolean {
  const usernameMatches = timingSafeStringEqual(username, config.username);
  const passwordMatches = timingSafeStringEqual(password, config.password);
  return usernameMatches && passwordMatches;
}

export function signToken(
  payload: { sub: string; role: string },
  config: Pick<AuthConfig, "jwtSecret" | "tokenTtlSeconds">,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64urlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const body = base64urlEncode(
    JSON.stringify({
      sub: payload.sub,
      role: payload.role,
      iat: nowSeconds,
      exp: nowSeconds + config.tokenTtlSeconds,
    }),
  );
  const signature = hmacSign(`${header}.${body}`, config.jwtSecret);
  return `${header}.${body}.${signature}`;
}

export function verifyToken(
  token: string,
  config: Pick<AuthConfig, "jwtSecret">,
  nowSeconds = Math.floor(Date.now() / 1000),
): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, signature] = parts;
    const expectedSignature = hmacSign(
      `${headerB64}.${bodyB64}`,
      config.jwtSecret,
    );
    if (!timingSafeStringEqual(signature, expectedSignature)) return null;

    const headerResult = jwtHeaderSchema.safeParse(
      JSON.parse(base64urlDecode(headerB64)),
    );
    if (!headerResult.success) return null;

    const payloadResult = jwtPayloadSchema.safeParse(
      JSON.parse(base64urlDecode(bodyB64)),
    );
    if (!payloadResult.success) return null;

    const payload = payloadResult.data;
    if (payload.exp <= nowSeconds) return null;
    if (payload.iat > nowSeconds + 60) return null;
    if (payload.exp <= payload.iat) return null;
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

export const loginSchema = z.object({
  username: z.string().trim().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
});

export type LoginRequest = z.infer<typeof loginSchema>;

declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

export function createAuthHook(config: AuthConfig) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractToken(request);
    if (!token) {
      await reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "缺少认证令牌，请先登录",
      });
      return;
    }

    const payload = verifyToken(token, config);
    if (!payload) {
      await reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "认证令牌无效或已过期",
      });
      return;
    }

    request.user = payload;
  };
}

/**
 * 注册尚未接入主服务的认证路由。
 *
 * 未传入 config 时从环境变量读取；缺少安全配置会直接抛出异常。
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  config: AuthConfig = parseAuthConfig(),
): void {
  app.post("/api/auth/login", {
    schema: {
      tags: ["认证"],
      summary: "用户登录",
      description: "使用显式配置的本地凭据登录，返回短期 JWT 访问令牌",
      body: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string" },
          password: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body);
    if (!verifyCredentials(username, password, config)) {
      return reply.status(401).send({
        error: "INVALID_CREDENTIALS",
        message: "用户名或密码错误",
      });
    }

    const token = signToken({ sub: username, role: "admin" }, config);
    return reply.send({
      token,
      expiresIn: config.tokenTtlSeconds,
      user: { username, role: "admin" },
    });
  });

  app.get("/api/auth/verify", {
    schema: {
      tags: ["认证"],
      summary: "验证令牌",
    },
  }, async (request, reply) => {
    const token = extractToken(request);
    const payload = token ? verifyToken(token, config) : null;
    if (!payload) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "认证令牌无效、缺失或已过期",
      });
    }

    return reply.send({
      valid: true,
      user: { username: payload.sub, role: payload.role },
    });
  });

  app.post("/api/auth/logout", {
    schema: {
      tags: ["认证"],
      summary: "用户登出",
      description: "客户端丢弃令牌；服务端不维护会话。",
    },
  }, async () => ({
    message: "已登出，请丢弃本地令牌",
  }));
}
