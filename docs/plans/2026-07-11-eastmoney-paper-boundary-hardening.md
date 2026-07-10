# 东方财富只读行情与统一纸面执行边界实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留东方财富公开行情研究原型，同时确保任何东方财富纸面订单都复用项目唯一的 `PaperBroker + RiskEngine` 执行链路。

**Architecture:** `EastMoneyMarketProvider` 只负责公开行情读取并拒绝 `live`。`EastMoneyBrokerAdapter` 只模拟连接生命周期和事件转发，使用内部可变行情缓存驱动标准 `PaperBroker`，不再维护独立现金、持仓、订单、费用或成交逻辑。

**Tech Stack:** TypeScript、Fastify 领域契约、PaperBroker、RiskEngine、InMemoryTradingStore、Vitest。

---

## 范围与约束

- 不接入真实东方财富账户、登录态、Token 或订单端点。
- 不把东方财富行情原型装配到主服务配置，直到数据授权和治理完成。
- 不允许 `tradingEnabled=true` 或 `environment=live`。
- 行情读取与订单执行继续属于不同权限域。
- 所有 Git 提交标题和正文使用中文。

### Task 1: 建立统一风控回归测试

**Files:**
- Modify: `server/broker/eastmoney/eastmoney.test.ts`

- [x] **Step 1: 保留连接、账户、持仓和订单契约测试**

验证适配器仍实现 `BrokerAdapter`，连接前拒绝订单，连接与断开事件保持可用。

- [x] **Step 2: 增加整手风控测试**

提交 `50` 股 A 股市价单，预期由共享 `RiskEngine` 返回 `rejected`，证明适配器无法绕过 `PaperBroker` 的整手规则。

- [x] **Step 3: 修正限价单语义**

买入限价低于当前价格时订单保持 `pending`；行情跌到限价后通过 `markToMarket` 转为 `filled`，不再由适配器直接假设成交。

### Task 2: 收敛东方财富纸面适配器

**Files:**
- Modify: `server/broker/eastmoney/EastMoneyBrokerAdapter.ts`
- Modify: `server/broker/eastmoney/EastMoneyMarketProvider.ts`

- [x] **Step 1: 删除重复交易状态**

移除适配器自建的现金、持仓、订单、手续费和成交逻辑。

- [x] **Step 2: 创建标准纸面运行时**

使用 `InMemoryTradingStore`、`RiskEngine` 和 `PaperBroker` 处理订单、费用、幂等、持仓和账户更新；适配器只负责连接延迟、心跳和事件转发。

- [x] **Step 3: 默认拒绝实盘模式**

券商适配器拒绝 `tradingEnabled=true` 与 `environment=live`；行情提供者也在构造阶段拒绝 `live`。

### Task 3: 修复编码并更新记录系统

**Files:**
- Modify: `src/styles/index.css`
- Create: `docs/decisions/0004-eastmoney-read-only-paper-boundary.md`
- Modify: `docs/decisions/README.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/roadmap.md`

- [x] **Step 1: 统一 CSS 编码**

将被 GBK 追加的 CSS 后缀机械转换为 UTF-8，保留全部样式规则并消除实际 `U+FFFD` 替换字符。

- [x] **Step 2: 记录长期边界**

新增决策记录，明确东方财富行情是未装配的只读原型，纸面适配器不是未来真实执行网关的基础类。

- [x] **Step 3: 同步当前状态**

更新测试数量、架构描述、安全边界、开发验证结果和路线图。

### Task 4: 最终验证

**Files:**
- Verify: repository-wide

- [x] **Step 1: 运行 Node 测试**

Run: `npm test`

Result: `24` 个测试文件、`455` 项测试全部通过。

- [x] **Step 2: 运行生产构建**

Run: `npm run build`

Result: TypeScript 项目引用检查和 Vite 生产构建通过。

- [x] **Step 3: 运行 Python 桥接测试**

Run: `python -m pytest akshare-bridge/test_bridge.py -q`

Result: `10` 项测试通过，存在一条 Starlette/httpx 弃用警告。

- [x] **Step 4: 运行安全与编码扫描**

```powershell
rg -n "\x{FFFD}" AGENTS.md README.md docs server src shared akshare-bridge
rg -n "order/submit|EASTMONEY_TOKEN|EASTMONEY_TRADING_ENABLED|REAL_TRADING_ENABLED=true" server src akshare-bridge .env.example
rg -n "fetch\(|axios|undici|trading\.eastmoney\.com" server/broker/eastmoney/EastMoneyBrokerAdapter.ts
git diff --check
```

Result: 无替换字符、无真实订单端点、东方财富纸面适配器无网络下单调用，差异检查通过。

## 关键决策

- 东方财富公开行情与订单执行保持为不同实现和不同未来权限域。
- 纸面券商适配器只能委托统一执行链路，不能维护第二套交易语义。
- 当前东方财富模块不装配到主服务，正式接入前先完成数据授权、时间边界和质量治理。
- 真实执行必须另建独立网关，并具备账户白名单、逐笔审批、额度、幂等、审计和紧急停止。

## 遗留问题

- 东方财富行情授权、交易日历、停牌、复权、限流和缓存治理仍未完成。
- PostgreSQL、身份认证、密钥管理、人工审批和独立执行网关仍属于后续阶段。
- 当前没有真实账户读取或真实订单发送能力。
