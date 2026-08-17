# 合格 Paper 活跃度与策略轮换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不绕过真实历史、行情质量、费用、现金、仓位、T+1、熔断和 paper-only 边界的前提下，修复高波震荡长期零成交，并让合格策略按近期成交使用情况轮换。

**Architecture:** 保留现有自适应市场路由，在震荡市场增加有明确历史和快照条件的区间轮动策略。自动执行器只在下午仍未达到每日 Paper 成交目标时激活“合格样本验证”候选；候选仍经过计划层和 PaperBroker 的全部检查。计划服务从审计记录汇总近期已成交策略，候选在接近最高分的合格信号中优先选择较少使用的策略。

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, PaperBroker, AkShare read-only bridge, Docker Compose.

---

### Task 1: 固化生产零成交根因

**Files:**
- Modify: `docs/status/current-state.md`
- Test: `server/research/adaptiveCandidateStrategy.test.ts`

- [x] **Step 1: 记录生产证据**

记录 2026-08-10 至 2026-08-17 的持久化 Paper 状态：账户 100000 元现金、0 持仓、0 订单；822 轮自动执行中，高波震荡路由有 5 至 6 个可负担候选，但候选策略没有形成可执行动作。

- [x] **Step 2: 写高波震荡失败测试**

```ts
expect(rankAdaptiveCandidateStrategies({
  quote: rangeQuote,
  stockRegime: healthyRangeStock,
  routing: highVolatilityRangeRouting,
  candidateScore: 78,
}).map((signal) => signal.strategyKey)).toContain("kairosRangeRotation");
```

- [x] **Step 3: 运行测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run server/research/adaptiveCandidateStrategy.test.ts --environment node`

Expected: FAIL，因为 `kairosRangeRotation` 尚不存在。

### Task 2: 增加区间轮动与合格样本验证

**Files:**
- Modify: `server/research/adaptiveStrategyRouter.ts`
- Modify: `server/research/adaptiveCandidateStrategy.ts`
- Modify: `server/research/paperTradingPlan.ts`
- Test: `server/research/adaptiveStrategyRouter.test.ts`
- Test: `server/research/adaptiveCandidateStrategy.test.ts`
- Test: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] **Step 1: 添加策略路由键**

把 `kairosRangeRotation` 加入低波和高波震荡路由，把 `kairosQualifiedProbe` 加入所有允许新增仓位的路由；`risk-off` 和 `unclear` 继续只允许资金防守。

- [x] **Step 2: 实现真实历史准入规则**

```ts
const rangeRotationEligible = isRangeRegime(routing) &&
  stock.barCount >= 120 &&
  stock.confidence >= 0.55 &&
  stock.regime !== "trend-deterioration" &&
  candidateScore >= 65 &&
  hasControlledLiquidity(quote);
```

`kairosQualifiedProbe` 只在执行器显式传入 `activityTargetActive=true` 时产生，并沿用健康趋势、已验证洗盘或受控区间结构的隔夜持续性检查。

- [x] **Step 3: 验证普通模式不产生探针**

Run: `node node_modules/vitest/vitest.mjs run server/research/adaptiveCandidateStrategy.test.ts server/research/paperTradingPlan.adaptive.test.ts --environment node`

Expected: PASS；普通模式仍不为完成目标强行生成订单。

### Task 3: 下午活跃目标补足和策略轮换

**Files:**
- Modify: `server/config.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `.env.example`
- Modify: `docker-compose.production.yml`
- Test: `server/config.test.ts`
- Test: `server/research/paperTradingPlanService.test.ts`
- Test: `server/research/paperTradingPlan.adaptive.test.ts`
- Test: `server/trading/paperAutoExecutor.test.ts`

- [x] **Step 1: 添加显式生产开关**

`PAPER_AUTO_EXECUTION_ACTIVITY_MODE=qualified-probe` 仅对本地 PaperBroker 生效；默认值保持 `observe`，生产 Compose 明确启用。

- [x] **Step 2: 限定激活窗口**

```ts
const active = mode === "qualified-probe" &&
  remainingTargetOrders > 0 &&
  (phase === "afternoon-confirmation" || phase === "closing-risk-review");
```

上午继续等待普通策略，下午目标未达时才允许合格样本验证。每日上限 4、每轮上限 1 和目标 2 保持不变。

- [x] **Step 3: 汇总近期已成交策略并轮换**

从 `paper-auto-execution.decision` 审计中读取最近 7 天 `filled` 订单的策略键。只在分数距最高信号不超过 10 分的候选中，优先使用近期成交次数较少的策略，避免为了多样性选择明显更弱的信号。

- [x] **Step 4: 保留具体阻塞原因**

自动执行审计对 `blocked` 操作写入计划原始 `reason`，并记录 `strategyKey`，不再统一显示 `operation is not an executable paper auto action`。

### Task 4: 完整验证与生产部署

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`

- [x] **Step 1: 运行聚焦测试**

Run: `node node_modules/vitest/vitest.mjs run server/config.test.ts server/research/adaptiveStrategyRouter.test.ts server/research/adaptiveCandidateStrategy.test.ts server/research/paperTradingPlan.adaptive.test.ts server/research/paperTradingPlanService.test.ts server/trading/paperAutoExecutor.test.ts --environment node`

Expected: PASS.

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Run: `npm run build`

Run: `python -m pytest akshare-bridge/test_bridge.py akshare-bridge/test_research_cache.py -q`

Run: `git diff --check`

Expected: 全部通过。

- [x] **Step 3: 提交、推送和部署**

提交业务代码和文档，推送 `codex/hourly-project-optimization`，通过受限 `deploy-upload <full-sha>` 部署生产归档。

- [x] **Step 4: 生产验收**

确认三个容器健康、`MARKET_MODE=paper`、`REAL_TRADING_ENABLED=false`、活跃模式为 `qualified-probe`，账户历史未重置。下一交易日检查成交目标、策略键、具体阻塞原因和 WxPusher 汇总。

验收结果：提交 `df9d8b78e744dad600673518a8c5635be73816b3` 已部署，三个容器均为 healthy，健康接口返回 200，匿名受保护接口返回 401；生产模式、订单限额、活动模式和 WxPusher 配置存在性符合预期，持久化账户仍为 100,000 元现金、0 持仓、0 订单。部署发生在收盘后，下一交易时段继续观察实际成交与阻塞审计，不把目标解释为成交保证。

---

**边界:** “每天至少有交易”在本项目中表示：交易日下午若普通策略未达标，系统主动尝试最低费用有效整手的合格 Paper 样本；数据不可用、市场禁止开仓、现金/费用不足、T+1、熔断或日上限触发时仍允许零成交，不承诺收益或真实交易结果。
