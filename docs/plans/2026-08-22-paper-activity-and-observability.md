# Paper 活跃度与执行可观测性升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Paper 自动执行审计无法解释阻塞原因的问题，并在不绕过历史、成本、T+1、现金和风险检查的前提下，让验证档在非 risk-off 市场拥有更多合格候选。

**Architecture:** 保持真实交易关闭和 `PaperBroker` 单一执行边界。为计划构建器显式传递活动模式，在 `validation-probe` 中加入受控的历史覆盖候选兜底路由；所有候选仍须通过实时可交易性、历史样本、流动性、费用、现金、仓位和风险检查。执行器审计记录原始动作、阻塞原因、策略键和活动模式，便于按天复盘。

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, React, Docker Compose, AkShare read-only bridge.

---

### Task 1: 修复执行审计与策略追踪

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/trading/paperAutoExecutor.test.ts`

- [ ] **Step 1: 写失败测试**

验证未知/非执行动作的审计原因包含动作值和原始理由；验证自动执行审计包含 `activityMode`，已提交订单摘要包含 `strategyKey`。

- [ ] **Step 2: 运行聚焦测试确认失败**

Run: `npx vitest run server/trading/paperAutoExecutor.test.ts --environment node`
Expected: 新断言失败。

- [ ] **Step 3: 实现最小修复**

将通用占位原因改为带动作和原始理由的可读文本；在 run 审计中保存活动模式、跳过原因计数和策略键，不读取或输出凭据。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run: `npx vitest run server/trading/paperAutoExecutor.test.ts --environment node`
Expected: PASS。

### Task 2: 增加验证档受控候选兜底

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlan.test.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`

- [ ] **Step 1: 写失败测试**

构造非 risk-off、真实历史至少 120 根、候选评分至少 65、流动性和价格波动受控但没有主策略信号的候选；验证只有 `validation-probe` 生成 `kairosValidationBasket` 的 Paper 买入计划，`observe`/`qualified-probe` 不生成。

- [ ] **Step 2: 运行聚焦测试确认失败**

Run: `npx vitest run server/research/paperTradingPlan.test.ts server/research/paperTradingPlan.adaptive.test.ts --environment node`
Expected: 新断言失败。

- [ ] **Step 3: 实现最小兜底路由**

把活动模式传入计划构建器；仅在 `validation-probe`、非 risk-off、历史覆盖与流动性通过、候选评分和防守分达到门槛、无现有持仓且费用比例合格时生成验证篮子信号。它只改变策略匹配，不改变下单数量、阶段预算、每日上限、现金缓冲、T+1、熔断或幂等检查。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run: `npx vitest run server/research/paperTradingPlan.test.ts server/research/paperTradingPlan.adaptive.test.ts server/trading/paperAutoExecutor.test.ts --environment node`
Expected: PASS。

### Task 3: 补齐策略验证和项目文档

**Files:**
- Modify: `server/research/adaptiveCandidateStrategy.ts`
- Modify: `server/research/adaptiveCandidateStrategy.test.ts`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`

- [ ] **Step 1: 扩展策略矩阵测试**

覆盖趋势、均线、动量、回踩、区间轮动、验证篮子和 risk-off 禁止新增仓位的策略状态，确保策略键可追踪。

- [ ] **Step 2: 更新长期事实**

记录验证档是样本收集模式，不是成交或盈利保证；记录当前线上观察到的主要阻塞原因及策略审计修复。

- [ ] **Step 3: 运行完整检查**

Run: `npm run test:server`
Run: `npm run test:web`
Run: `npm run build`
Run: `python -m pytest akshare-bridge/test_bridge.py akshare-bridge/test_research_cache.py -q`
Run: `git diff --check`

### Task 4: 提交、部署与线上复核

**Files:**
- Modify: `docs/plans/2026-08-22-paper-activity-and-observability.md`

- [ ] **Step 1: 提交并推送**

不得提交 `.env.production`、WxPusher SPT/UID、密码或运行状态文件。

- [ ] **Step 2: 通过受限归档部署**

部署到 `124.221.165.45`，保持 `paper + akshare` 与 `REAL_TRADING_ENABLED=false`；不修改生产凭据。

- [ ] **Step 3: 验收**

确认三个容器 healthy、健康接口 200、匿名保护接口 401、Paper 账户未重置，并检查下一交易日审计是否能显示阻塞原因和策略键。

---

**边界:** 本计划只提高 Paper 验证样本的可获得性和可解释性。A 股 T+1、候选资格、成本模型、现金缓冲、风险状态和每日不超过 10 笔硬上限继续有效。

## Implementation status

- [x] Execution audit records activity mode, action, blocker reason, and strategy key.
- [x] Added `kairosValidationBasket` as a validation-only fallback in `validation-probe`.
- [x] Added regression coverage for strategy routing and Paper plan generation.
- [x] TypeScript check, full server/web tests, focused tests, bridge tests, production build, and git diff check pass. Bridge result: 114 passed with two environment warnings.
- [ ] Git commit, push, production deployment to 124.221.165.45, and online acceptance remain pending. This plan does not claim remote deployment.
