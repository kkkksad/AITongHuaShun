# Paper 验证档交易频次实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加显式 Paper 验证档，在 A 股交易日 10:15 后争取 6 笔合格模拟成交，并以每日 10 笔、单轮 1 笔作为硬上限，为短期策略验证收集更多可审计样本。

**Architecture:** 保留现有 `PaperBroker`、真实历史准入、费用、现金、仓位、T+1、熔断和幂等检查。新增 `validation-probe` 活跃模式，只把合格样本窗口从下午提前到上午确认阶段，并在激活时把个股历史研究覆盖从 6 只提高到现有受控上限 12 只；生产配置使用目标 6、日上限 10，普通本地默认仍保持 `observe`。

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, React, Docker Compose, AkShare read-only bridge.

---

### Task 1: 验证档配置与交易窗口

**Files:**
- Modify: `server/config.ts`
- Modify: `server/config.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/trading/paperAutoExecutor.test.ts`
- Modify: `server/test/testConfig.ts`

- [x] **Step 1: 写验证档失败测试**

```ts
expect(parse({
  PAPER_AUTO_EXECUTION_ACTIVITY_MODE: "validation-probe",
  PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS: "6",
  PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: "10",
}).PAPER_AUTO_EXECUTION_ACTIVITY_MODE).toBe("validation-probe");

expect(shouldActivateQualifiedPaperProbe({
  mode: "validation-probe",
  phase: "morning-confirmation",
  remainingTargetOrders: 6,
})).toBe(true);
```

- [x] **Step 2: 运行聚焦测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/config.test.ts server/trading/paperAutoExecutor.test.ts --environment node`

Expected: FAIL，因为 `validation-probe` 尚未进入配置枚举和激活窗口。

- [x] **Step 3: 实现最小配置与窗口逻辑**

将活动模式扩展为 `observe | qualified-probe | validation-probe`。`qualified-probe` 仍只在下午和尾盘激活；`validation-probe` 在上午确认、下午确认和尾盘激活；两者都要求剩余目标大于 0，开盘阶段和盘外保持关闭。

- [x] **Step 4: 运行聚焦测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run server/config.test.ts server/trading/paperAutoExecutor.test.ts --environment node`

Expected: PASS.

### Task 2: 扩展合格历史样本覆盖

**Files:**
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlanService.test.ts`

- [x] **Step 1: 写激活时覆盖 12 只的失败测试**

```ts
expect(resolveCriticalHistoryStockLimit(false)).toBe(6);
expect(resolveCriticalHistoryStockLimit(true)).toBe(12);
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/research/paperTradingPlanService.test.ts --environment node`

Expected: FAIL，如果当前夹具或服务仍只覆盖 6 只。

- [x] **Step 3: 实现受控覆盖扩展**

`buildCurrentPaperTradingPlan` 在 `activityTargetActive=true` 时把 `preferredHistoricalStocks` 和 `stockLimit` 设置为 12，否则保持 6。不得提高公开接口现有 12 只上限，也不得跳过历史降级检查。

- [x] **Step 4: 运行服务测试确认通过**

Run: `node node_modules/vitest/vitest.mjs run server/research/paperTradingPlanService.test.ts server/research/paperTradingPlan.adaptive.test.ts --environment node`

Expected: PASS.

### Task 3: 生产限额与界面语义

**Files:**
- Modify: `docker-compose.production.yml`
- Modify: `deploy/production.env.example`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/dailyTaskCenter.ts`
- Modify: `src/lib/dailyTaskCenter.test.ts`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`

- [x] **Step 1: 更新生产非敏感默认值**

生产 Compose 使用 `PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS=6`、`PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS=10`、`PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN=1` 和 `PAPER_AUTO_EXECUTION_ACTIVITY_MODE=validation-probe`。开发 `.env.example` 继续保持安全默认 `2/4/observe`。

- [x] **Step 2: 更新任务中心测试和展示**

验证档激活时显示“验证档样本补足”，正文明确只从通过真实历史、费用和风控的候选中取样，不显示“保证成交”或“保证盈利”。

- [x] **Step 3: 更新产品、安全与状态文档**

记录 6 笔是短期 Paper 验证目标、10 笔是硬上限、单轮仍为 1；T+1 导致当天买入不能当天卖出，候选不足或风控失败时允许低于目标。

### Task 4: 完整验证、提交和生产验收

**Files:**
- Modify: `docs/plans/2026-08-17-paper-validation-frequency.md`

- [x] **Step 1: 运行完整验证**

Run: `npm run test:server`

Run: `npm run test:web`

Run: `npm run build`

Run: `python -m pytest akshare-bridge/test_bridge.py akshare-bridge/test_research_cache.py -q`

Run: `git diff --check`

Expected: 全部通过。

- [ ] **Step 2: 提交并推送**

提交验证档代码、测试和文档，推送 `codex/hourly-project-optimization`。不得提交 `.env.production`、WxPusher SPT/UID、密码或运行状态文件。

- [ ] **Step 3: 部署并更新生产非敏感配置**

通过受限 `deploy-upload <full-sha>` 部署。随后只把服务器 `.env.production` 中的活动模式、目标和日上限更新为 `validation-probe/6/10`，强制重建 backend；不得读取、输出或修改其他凭据。

- [ ] **Step 4: 生产验收**

确认三容器 healthy、健康接口 200、受保护接口匿名 401、`MARKET_MODE=paper`、`REAL_TRADING_ENABLED=false`、目标 6、日上限 10、单轮 1、验证档生效、WxPusher 已配置且账户历史未重置。下一交易日检查实际成交、策略键和具体阻塞原因。

---

**边界:** 该功能提高的是本地 Paper 样本尝试频次，不是最低成交保证、真实下单授权或收益承诺。任何交易日都可以因 `risk-off`、历史降级、候选不足、费用、现金、仓位、T+1、熔断、阶段预算或幂等检查而少于 6 笔。
