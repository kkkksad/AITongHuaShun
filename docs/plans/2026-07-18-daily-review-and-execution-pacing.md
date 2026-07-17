# 休市复盘与自动执行节奏升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让周末复盘自动指向最近交易日，提供可解释的复盘日盯市收益，并防止开盘数分钟内耗尽全天自动订单额度和重复写入无变化审计。

**Architecture:** `dailyMarketReview` 负责交易日选择与账户盯市收益重建，Fastify 继续提供受认证的只读报告，React 只展示后端明确给出的日期和收益口径。`intradayExecutionPolicy` 提供分阶段累计订单预算，`PaperAutoExecutor` 执行预算并只在状态变化、真实提交、人工/启动触发或 15 分钟心跳时持久化运行审计；所有订单仍只进入本地 `PaperBroker`。

**Tech Stack:** TypeScript, Fastify, React, TanStack Query, Vitest, JSON paper store.

---

## 硬边界

- 周末回退只解决周六和周日；未接交易所日历前不得声称自动识别法定休市日。
- 复盘日收益由当前现金、当前持仓、复盘日成交、昨收和手续费重建；缺少昨收时必须返回不可用原因，不能回退成累计收益冒充当日收益。
- 开盘预算只限制普通自动操作；`回撤控制` 硬止损可绕过阶段预算，但仍受全天总订单上限、T+1、现金、仓位、幂等和风险引擎约束。
- 审计合并只压缩相同 timer 运行；订单决策、提交、拒绝、manual、startup、状态变化和定时心跳必须保留。

## Task 1：休市日期与复盘日收益测试

**Files:**
- Modify: `server/research/dailyMarketReview.test.ts`
- Modify: `server/research/dailyMarketReview.ts`

- [ ] 增加周六 `2026-07-18` 自动回退到周五 `2026-07-17` 的测试，并确认周五订单进入报告。
- [ ] 增加盯市收益测试：从当前现金反推开盘现金，从当前持仓和当日买卖反推开盘持仓，以昨收计算开盘权益。
- [ ] 缺少开盘持仓昨收时断言 `performanceBasis="unavailable"` 和缺失代码，不使用累计收益替代。

目标契约：

```ts
account: {
  dailyPnl: number | null;
  dailyPnlPercent: number | null;
  cumulativePnl: number;
  cumulativePnlPercent: number;
  performanceBasis: "mark-to-market" | "unavailable";
  missingPreviousCloseSymbols: string[];
}
dateBasis: "current-weekday" | "weekend-previous-weekday";
```

## Task 2：分阶段订单预算与审计合并测试

**Files:**
- Modify: `server/trading/intradayExecutionPolicy.test.ts`
- Modify: `server/trading/intradayExecutionPolicy.ts`
- Modify: `server/trading/paperAutoExecutor.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`

- [ ] 断言全天上限 4 笔时，开盘/上午/下午/尾盘累计预算分别为 2/3/4/4。
- [ ] 断言同签名 timer 运行在 15 分钟内不重复落盘，状态变化、心跳、订单提交、manual 和 startup 必须落盘。
- [ ] 在预检中应用阶段累计预算，并允许 `回撤控制` 仅绕过阶段预算。
- [ ] 状态接口返回当前阶段累计上限和剩余额度。

核心规则：

```ts
const phaseLimit = getPhaseCumulativeOrderLimit(maxDailyOrders, policy.phase);
if (!isHardStop && todaySubmitted >= phaseLimit) {
  skip("阶段自动订单额度已用完，保留额度给后续确认阶段");
}
```

## Task 3：API 与前端复盘口径

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`

- [ ] Fastify 将 `PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS` 传给复盘构建器。
- [ ] API 契约测试覆盖日期依据、复盘日收益口径和累计收益字段。
- [ ] 前端在周末显示“最近交易日复盘”，无订单文案引用报告日期。
- [ ] 前端把复盘日收益和累计 paper 收益分开显示，不再把累计收益标成“当日”。

## Task 4：文档与验证

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/plans/2026-07-18-daily-review-and-execution-pacing.md`

- [ ] 记录 2026-07-18 为周六无交易，最近交易日 2026-07-17 有 4 笔卖出且 09:35 前用完额度。
- [ ] 记录当前账户现金、持仓、复盘日/累计收益口径和 15 分钟审计心跳边界。
- [ ] 运行聚焦 Vitest、`npm test`、`npm run build`、`git diff --check` 和凭据扫描。
- [ ] 在认证桌面和 390 x 844 页面核验复盘日期、收益标签、无溢出和控制台。

标准命令：

```powershell
npx vitest run server/research/dailyMarketReview.test.ts server/trading/intradayExecutionPolicy.test.ts server/trading/paperAutoExecutor.test.ts server/app.test.ts --environment node
npm test
npm run build
git diff --check
```
