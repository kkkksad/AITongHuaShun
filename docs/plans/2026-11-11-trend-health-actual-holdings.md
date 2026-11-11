# 趋势健康实际持仓与冷却计划

> **For agentic workers:** 使用 executing-plans 顺序执行，独立验证和发布。

**Goal:** 消除趋势健康回测的虚拟持仓与信号冷却，保持原趋势、量能和止盈止损条件。

**Architecture:** 仅修改KairosTrendHealthStrategy，绑定单股价格/成交量序列，从真实上下文持仓与均价判断，退出使用实际可卖整手。冷却沿用0082的首次有仓→无仓观测边界；缺报价、拒单和T+1不制造成交，原max(slowPeriod+6,65)暖机保持。

**Tech Stack:** TypeScript、Vitest、BacktestEngine、冻结真实历史。

## Task 1：先失败

**Files:** Create `server/backtest/strategies/KairosTrendHealthStrategy.positions.test.ts`.

- [x] fast2/slow3与65根稳定小幅上涨，第65根首次原趋势入场；核对原量比/涨幅过滤及targetWeight。
- [x] 实际引擎验证额度拒单重试、最低佣金拒单后恢复、T+1、卖出额度拒绝、实际滑点均价门槛；直接上下文验证已有/部分/他股仓位、原放量及结构破坏退出。
- [x] 验证有仓→空仓才开始冷却，剩余仓位不冷却；报价缺失/换序不混序列，reset重放一致。

Run: `node node_modules/vitest/vitest.mjs run --dir server --environment node server/backtest/strategies/KairosTrendHealthStrategy.positions.test.ts`，保存旧版失败数。

## Task 2：实现

**Files:** Modify `server/backtest/strategies/KairosRegimeStrategies.ts`（只改TrendHealth类）。

- [x] 用boundSymbol/observedHolding替代inPosition/entryPrice，reset完整清理。暖机前从该股实际持仓观测清仓，首次空仓bar记录lastExitBar。
- [x] 持仓分支使用实际均价，保留原价格止盈止损、高量破坏和结构破坏。退出只返回实际可卖整手quantity，不修改冷却；空仓正常入场只返回原targetWeight。

## Task 3：历史与交付

**Files:** Create `docs/decisions/0084-trend-health-actual-holdings.md`, `docs/research/2026-11-11-trend-health-execution-semantics.md`; Modify状态页、总计划和上一模块回执。

- [x] 按strategyRobustness原固定参数，基线86478a9与候选在12股×三窗×双成本72组完整对照，严格原入口和截止，不按收益方向选用。
- [x] 目标回归、完整后端两worker、TS/Vite通过；无前端/Python改动则沿用最近结果并明确未重跑。
- [x] 独立提交推送部署，核验归档/三健康/可信双域HTTPS/匿名401/原账户与检查点/上一材料。

该研究类与线上独立候选规则不同；完成后再检索同类虚拟持仓缺口，不把预期修复称为已实现，也不保证交易次数或成功率。

## 验证记录

UTC19:15：最终21新增旧版18失败/3兼容，目标107项及完整175文件2683服务端/TS/Vite通过。固定72组完整经济报告45一致/27变化，全部变化在研究文档列明，不择收益。静态检索backtest/strategies未再发现原inPosition/entryPrice/hasPosition字段，但不构成对所有策略缺陷的全证明。等待独立提交部署。

UTC19:19：a32792ecac4c8eeb7c737f7597afd0406b77d098已推送部署，729源码文件逐字节匹配/三健康/双域可信HTTPS/健康200/匿名401/原经济摘要与检查点保持；上一86478a9的725源码/三镜像/私有导出独立匹配，exportVerified与overwriteRefused均true。UTC19:21实际生产API镜像隔离完整175文件2683项通过：禁网、只读公开夹具，无账户或凭据挂载。
