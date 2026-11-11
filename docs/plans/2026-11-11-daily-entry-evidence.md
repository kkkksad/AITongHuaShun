# 每日复盘入场证据分类计划

> **For agentic workers:** 使用 executing-plans 在当前分支逐项执行，验证后独立提交和发布。

**Goal:** 已有 blocked 计划不再被解释为没有评估；按最新有效盘中记录说明资格、金额和后续准入，不从现金余额推断可买。

**Architecture:** 复盘只读既有审计。新增 plan-blocked 状态与前端类型同步；仅使用当前有效运行自身的合法漏斗，旧/坏/缺失字段保留未知。已有成交、明确现金拒单、运行缺口、数据降级和风险路由优先级保持；不修改任何策略许可、订单或账本。

**Tech Stack:** TypeScript、Vitest、React现有通用复盘展示。

## Task 1：反例

**Files:** Create `server/research/dailyMarketReview.entryEvidence.test.ts`; Modify `server/research/dailyMarketReview.test.ts`.

- [x] 使用真实审计结构 `data.strategyCoverage.newPositionFunnel` 构造三组 blocked：新标的资格为0、资格1但独立金额0、金额1但拟买0。旧版均为 not-evaluated，应先失败。
- [x] 覆盖全局关闭、旧记录无漏斗、坏计数、未来审计、盘后not-run、正常watch-only、已买入/现金拒单优先级；不能把有资格但金额不足称作“无信号”。
- [x] 风险路由即使余额仅1元也只能说记录显示风控关闭，不能说“不是资金不足”；修正旧断言的事实边界。

Run: `node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/dailyMarketReview.entryEvidence.test.ts server/research/dailyMarketReview.test.ts`。

## Task 2：最小实现

**Files:** Modify `server/research/dailyMarketReview.ts`, `src/lib/tradingApi.ts`; Create `server/research/dailyEntryFunnelEvidence.ts`.

- [x] 仅从同一最新运行中严格验证scope、布尔、有限非负整数、前12上限及关系。返回固定白名单文字，不转发未知属性或拼接原始来源错误。
- [x] `if (planQuality === "blocked")` 返回 `status: "plan-blocked"`，说明“最新有效盘中计划已评估但被阻塞”；原因先合法漏斗再已有跳过证据，无漏斗时明确细节不足。
- [x] 对watch-only同样可补合法漏斗但保留原status；风险路由文字仅陈述证据，不推断资金充足。实际现金拒单仍独立标记cashWasConstraint。

## Task 3：验证与交付

**Files:** Create `docs/decisions/0081-daily-entry-review-evidence.md`; Modify `docs/product/overview.md`, `docs/status/current-state.md`, 本轮主计划。

- [x] 目标复盘/时间截止/账本回归、完整服务端（两worker）、前端全套、TypeScript、Vite依次通过；同一时刻仅一个Vitest。
- [x] 记录模块3的已验收部署回执，状态页纠正已发布模块的旧“待发布”措辞。
- [ ] 先提交推送再部署，核验归档SHA/三健康/可信双域HTTPS/匿名401/原账户经济摘要与检查点/上一发布材料；如远端网络未恢复，明确分开本地、服务器、GitHub状态。

## 边界

最新一次运行不能代替全日统计。漏斗只能解释资格和计划金额阶段，不能把独立可成整手当作累计资金、费用、风险或实际成交许可；不反推旧审计中已经丢失的单股金额原因。不调整成功率或交易次数目标。

## 验证记录

UTC18:51：新增24项旧版23失败，目标79项通过；完整172文件2624后端、58文件395前端及TS/Vite通过。首次前端默认并发出现导航超时与后续状态连带失败，两worker完整复跑通过，未改超时或断言。四状态×390/479/1440共12组隔离Chrome断言与截图通过，390金额受限状态人工核验可读无横溢。夹具不是生产收益数据。Python无改动。等待独立提交部署核验。

