# 前后端框架与交易边界加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入真正被项目使用的前后端基础框架，并确保未来券商接入不能绕过当前风控与模拟交易边界。

**Architecture:** 前端使用 React Router 管理工作台视图 URL，使用 TanStack Query 管理 REST 启动快照与交易变更缓存，WebSocket 只负责增量写入同一缓存。后端使用 Fastify Helmet 和 Rate Limit 提供默认 HTTP 防护；券商模拟适配器只代理现有 `PaperBroker`，不再复制撮合、费用或风控逻辑，并明确拒绝实盘环境。

**Tech Stack:** React 19、TypeScript、React Router、TanStack Query、Fastify 5、Helmet、Rate Limit、Vitest。

---

## 范围与约束

- 当前仍只允许研究、回测和模拟交易。
- 不接入真实券商、不读取真实账户、不实现真实订单发送。
- 不把 Token 暴露到浏览器或 `VITE_*` 环境变量。
- 不提交当前工作区中尚未完成的 MACD、海龟策略文件。
- 所有 Git 提交标题和正文使用中文。

### Task 1: 后端 HTTP 安全基线

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server/config.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写入失败测试**

在 `server/app.test.ts` 增加安全响应头和限流测试：

```ts
it("adds baseline security headers", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
});

it("rate limits repeated requests", async () => {
  const limitedApp = await buildTradingApp({
    config: createTestConfig({ RATE_LIMIT_MAX: 1 }),
    startMarket: false,
  });
  await limitedApp.inject({ method: "GET", url: "/api/health" });
  const response = await limitedApp.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(429);
  await limitedApp.close();
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- server/app.test.ts`

Expected: 因插件和配置尚未实现而失败。

- [ ] **Step 3: 安装并注册安全插件**

Run:

```powershell
npm install @fastify/helmet @fastify/rate-limit
```

在 `server/config.ts` 增加：

```ts
RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
```

在 `server/app.ts` 注册 Helmet 和全局限流，并保持 WebSocket、CORS 与测试注入可用。

- [ ] **Step 4: 运行后端测试**

Run: `npm test -- server/app.test.ts`

Expected: 安全响应头和限流测试通过。

### Task 2: React 路由与服务状态缓存

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useTradingBackend.ts`

- [ ] **Step 1: 安装前端基础框架**

Run:

```powershell
npm install react-router-dom @tanstack/react-query
```

- [ ] **Step 2: 建立应用级 Provider**

在 `src/main.tsx` 使用：

```tsx
<QueryClientProvider client={queryClient}>
  <BrowserRouter>
    <App />
  </BrowserRouter>
</QueryClientProvider>
```

- [ ] **Step 3: 将视图状态映射为路由**

使用 `/`、`/strategy`、`/market`、`/account`、`/learning` 映射现有五个视图；侧边栏继续使用 `ViewId`，但点击时调用 `navigate()`，刷新页面后保持当前视图。

- [ ] **Step 4: 将 REST 快照迁移到 TanStack Query**

`useTradingBackend` 使用固定键：

```ts
const tradingQueryKey = ["trading-bootstrap"] as const;
```

初始 REST 请求由 `useQuery` 管理，WebSocket 和订单 mutation 使用 `queryClient.setQueryData()` 更新同一份 `TradingBootstrap`，避免 REST 与实时状态形成两套来源。

- [ ] **Step 5: 运行类型检查与构建**

Run: `npm run build`

Expected: TypeScript 和 Vite 构建通过。

### Task 3: 券商适配器安全代理

**Files:**
- Modify: `server/contracts/BrokerAdapter.ts`
- Modify: `server/broker/MockBrokerAdapter.ts`
- Modify: `server/broker/brokerAdapter.test.ts`

- [ ] **Step 1: 写入失败测试**

增加以下行为：

```ts
expect(
  () => new MockBrokerAdapter(
    { ...config, environment: "live" },
    paperBroker,
  ),
).toThrow("禁止实盘");
```

同时增加超额订单测试，证明适配器返回 `MAX_ORDER_NOTIONAL` 风控拒绝，而不是自行撮合。

- [ ] **Step 2: 运行适配器测试并确认失败**

Run: `npm test -- server/broker/brokerAdapter.test.ts`

Expected: 当前适配器仍复制撮合逻辑，安全测试失败。

- [ ] **Step 3: 改为代理 PaperBroker**

`MockBrokerAdapter` 构造函数只接收 `BrokerAdapterConfig` 与现有 `PaperBroker`。订单、账户、持仓、撤单和盯市全部委托给 `PaperBroker`；适配器仅模拟连接、网络延迟和转发事件。

配置改为服务端引用，不保存明文 Token：

```ts
environment?: "paper" | "sandbox" | "live";
credentialsRef?: string;
```

当 `environment === "live"` 时，模拟适配器在构造阶段立即拒绝。

- [ ] **Step 4: 运行适配器和风控测试**

Run:

```powershell
npm test -- server/broker/brokerAdapter.test.ts server/risk/riskEngine.test.ts
```

Expected: 连接、事件、订单和风控测试全部通过。

### Task 4: 文档与最终验收

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/2026-07-11-framework-and-trading-boundary-hardening.md`

- [ ] **Step 1: 更新权威文档**

记录已实现的 Router、Query、安全插件、券商适配安全代理和配置项；明确 PostgreSQL、认证、审批服务与真实执行仍未实现。

- [ ] **Step 2: 扫描 UTF-8 损坏与替换字符**

Run:

```powershell
rg -n "�" AGENTS.md README.md docs server src shared
```

Expected: 无实际 `U+FFFD` 替换字符。

- [ ] **Step 3: 完整验证**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: 全部通过，且工作区只包含本计划相关改动和用户已有的未完成策略文件。

- [ ] **Step 4: 浏览器验收**

启动 `npm run dev`，验证五个 URL 可直接访问、侧边栏跳转正常、模拟账户数据加载、实时连接建立，且控制台没有新增错误。

- [ ] **Step 5: 中文提交**

仅暂存本计划涉及文件，提交标题：

```text
加固：补齐前后端框架与模拟交易边界
```

## 关键决策

- React Router 和 TanStack Query 被实际用于导航和服务状态，不作为未使用依赖安装。
- 暂不引入 Prisma/Drizzle/PostgreSQL；数据库模型需要先完成数据保留、事务和审计设计。
- 模拟券商适配器复用 `PaperBroker`，避免出现第二套绕过 `RiskEngine` 的撮合实现。
- 当前不实现任何真实执行网关；未来必须单独部署、单独凭据、逐笔审批并通过独立审计。

## 验证结果

- 计划开始前：`10` 个测试文件、`156` 项测试通过。
- 最终结果：待实施完成后填写。

## 遗留问题

- PostgreSQL 交易存储、用户认证、审批服务、密钥管理和券商沙箱接入仍属于后续独立阶段。
- 工作区已有未完成的 MACD 与海龟策略文件，本计划不修改、不暂存、不提交。
