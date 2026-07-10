# 只读真实行情与 API 契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持订单仅由本地 `PaperBroker` 执行的前提下，接通可选的 AkShare 只读行情，并为 TypeScript API 增加可审计的 OpenAPI 契约和能力声明。

**Architecture:** Fastify 主服务通过 `MARKET_DATA_PROVIDER` 选择确定性模拟行情或 AkShare HTTP 行情适配器；无论行情来源如何，订单都继续进入本地纸面撮合。FastAPI 桥接只暴露健康检查和行情读取，使用单一入口、可选服务端令牌和受限 CORS。OpenAPI 文档描述研究与模拟交易 API，不提供真实执行端点。

**Tech Stack:** React 19、TypeScript、Fastify 5、`@fastify/swagger`、`@fastify/swagger-ui`、Zod、FastAPI、AkShare、Vitest、pytest。

---

## 范围与安全约束

- 不实现真实券商登录、真实账户查询或真实订单发送。
- `REAL_TRADING_ENABLED=true` 与 `MARKET_MODE=live` 必须在服务启动阶段失败。
- AkShare 只作为只读行情来源；行情凭据只能从服务端环境变量读取。
- 前端继续使用 React Router 与 TanStack Query，不增加重叠的全局状态库。
- PostgreSQL、认证、审批和独立执行网关保持为后续独立阶段。
- 所有 Git 提交标题和正文使用中文。

### Task 1: OpenAPI 与能力声明

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server/config.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `.env.example`

- [x] **Step 1: 写入能力接口和 OpenAPI 失败测试**

在 `server/app.test.ts` 验证：

```ts
expect((await app.inject({ method: "GET", url: "/api/capabilities" })).json())
  .toMatchObject({
    marketData: { provider: "mock", readOnly: true },
    execution: { provider: "paper-broker", liveSupported: false },
  });
```

同时验证启用文档时 `/documentation/json` 返回包含 `/api/orders` 和 `/api/capabilities` 的 OpenAPI 文档。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- server/app.test.ts`

Expected: 能力接口或 OpenAPI 路由尚不存在而失败。

- [x] **Step 3: 安装并注册 OpenAPI 插件**

Run:

```powershell
npm install @fastify/swagger @fastify/swagger-ui
```

增加 `API_DOCS_ENABLED` 配置；在 Fastify 注册路由前注册 OpenAPI 插件，并新增 `/api/capabilities`。

- [x] **Step 4: 运行 API 测试**

Run: `npm test -- server/app.test.ts`

Expected: 能力声明、安全响应头、限流和 OpenAPI 测试全部通过。

### Task 2: 可切换的只读行情提供者

**Files:**
- Modify: `server/config.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `server/system.ts`
- Modify: `server/market/AkShareProvider.ts`
- Modify: `server/market/AkShareProvider.test.ts`
- Create: `server/system.test.ts`
- Modify: `.env.example`

- [x] **Step 1: 写入提供者选择和实盘拒绝测试**

测试以下行为：

```ts
expect(() => createTradingSystem({
  ...createTestConfig(),
  REAL_TRADING_ENABLED: true,
})).toThrow("真实交易");
```

并验证 `MARKET_DATA_PROVIDER=akshare` 时创建 `AkShareMarketProvider`，系统仍使用 `PaperBroker`。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- server/system.test.ts server/market/AkShareProvider.test.ts`

Expected: 新配置和提供者选择尚未实现而失败。

- [x] **Step 3: 实现最小提供者工厂**

新增配置：

```text
MARKET_DATA_PROVIDER=mock
MARKET_SYMBOLS=600519,000858,300750,601318
AKSHARE_BRIDGE_URL=http://127.0.0.1:8800
AKSHARE_BRIDGE_TOKEN=
MARKET_DATA_TIMEOUT_MS=15000
```

`mock` 使用 `MockMarket`；`akshare` 使用 `AkShareMarketProvider`，并要求 `MARKET_MODE=paper`。任何模式都不得启用真实交易。

- [x] **Step 4: 运行系统与行情测试**

Run: `npm test -- server/system.test.ts server/market/AkShareProvider.test.ts`

Expected: 提供者选择、服务端令牌传递和实盘拒绝测试通过。

### Task 3: 收敛 FastAPI 行情桥接

**Files:**
- Modify: `akshare-bridge/main.py`
- Delete: `akshare-bridge/server.py`
- Modify: `akshare-bridge/Dockerfile`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`
- Modify: `docker-compose.yml`

- [x] **Step 1: 增加健康检查、安全头和令牌测试**

使用 FastAPI `TestClient` 验证 `/health` 与 `/api/health` 一致，配置令牌后无授权请求返回 401。

- [x] **Step 2: 统一入口与容器健康检查**

只保留 `main.py`，Docker 镜像复制并启动该文件；CORS 默认仅允许本地 Fastify 来源，不允许凭据型通配来源。

- [x] **Step 3: 运行 Python 测试**

Run:

```powershell
python -m pytest akshare-bridge/test_bridge.py -q
```

Expected: FastAPI 桥接测试全部通过。

### Task 4: VS Code 联调、决策记录与最终验收

**Files:**
- Modify: `.vscode/launch.json`
- Create: `.vscode/extensions.json`
- Create: `docs/decisions/0003-read-only-market-provider-boundary.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/2026-07-11-framework-and-trading-boundary-hardening.md`
- Modify: `docs/plans/2026-07-11-read-only-market-and-api-contracts.md`

- [x] **Step 1: 增加三服务调试配置**

增加 `KAIROS：AkShare 行情桥接`、`KAIROS：后端纸面交易（AkShare）` 和 `KAIROS：真实行情 + 模拟交易调试`。

- [x] **Step 2: 更新权威文档和架构决策**

明确当前框架栈、真实只读行情启用方式、OpenAPI 地址，以及“真实行情不等于真实交易”。

- [x] **Step 3: 完整验证**

Run:

```powershell
npm test
npm run build
python -m pytest akshare-bridge/test_bridge.py -q
rg -n "\x{FFFD}" AGENTS.md README.md docs server src shared akshare-bridge
git diff --check
```

Expected: 全部通过，无替换字符、无真实订单端点、无浏览器 Token。

- [x] **Step 4: 中文提交**

仅暂存本计划相关文件，提交标题：

```text
架构：接通只读真实行情并补齐接口契约
```

## 验证结果

- 实施前：`15` 个测试文件、`240` 项测试通过。
- 最终结果：`19` 个 Vitest 文件、`271` 项测试全部通过；FastAPI 桥接 `10` 项测试通过；TypeScript 与 Vite 生产构建通过。

## 遗留问题

- PostgreSQL、用户认证、审批服务、密钥管理和真实执行网关仍需独立设计、测试与审计。
- AkShare 数据可用于研究和模拟交易，但其来源质量、授权、停牌、复权和时间边界仍需继续治理。
