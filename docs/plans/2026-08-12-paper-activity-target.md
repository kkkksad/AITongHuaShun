# Paper 活跃度目标优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不绕过真实历史、费用、现金、仓位、T+1、熔断和 paper-only 边界的前提下，让系统每天主动争取少量高证据质量的模拟交易，并准确解释没有成交的原因。

**Architecture:** 为自动执行器增加“目标订单数”与可观测达成状态，但目标不是强制下单条件。优化历史研究请求的并发与重复调用，优先让同一轮计划使用完成的真实历史；候选排序继续以策略资格、历史验证、风险分和可负担性为序。生产持久化账户不自动重置，已有状态与环境初始资金不一致时通过诊断明确显示。

**Tech Stack:** Fastify, TypeScript, Zod, Vitest, Python FastAPI, AkShare bridge, Docker Compose。

---

### Task 1: 明确自动执行目标与生产诊断

**Files:**
- Modify: `server/config.ts`
- Modify: `server/app.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `.env.example`
- Test: `server/config.test.ts`, `server/trading/paperAutoExecutor.test.ts`, `server/app.test.ts`

- [x] **Step 1: 写失败测试**：验证目标订单数默认 2、目标不超过每日上限，并验证状态能区分已达成、未达成和数据阻断。
- [x] **Step 2: 运行测试确认失败**：运行 `node node_modules/vitest/vitest.mjs run server/config.test.ts server/trading/paperAutoExecutor.test.ts server/app.test.ts --environment node`，确认缺少配置/状态字段的失败。
- [x] **Step 3: 实现最小变更**：增加 `PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS`，默认 2；状态返回目标数、目标状态、当日已成交订单数、剩余数和当前阻断原因；目标只影响诊断，不改变任何安全检查。
- [x] **Step 4: 运行聚焦测试**：相关 159 项测试通过。

### Task 2: 降低历史研究冷启动阻塞

**Files:**
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/marketRegimeResearch.ts`
- Modify: `server/research/bridgeRequest.ts`
- Test: `server/research/paperTradingPlanService.test.ts`, `server/research/marketRegimeResearch.test.ts`, `server/research/bridgeRequest.test.ts`

- [x] **Step 1: 核对现有请求复用**：确认 `bridgeRequest` 已按完整 URL 提供有界 single-flight 与短 TTL，完整 Paper 计划因账户和持仓会变化而不能缓存。
- [x] **Step 2: 写关键池边界测试**：验证核心个股历史池限制为 6，只保留持仓和高优先级候选。
- [x] **Step 3: 实现最小变更**：先完成 6 个行业与 6 只股票的核心研究，再启动新闻和全球市场辅助研究；不使用静态历史，不提升降级状态。
- [x] **Step 4: 运行聚焦测试**：相关测试通过。

### Task 3: 以证据质量为先优化候选活跃度

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Test: `server/research/paperTradingPlan.adaptive.test.ts`, `server/trading/paperAutoExecutor.test.ts`

- [x] **Step 1: 核对候选排序**：确认现有计划依次按可负担性、策略资格、策略分、风险分、扫描优先级和价格做确定性排序。
- [x] **Step 2: 验证降级边界**：历史或路由不可用时仍返回观察/阻塞，不生成强制买单。
- [x] **Step 3: 保持既有门槛**：未降低最小历史长度、验证样本、费用比例或风险门槛；目标缺口只进入状态诊断。
- [x] **Step 4: 运行聚焦测试**：相关测试通过。

### Task 4: 生产配置、文档与回归验证

**Files:**
- Modify: `docker-compose.production.yml`
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`

- [x] **Step 1: 更新生产配置**：目标为 2、每日上限保持 4、每轮最多 1，保留 `paper` 和 `REAL_TRADING_ENABLED=false`。
- [x] **Step 2: 运行完整验证**：Server 831、Web 105、Python 101 项测试通过；TypeScript、Vite 构建、`git diff --check` 和凭据扫描通过。
- [ ] **Step 3: 提交并部署**：提交、推送，使用受限归档入口部署，确认三容器健康。
- [ ] **Step 4: 生产验收**：检查自动执行状态、目标状态、历史队列、登录态计划与订单；没有合格候选时验证系统返回明确阻断而非伪造成交。

---

**安全结论：** “每天至少”只作为 paper 研究目标和监控指标，不能成为跳过风控的强制成交命令；真实交易仍关闭。
