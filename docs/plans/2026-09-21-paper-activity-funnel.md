# Paper 活跃度与交易漏斗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Paper 计划和自动执行链路明确展示候选到成交的每一层数量与阻塞原因，并扩大普通模式的核心历史覆盖。

**Architecture:** 在 `shared/trading.ts` 增加稳定的 `PaperActivityFunnel` 契约，在服务端用纯函数计算计划漏斗和标准阻塞码。Paper 计划生成漏斗的候选、历史和策略阶段；自动执行器在 preflight 和 PaperBroker 返回后回填提交、成交阶段。React 研究管线直接消费计划中的漏斗数据。

**Tech Stack:** TypeScript, React, Fastify, Vitest, TanStack Query, PaperBroker.

**Spec:** `docs/superpowers/specs/2026-09-21-paper-activity-funnel-design.md`

## Global Constraints

- `MARKET_MODE=paper` 且 `REAL_TRADING_ENABLED=false` 是自动 Paper 执行的硬边界。
- A 股 T+1、100 股整手、费用、现金储备、仓位、阶段额度、熔断、幂等和每日订单上限继续有效。
- 漏斗只描述研究和模拟状态，不代表成交保证、胜率或收益。
- 原始规则文本和审计信息不得包含凭据。

---

### Task 1: 添加共享漏斗契约和纯函数

**Files:**
- Modify: `shared/trading.ts`
- Create: `server/trading/paperActivityFunnel.ts`
- Test: `server/trading/paperActivityFunnel.test.ts`

- [x] **Step 1: 写失败测试**

覆盖：阻塞文本被映射到标准分类；没有操作时返回全零漏斗；包含计划/阻塞/提交/成交时各阶段数量准确。

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/trading/paperActivityFunnel.test.ts --environment node`

Expected: FAIL，因为共享类型和计算函数尚不存在。

- [x] **Step 3: 实现最小纯函数**

实现 `classifyPaperActivityBlocker`、`buildPaperActivityFunnel` 和 `withPaperActivityExecutionCounts`。分类只使用设计文档中的有限集合，未识别文本归入 `other`。

- [x] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/trading/paperActivityFunnel.test.ts --environment node`

Expected: PASS。

### Task 2: 将漏斗接入 Paper 计划和历史覆盖

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlanService.test.ts`
- Modify: `server/research/paperTradingPlan.test.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] **Step 1: 写失败测试**

验证 Paper 计划质量摘要包含观察候选、可负担候选、历史覆盖、策略命中、计划订单和标准阻塞码；验证普通模式历史覆盖为 8，活动模式仍为 12。

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/research/paperTradingPlanService.test.ts server/research/paperTradingPlan.test.ts server/research/paperTradingPlan.adaptive.test.ts --environment node`

Expected: 新漏斗断言失败，普通模式仍返回 6。

- [x] **Step 3: 接入计划计算**

在 `buildQualitySummary` 中调用漏斗纯函数，传入候选池、可负担数量、历史覆盖数量、策略命中数量和操作列表；普通历史上限改为 8，活动模式保持 12。

- [x] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/research/paperTradingPlanService.test.ts server/research/paperTradingPlan.test.ts server/research/paperTradingPlan.adaptive.test.ts --environment node`

Expected: PASS。

### Task 3: 接入自动执行快照和 API 类型

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/trading/paperAutoExecutor.test.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`

- [x] **Step 1: 写失败测试**

验证执行快照包含漏斗，计划订单数、提交订单数和成交订单数分别反映实际阶段；自动执行测试验证成交后 `filledOrders` 增加。

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/trading/paperAutoExecutor.test.ts server/app.test.ts --environment node`

Expected: 新漏斗断言失败。

- [x] **Step 3: 回填执行结果**

让 `buildPlanSnapshot` 生成计划漏斗，preflight 和 PaperBroker 提交完成后用实际订单状态回填提交/成交数量；旧审计和测试夹具允许缺少新字段以保持向后兼容。

- [x] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/trading/paperAutoExecutor.test.ts server/app.test.ts --environment node`

Expected: PASS。

### Task 4: 在研究管线展示漏斗并更新长期文档

**Files:**
- Modify: `src/components/LearningPipeline.tsx`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`

- [x] **Step 1: 写前端回归测试**

验证研究管线显示漏斗阶段数量、标准阻塞码和 Paper-only 说明。

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/LearningPipeline.test.tsx --environment jsdom`

Expected: 新文案和数量断言失败。

- [x] **Step 3: 实现紧凑展示**

在现有“纸面计划诊断”区域增加候选、历史、策略、计划、提交、成交六个阶段和主要标准阻塞原因；数据缺失时显示等待，不使用固定演示数值。

- [x] **Step 4: 更新文档事实**

记录漏斗、标准阻塞码和普通历史覆盖 8/活动 12 的当前实现，并明确本阶段没有改变硬风控或生产单笔上限。

- [x] **Step 5: 运行完整验证**

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

Expected: 全部通过，构建成功，无空白或凭据文件变更。

实际结果：`npm test` 通过，服务端 63 个测试文件/894 个测试、前端 32 个测试文件/122 个测试；`npm run build` 通过（Vite 转换 2322 个模块）；`git diff --check` 通过。Windows 工作区没有可用的 Python 解释器，`python -m pytest akshare-bridge -q` 未能启动；生产 CI/部署流程仍会在 Ubuntu 上运行该检查。

### Task 5: 提交变更

**Files:**
- Commit all implementation, tests, spec and plan updates on `codex/project-wide-paper-activity`.

- [x] **Step 1: 检查变更范围**

Run: `git status --short` and `git diff --stat`.

- [ ] **Step 2: 提交**

```bash
git add shared/trading.ts server/trading/paperActivityFunnel.ts server/trading/paperActivityFunnel.test.ts server/research/paperTradingPlan.ts server/research/paperTradingPlanService.ts server/research/paperTradingPlanService.test.ts server/research/paperTradingPlan.test.ts server/research/paperTradingPlan.adaptive.test.ts server/trading/paperAutoExecutor.ts server/trading/paperAutoExecutor.test.ts server/app.test.ts src/lib/tradingApi.ts src/components/LearningPipeline.tsx docs/superpowers/specs/2026-09-21-paper-activity-funnel-design.md docs/plans/2026-09-21-paper-activity-funnel.md docs/product/overview.md docs/safety/trading-boundaries.md docs/status/current-state.md
git commit -m "feat: add paper activity funnel diagnostics"
```

- [ ] **Step 3: 记录验证结果**

在计划末尾补充实际测试数量、构建结果、提交 SHA 和未完成的后续工作。

## 关键决策

- 先增加可观测性，再决定是否进一步放宽候选规则，避免用更多成交掩盖数据或策略问题。
- 普通历史覆盖从 6 提高到 8，活动模式仍受 12 只上限约束，避免一次性放大桥接负载。
- 漏斗契约放在 `shared/`，保证 API 和 React 使用同一字段语义。

## 遗留问题

- 动态 40–80 只候选池、独立探索 Paper 账户和 PostgreSQL 持久化不在本阶段实施。
- 生产环境的 2500 元单笔上限不自动修改，需要基于漏斗数据单独审批风险预算。
