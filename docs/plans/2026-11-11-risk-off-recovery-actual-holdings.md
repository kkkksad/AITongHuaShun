# 风险收缩修复策略实际持仓计划

> **For agentic workers:** 使用 executing-plans 逐项执行后独立提交发布。

**Goal:** 风险收缩修复研究策略按实际仓位和成交均价退出，拒单不创建虚拟状态，保持原中期下跌与短期放量修复条件。

**Architecture:** 只改KairosRiskOffRecoveryStrategy；首只有效股票绑定，缺报价不混入其他历史。actual positions决定是否持仓，卖单使用可卖整手，原均线/量能/涨幅/止盈止损及暖机参数不变。该类不属于17项固定稳健性表，本次另用构造函数原默认参数固定检验，不新增或调优生产策略。

**Tech Stack:** TypeScript/Vitest/BacktestEngine与既有冻结前复权日线。

## Task 1：先复现

**Files:** Create `server/backtest/strategies/KairosRiskOffRecoveryStrategy.positions.test.ts`.

- [x] 固定fast2/slow6/lookback6的下跌再修复序列[11,10.8,10.4,10,9.7,9.5,9.6,9.9]，第八根为原放量修复。验证暖机和原涨幅/量能条件，追加10.0使额度拒单后仍重试。
- [x] 真实引擎覆盖买佣金拒单后恢复、T+1解锁退出、卖额度拒绝后仍持有、实际滑点均价止盈；直接上下文覆盖已有/部分/他股持仓、均线修复失败、换序/缺失和reset。

Run: `node node_modules/vitest/vitest.mjs run --dir server --environment node server/backtest/strategies/KairosRiskOffRecoveryStrategy.positions.test.ts`，旧版缺陷必须先失败。

## Task 2：最小实现

**Files:** Modify `server/backtest/strategies/KairosDefensiveStrategies.ts`（仅RiskOffRecovery类）。

- [x] 删除`inPosition/entryPrice`，reset清除boundSymbol。按绑定股票追加原价格/成交量历史。
- [x] `const position=context.positions.find(p=>p.symbol===quote.symbol)`；正持仓从实际均价计算原收益阈值，原confirmationFailed保持。
- [x] 退出返回实际可卖整手quantity；买单只返回原targetWeight，无信号成交假设。

## Task 3：对照与发布

**Files:** Create `docs/decisions/0083-risk-off-recovery-actual-holdings.md`, `docs/research/2026-11-11-risk-off-recovery-execution-semantics.md`; Modify状态页和总计划。

- [x] 固定原默认8/30/15/.06/.025/1.1/.04/.02/.1，在同12股×三窗×双成本72组对比基线2f5948d与候选。使用原严格历史入口与截止，不能称这是原17策略报告的某一行或当前账户胜率。
- [x] 目标回归、完整服务端两worker、TS/Vite通过；前端/Python无改动沿用最近结果。
- [ ] 提交推送部署并核验归档、三健康、可信双域HTTPS、匿名401、原经济摘要/检查点及上一发布材料。

线上Paper候选匹配独立，不把本回测缺陷解释成今天无买入的已证实根因，不放宽风险路由或开通真实交易。

## 验证记录

UTC19:08：18新增回归旧版15失败/3兼容，目标84项通过；固定原默认72组67经济报告一致/五组实际均价时点变化，全部公开说明。完整174文件2662服务端及TS/Vite通过；前端/Python无改动沿用模块4的395及既有177/36，不称重跑。等待独立提交部署核验。
