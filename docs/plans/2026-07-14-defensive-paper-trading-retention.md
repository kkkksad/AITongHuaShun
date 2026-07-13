# 防守型 paper 自动交易与七天留存实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 10000 元本地 paper 账户使用更偏防守的策略候选，完整记录每次自动执行或跳过原因，并只保留最近 7 天的订单与审计历史。

**Architecture:** 防守型策略继续通过现有回测策略工厂、排行榜和纸面计划进入本地 `PaperBroker`，不新增任何真实券商执行能力。`JsonFileTradingStore` 保留账户、现金、当前持仓、未完成挂单和序列号，只对已结束订单及审计事件按配置天数滚动清理，并在每次写盘和服务加载时执行清理。

**Tech Stack:** TypeScript、Fastify、Vitest、本地 JSON 单进程存储、AkShare 只读行情桥接。

---

### Task 1: 增加防守型策略并纳入研究排名

**Files:**
- Create: `server/backtest/strategies/KairosDefensiveStrategies.ts`
- Modify: `server/backtest/strategies/index.ts`
- Modify: `server/optimizer/index.ts`
- Modify: `server/research/strategyLeaderboard.ts`
- Test: `server/backtest/strategies.test.ts`
- Test: `server/optimizer/optimizer.test.ts`

- [x] 新增低波趋势、安静回踩和资金盾牌三种确定性策略。
- [x] 将三种策略注册到优化器和策略排行榜。
- [x] 调整排行榜评分和质量门槛，提高最大回撤、Sortino、Sharpe 与盈利因子的权重。
- [x] 用策略单测和优化器单测验证策略工厂可复现且可搜索。

### Task 2: 让纸面计划宁可观望也不强行买入

**Files:**
- Modify: `server/research/paperTradingPlan.ts`

- [x] 计算候选防守分，优先考虑可买一手、波动较低且策略质量较高的标的。
- [x] 对防守分低于 58 的候选输出 `blocked`，并保留明确原因。
- [x] 在可执行计划中写入 `defensive-score: pass` 检查结果。

### Task 3: 持久化每次自动执行结果

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/store/jsonFileTradingStore.ts`
- Test: `server/app.test.ts`

- [x] 无论成交、风控拒绝、没有候选还是非交易时段，都追加 `paper-auto-execution.run` 审计事件。
- [x] 审计内容包含运行 ID、触发方式、交易日、交易时段、计划质量、订单状态和跳过原因。
- [x] 让单独追加的审计事件立即写入 JSON，避免服务退出后丢失“为什么没交易”。

### Task 4: 对 JSON 交易历史执行七天滚动留存

**Files:**
- Modify: `server/config.ts`
- Modify: `server/system.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `.env.example`
- Modify: `server/store/jsonFileTradingStore.ts`
- Test: `server/store/jsonFileTradingStore.test.ts`

- [x] 添加 `TRADING_HISTORY_RETENTION_DAYS`，默认值为 `7`，允许范围为 1 到 365 天。
- [x] 在 JSON 状态加载和写盘时删除超过留存期的已结束订单与审计事件。
- [x] 永久保留账户现金、当前持仓、暂停状态、序列号和所有未完成挂单，避免清理破坏模拟账户状态。
- [x] 验证过期记录会从内存和磁盘删除，最近记录及过期未完成挂单继续保留。

### Task 5: 文档、运行验证与提交

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/plans/2026-07-14-defensive-paper-trading-retention.md`

- [x] 记录七天留存边界、昨天无记录的原因和新的审计检查方式。
- [x] 运行相关服务端测试、完整测试和生产构建。
- [x] 启动 AkShare、Fastify 与 Vite，检查三项健康接口、自动执行状态、审计接口和 JSON 落盘。
- [x] 审查最终差异，提交本次策略、留痕、留存和文档改动。

## 验证命令

```powershell
npm run test:server -- server/backtest/strategies.test.ts server/optimizer/optimizer.test.ts server/store/jsonFileTradingStore.test.ts server/app.test.ts
npm test
npm run build
npm run dev:a-share
npm run check:a-share
Invoke-RestMethod http://127.0.0.1:8787/api/trading/auto-paper-execution/status
Invoke-RestMethod "http://127.0.0.1:8787/api/audit?limit=20"
```

## 安全边界

- 所有自动订单只提交到本地 `PaperBroker`，不得连接同花顺、中信或其他真实券商账户。
- AkShare 只提供只读行情；行情权限与订单执行权限继续分离。
- 一周后的结果只能描述为本地 paper 模拟结果，不得描述为真实收益或收益承诺。

## 已验证结果

```text
2026-07-14

定向服务端测试：5 个文件，178 项通过。
完整测试：25 个服务端文件、557 项服务端测试；2 个前端文件、9 项前端测试，全部通过。
生产构建：TypeScript 与 Vite 通过。
A 股链路：Fastify、AkShare、Vite 代理、指数、股票和 KAIROS 快照全部通过。
运行态：盘前不下单，自动执行跳过原因已持久化到 JSON 审计。
```
