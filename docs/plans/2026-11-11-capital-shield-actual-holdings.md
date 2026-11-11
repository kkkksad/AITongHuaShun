# 资金护城河实际持仓与冷却计划

> **For agentic workers:** 使用 executing-plans 逐项执行；单模块验证、提交、推送、部署。

**Goal:** 修复研究回测策略把信号当成交的状态错误，卖出被拒或T+1锁定时继续依据实际持仓处理，只有观测到实际清仓才进入冷却。

**Architecture:** `KairosCapitalShieldStrategy`绑定单股；从`context.positions`读取数量、均价和可卖整手。发出买卖信号不修改持仓状态。保留受控突破、历史暖机、20%入场现金资格与既有止盈止损/冷却参数；这不是线上Paper统一固定现金预留。冷却以首次观测到从有仓变为无仓的bar为起点，保守解释观测边界，不能从卖出意图推断成交时刻。

**Tech Stack:** TypeScript、Vitest、BacktestEngine、冻结授权边界内的前复权日线研究样本。

## Task 1：反例

**Files:** Create `server/backtest/strategies/KairosCapitalShieldStrategy.positions.test.ts`.

- [x] 构造entryPeriod=3/exitPeriod=2的稳定小幅上涨，按原暖机第五根首次受控突破。整笔额度500元使买单连续拒绝，下一根仍需重新判断买入，不能出现虚拟卖出。
- [x] 实际引擎验证T+1、含佣金资金拒单后恢复、滑点实际均价止盈、卖单额度拒绝后重试；不篡改风控。
- [x] 直接上下文验证已有持仓/其他股票、可卖部分和不足整手、原退出低点与止损、报价换序/缺失不混历史、reset重绑定。
- [x] 冷却必须只由有仓→无仓观测触发，T+1/拒单/部分剩余持仓不能提前清空状态或开始冷却；未满冷却不买，边界后恢复原资格。

Run: `node node_modules/vitest/vitest.mjs run --dir server --environment node server/backtest/strategies/KairosCapitalShieldStrategy.positions.test.ts`，先保存旧版失败证据。

## Task 2：实现

**Files:** Modify `server/backtest/strategies/KairosDefensiveStrategies.ts`，仅修改CapitalShield类。

- [x] 删除虚拟`inPosition/entryPrice`，增加单股绑定与仅供观测冷却的`observedHolding`。
- [x] 在暖机前观测实际持仓转换；仅实际仓位正数时计算`price / position.averagePrice - 1`及原退出低点；数量为`floor(min(quantity, availableQuantity ?? quantity)/100)*100`。
- [x] 退出信号不更新lastExitBar；下次实际空仓才记录冷却。买单只返回原targetWeight，不预设成交。

## Task 3：历史对照与发布

**Files:** Create `docs/decisions/0082-capital-shield-actual-holdings.md`, `docs/research/2026-11-11-capital-shield-execution-semantics.md`; Modify `docs/status/current-state.md`、本轮总计划。

- [x] 使用固定12股×三窗口×双成本72组真实历史，旧新版完整经济报告对照，报告所有变化，不按收益方向选实现。严格使用原历史验证/截止边界，不称盘中胜率。
- [x] 完整后端（两worker）、TS/Vite通过；未改前端/Python沿用模块4的395前端与既有177/36Python结果，不称重跑。
- [ ] 独立提交推送部署，动态核验原账户经济摘要/检查点、归档文件、可信双域HTTPS、匿名401、三健康与上一材料。

## 范围

该类为研究与回测实现。线上Paper逐股资格来自独立适配的候选匹配器，本模块不能称今天不买的已证实原因，也不能称提高实际成交或胜率。

## 验证记录

UTC18:59：20项新增旧版17失败/3兼容，目标47项通过；固定真实72组完整报告68一致/4变化，冷却及实际均价差异全部记录。完整173文件2644服务端及TS/Vite通过。等待独立提交推送部署。
