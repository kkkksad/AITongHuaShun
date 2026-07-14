# 强制登录与服务器会话安全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有可选本地 JWT 原型升级为默认强制登录、适合单实例服务器部署的可撤销 Cookie 会话认证，并确保未登录用户无法访问工作台数据、业务 API、文档、监控或 WebSocket。

**Architecture:** 后端保存短期内存会话，浏览器只持有随机、不透明、`HttpOnly` 的会话 Cookie；密码配置只保存 Node.js `scrypt` 散列，不保存明文。所有业务路由统一经过认证钩子，修改请求额外验证会话级 CSRF 令牌，WebSocket 使用同一 Cookie 与来源校验。前端启动时只验证当前会话，未认证时只渲染登录页，并在任意 API 返回 401 时立即清空工作台视图。

**Tech Stack:** Fastify 5、`@fastify/cookie`、`@fastify/rate-limit`、Node.js `crypto.scrypt`、React 19、TypeScript、Vitest、Vite。

---

### Task 1: 服务端密码与会话核心

**Files:**
- Modify: `server/auth.ts`
- Modify: `server/auth.test.ts`
- Modify: `server/config.ts`
- Modify: `server/config.test.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: 写失败测试**

覆盖以下行为：`scrypt` 散列可验证且不包含明文；错误密码和损坏散列被拒绝；会话可创建、读取、过期和撤销；默认配置要求认证；生产环境拒绝不安全 Cookie 或缺失散列。

```ts
const passwordHash = await hashPassword("correct-horse-battery-staple");
expect(passwordHash).not.toContain("correct-horse-battery-staple");
expect(await verifyPassword("correct-horse-battery-staple", passwordHash)).toBe(true);

const session = store.create("admin", "admin");
expect(store.verify(session.token)?.username).toBe("admin");
store.revoke(session.token);
expect(store.verify(session.token)).toBeNull();
```

- [x] **Step 2: 运行定向测试并确认失败**

Run: `npm run test:server -- server/auth.test.ts server/config.test.ts`

Expected: FAIL，因为新的散列与会话接口尚不存在。

- [x] **Step 3: 实现最小安全核心**

使用固定参数的 `crypto.scrypt` 格式 `scrypt$16384$8$1$<salt>$<digest>`；用 `timingSafeEqual` 比较派生密钥。实现有 TTL、最大活跃会话数、哈希索引和显式撤销的 `SessionStore`，原始令牌只返回给 Cookie，不写入日志或存储。

- [x] **Step 4: 接入 Cookie 插件与配置**

新增 `AUTH_PASSWORD_HASH`、`AUTH_SESSION_TTL_SECONDS`、`AUTH_COOKIE_SECURE`、`AUTH_LOGIN_RATE_LIMIT_MAX`、`AUTH_MAX_SESSIONS` 和 `TRUST_PROXY`。应用运行配置默认强制认证；仅测试构造器可显式关闭。

- [x] **Step 5: 运行定向测试**

Run: `npm run test:server -- server/auth.test.ts server/config.test.ts`

Expected: PASS。

### Task 2: 全 API、CSRF 与 WebSocket 防护

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] **Step 1: 写失败的路由边界测试**

只允许 `GET /api/health`、`POST /api/auth/login` 和会话验证接口匿名访问。断言 `/api/capabilities`、`/metrics`、`/documentation/json`、账户和研究接口匿名均返回 401；修改请求缺失 CSRF 返回 403。

```ts
expect((await app.inject({ url: "/api/account" })).statusCode).toBe(401);
expect((await app.inject({ url: "/metrics" })).statusCode).toBe(401);
expect((await app.inject({ method: "POST", url: "/api/trading/pause", headers: { cookie } })).statusCode).toBe(403);
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm run test:server -- server/app.test.ts`

Expected: FAIL，因为能力声明、监控和文档当前仍公开，认证仍依赖 Bearer JWT。

- [x] **Step 3: 注册统一防护钩子**

认证成功后把用户与 CSRF 值附加到请求；所有 `/api` 业务端点、指标和 OpenAPI 都受保护。登录路由限制尝试频率，认证响应使用 `Cache-Control: no-store`；Cookie 设置 `HttpOnly`、`SameSite=Strict`、`Path=/`，生产环境必须 `Secure`。

- [x] **Step 4: 保护 WebSocket**

移除 URL 查询令牌，握手只接受有效会话 Cookie，并验证 `Origin === WEB_ORIGIN`；失败使用 1008 关闭。应用关闭时清理会话存储。

- [x] **Step 5: 运行服务端完整测试**

Run: `npm run test:server`

Expected: 所有服务端测试通过。

### Task 3: 强制登录页与浏览器会话生命周期

**Files:**
- Create: `src/components/LoginPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/styles/index.css`
- Modify: `src/i18n/translations.ts`

- [x] **Step 1: 删除浏览器令牌存储**

所有 `fetch` 使用 `credentials: "include"`；删除 `localStorage` 令牌和 WebSocket 查询参数。登录和会话验证响应只保留用户、过期时间和 CSRF 值。

- [x] **Step 2: 实现认证失效事件**

受保护请求收到 401 时清空内存 CSRF 并派发 `kairos:auth-expired`；`App` 监听后立即返回登录页，防止只显示“后端离线”而继续保留私有页面。

- [x] **Step 3: 拆分并完成登录页面**

登录页包含用户名、密码显示切换、提交中状态、错误提示、服务端不可用提示和正确的自动填充属性。登录成功前不挂载交易数据查询和 WebSocket。

- [x] **Step 4: 完成登出**

登出请求携带 CSRF，服务端撤销会话并清 Cookie；无论网络结果如何，前端立即清空用户并返回登录页。

- [x] **Step 5: 运行前端测试与构建**

Run: `npm run test:web`

Expected: PASS。

Run: `npm run build`

Expected: TypeScript 与 Vite 生产构建通过。

### Task 4: 初始化工具与部署文档

**Files:**
- Create: `scripts/setup-auth.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docs/operations/development.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`
- Create: `docs/decisions/0006-required-session-authentication.md`

- [x] **Step 1: 新增一次性初始化命令**

`npm run auth:setup -- --username <name>` 生成随机初始密码，只把用户名和散列写入 `.env.local`，密码仅在终端显示一次；使用同目录临时文件原子替换并保留其他环境变量，避免复制额外的密钥备份。

- [x] **Step 2: 让生产容器显式提供认证密钥**

Compose 不内置默认凭据，生产环境通过 `.env`/secret 提供 `AUTH_USERNAME` 与 `AUTH_PASSWORD_HASH`，并设置 `AUTH_COOKIE_SECURE=true` 和真实 `WEB_ORIGIN=https://...`。缺失配置时后端健康检查不会启动成功。

