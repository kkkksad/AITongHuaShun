# 每日 Paper 复盘与累计资金预留实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动 paper 交易在创建订单前累计预留现金和手续费，逐笔保留买卖理由，并提供可复核的每日盘面与交易复盘。

**Architecture:** `paperTradingPlan` 在同一批计划内维护剩余可用现金，`PaperAutoExecutor` 在提交前使用最新报价再次检查现金并记录逐笔决策审计。新的 `dailyMarketReview` 聚合当前收盘快照、账户、持仓、订单和审计，在 Fastify 提供只读 API，并由研究管线页面展示。

**Tech Stack:** TypeScript、Fastify、React、TanStack Query、Vitest、本地 JSON paper 状态。

---

### Task 1: 修复同批买单重复使用原始现金

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Test: `server/research/paperTradingPlan.test.ts`

- [x] 构造 1265 元现金、包钢股份 400 股和中国银行 100 股的回归场景。
- [x] 验证旧逻辑会生成两笔总现金需求超过 1265 元的计划。
- [x] 为计划输入加入佣金率、最低佣金和现金缓冲比例。
- [x] 按“成交额 + 预计手续费”逐笔扣减 `remainingPlannedCash`。
- [x] 当剩余现金不足时输出 `blocked`，理由明确为累计计划资金不足，不生成可执行买单。

### Task 2: 下单前二次检查并持久化交易理由

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`

- [x] 自动买入前按最新报价、滑点、佣金和现金缓冲再次计算所需现金。
- [x] 资金不足时写入 `skippedOperations`，不得调用 `PaperBroker.submitOrder`，因此不会创建 rejected 订单。
- [x] 每笔提交写入 `paper-auto-execution.decision` 审计，包含策略、理由、规则检查、预计金额、订单状态和拒绝原因。
- [x] 自动执行响应中的订单增加 `strategy`、`reason` 和 `ruleChecks`，便于前端直接解释。

### Task 3: 新增每日盘面与交易复盘 API

**Files:**
- Create: `server/research/dailyMarketReview.ts`
- Create: `server/research/dailyMarketReview.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] 从可交易股票计算上涨、下跌、平盘、平均涨跌幅和涨跌比。
- [x] 从不可交易展示报价提取上证、深证、创业板和沪深 300 指数表现。
- [x] 汇总当日成交、拒绝、手续费、资金使用率、持仓盈亏和逐笔交易理由。
- [x] 对旧订单缺少决策理由的情况明确标注“历史版本未持久化”，不得事后虚构理由。
- [x] 根据资金不足、开盘集中建仓和现金使用率生成策略问题与下一步改进建议。
- [x] 暴露只读接口 `GET /api/research/daily-review`。

### Task 4: 在研究管线显示每日复盘

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Modify: `src/styles/index.css`

- [x] 新增 `DailyMarketReview` 前端契约和 `fetchDailyMarketReview()`。
- [x] 展示交易日、盘面状态、涨跌家数、账户权益、资金使用率和当日 paper 盈亏。
- [x] 逐笔显示标的、状态、数量、价格、策略和买卖理由。
- [x] 展示策略优点、问题和下一交易日改进项；明确结果仅为本地 paper 复盘。
- [x] 页面刷新按钮同时刷新每日复盘。

### Task 5: 文档与验证

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/plans/2026-07-14-daily-paper-review-and-cash-reservation.md`

- [x] 记录 2026-07-14 资金不足订单的根因、修复边界和今日客观复盘。
- [x] 运行定向测试、完整测试和生产构建。
- [x] 启动三服务并验证复盘接口、页面和自动执行状态。

## 已验证结果

```text
定向测试：4 个文件，103 项通过。
完整测试：27 个服务端文件、561 项服务端测试；2 个前端文件、9 项前端测试，全部通过。
生产构建：TypeScript 与 Vite 通过。
运行态：每日复盘返回 2026-07-14 的 5 笔成交、1 笔历史资金不足拒绝和逐仓结果；修复后当前现金 412 元时买入计划为 0。
页面：桌面与 390px 移动端无横向溢出，复盘内容正常加载。
```

## 验证命令

```powershell
npm run test:server -- server/research/paperTradingPlan.test.ts server/research/dailyMarketReview.test.ts server/app.test.ts
npm test
npm run build
npm run dev:a-share
Invoke-RestMethod http://127.0.0.1:8787/api/research/daily-review
```

## 安全边界

- 所有订单和收益均为本地 paper 模拟，不连接真实券商或同花顺账户。
- 复盘只能使用当前快照、持久化订单和审计中确实存在的数据；缺失的历史理由必须明确标注缺失。
- 盘面与策略评价用于改进研究流程，不构成收益承诺或真实投资建议。