- [x] **Step 3: 更新权威文档和决策记录**

明确当前实现适合单实例、必须使用 HTTPS、反向代理后端端口不得直接暴露、会话重启失效、多实例需要共享会话库；登录只保护研究和模拟交易工作台，不授权真实券商执行。

### Task 5: 最终验证

**Files:**
- Modify: `docs/plans/2026-07-14-required-login-and-session-security.md`
- Modify: `docs/status/current-state.md`

- [x] **Step 1: 初始化本机非默认凭据**

运行初始化工具，在被 Git 忽略的 `.env.local` 中保存随机用户名配置和密码散列，不提交密码或散列。

- [x] **Step 2: 运行完整自动化检查**

Run: `npm test`

Expected: 全部服务端和前端测试通过。

Run: `npm run build`

Expected: TypeScript 与 Vite 生产构建通过。

- [x] **Step 3: 浏览器验收**

在桌面和 390px 手机视口验证：首次访问只能看到登录页；错误密码有明确提示；成功登录进入工作台；刷新保持会话；登出和会话失效立即返回登录页；页面无横向溢出；浏览器存储与 WebSocket URL 不包含认证令牌。

- [x] **Step 4: 记录结果**

在本计划和 `docs/status/current-state.md` 写入实际测试数量、构建结果、浏览器尺寸与任何剩余限制。

## 实施结果

- `npm test`：27 个服务端测试文件、564 项服务端测试；3 个前端测试文件、12 项前端测试，全部通过。
- `npm run build`：TypeScript 项目引用检查与 Vite 生产构建通过。
- 运行态：`paper + akshare`，`authEnabled=true`；匿名 `/api/health` 为 200，`/api/capabilities`、账户、复盘、指标与 OpenAPI 文档均为 401。
- 浏览器：错误密码、成功登录、刷新保持、认证 WebSocket、安全登出均通过；桌面布局无重叠，390 x 844 视口 `scrollWidth === clientWidth === 390` 且登录面板完整可见。
- `npm run check:a-share`：检查脚本通过临时 Cookie 会话访问受保护的 KAIROS 快照，6 项 A 股链路检查全部通过，后端 `paper + akshare`，有效指数 4 个。
- 本机 `.env.local` 已配置用户 `kjq` 与有效 scrypt 散列，明文初始密码未写入仓库或环境文件。
- Docker CLI 未安装，`docker compose config/build` 无法在本机执行；Dockerfile 与 Compose 已静态更新，部署前仍需在有 Docker 的服务器按 `docs/operations/deployment.md` 完成容器构建与 HTTPS 验收。
