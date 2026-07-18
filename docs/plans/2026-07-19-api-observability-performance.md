# API 可观测性与加载性能升级实施计划

**状态：已完成（2026-07-19）。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立有界、无凭据的 API 滚动性能诊断，消除相同研究请求的前端重复缓存键，并把账户中的系统监控页升级为能定位慢接口、失败接口和行情质量问题的操作台。

**Architecture:** 新增应用实例级 `RequestTelemetry`，只按 Fastify 路由模板保存最近的有限耗时样本和状态聚合，不记录 URL 查询值、请求体、Cookie、Token 或响应正文；受保护的 `/api/system/performance` 将遥测与当前内存行情质量、运行模式和 WebSocket 状态组合成只读快照。React 使用统一 Query Options 复用策略榜、候选、Paper 计划和复盘缓存，系统监控页通过 TanStack Query 轮询轻量诊断接口并提供响应式路由性能表。

**Tech Stack:** TypeScript, Fastify, React 19, TanStack Query, Vitest, React DOM server rendering, CSS.

---

## 约束

- 遥测只保存在当前 Fastify 进程内，默认最多 64 条路由、每路由 128 个耗时样本；服务重启后清空。
- 只使用路由模板、HTTP 方法、状态码、耗时和时间，不记录请求体、响应正文、查询参数值、IP、用户名、Cookie、CSRF、Token 或券商资料。
- `4xx` 参数错误不等同于后端故障；失败率只统计 `429` 和 `5xx`，慢请求阈值独立统计。
- 性能状态只用于运维诊断，不得修改策略路由、Paper 仓位、风险限额或订单。
- 诊断接口不触发 AkShare 或其他外部请求，只读取内存遥测、当前行情快照和本地运行状态。

## Task 1：有界请求遥测与共享契约

**Files:**
- Create: `shared/systemMonitoring.ts`
- Create: `server/monitoring/requestTelemetry.ts`
- Create: `server/monitoring/requestTelemetry.test.ts`

- [x] 定义 `ApiPerformanceSnapshot`、`RoutePerformanceSnapshot`、运行时和行情质量摘要契约，状态限定为 `idle / healthy / degraded / critical`。
- [x] 先写失败测试，验证百分位、失败率、慢请求、路由排序、空闲状态、最大路由数和每路由样本上限。
- [x] 实现 `RequestTelemetry`：路由模板归一化，最多 64 条路由、每路由 128 个样本，超过上限淘汰最久未更新路由。
- [x] 将 `429` 和 `5xx` 计为失败；以 1,500ms 为慢请求阈值，5,000ms 或稳定高失败率进入 `critical`。
- [x] 运行 `node node_modules/vitest/vitest.mjs run server/monitoring/requestTelemetry.test.ts --environment node`，8 项测试通过。

## Task 2：Fastify 诊断接口与请求生命周期

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] 增加失败接口测试：`GET /api/system/performance` 返回无请求值的 `idle` 快照、受保护会话语义和 OpenAPI 路径。
- [x] 增加流量测试：请求一个业务端点后，性能快照按路由模板显示请求数、状态码、P95 和零凭据字段。
- [x] 在 `buildTradingApp` 内创建独立遥测实例，通过 `WeakMap` 保存单次请求起点；忽略 `OPTIONS`、健康检查、指标端点和性能端点自身。
- [x] 在既有 `onResponse` 中同时保留 Prometheus 累计指标和有界滚动遥测，避免第二套请求生命周期钩子。
- [x] 新增受保护 `/api/system/performance`，组合当前模式、行情源、WebSocket 数、行情质量和遥测快照；保持 `no-store` 且不发起外部请求。
- [x] 运行 `node node_modules/vitest/vitest.mjs run server/app.test.ts server/monitoring/requestTelemetry.test.ts --environment node`，55 项测试通过。

## Task 3：统一前端研究查询并消除重复请求

**Files:**
- Create: `src/lib/researchQueries.ts`
- Create: `src/lib/researchQueries.test.ts`
- Modify: `src/components/StrategyLeaderboard.tsx`
- Modify: `src/components/DailyCandidates.tsx`
- Modify: `src/components/DailyTaskCenter.tsx`
- Modify: `src/components/LearningPipeline.tsx`

- [x] 先写失败测试，确认相同参数的策略榜和候选扫描始终生成完全相同 Query Key，Paper 计划与每日复盘使用统一刷新周期。
- [x] 使用 TanStack `queryOptions` 建立四个工厂：策略榜、候选、Paper 计划、每日复盘；参数必须进入 Query Key，刷新与 stale 策略只定义一次。
- [x] 将四个组件改为复用工厂，移除 `"pipeline"` 这类仅按展示位置区分的缓存键。
- [x] 保留组件手动刷新能力；同一页面树中的相同参数请求由 TanStack Query 合并，跨页面在 stale 窗口内直接复用。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/lib/researchQueries.test.ts --environment jsdom`，4 项测试通过且 TypeScript 检查通过。

## Task 4：系统监控页升级

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/components/SystemMonitor.tsx`
- Create: `src/components/SystemMonitor.test.tsx`
- Modify: `src/styles/trading-strategies.css`

- [x] 新增 `fetchApiPerformance(signal?)` 客户端测试，确认 Cookie 会话和取消信号传递。
- [x] 将 `SystemMonitor` 从手写 `useEffect + setInterval` 改为 TanStack Query，15 秒轮询、10 秒 stale、支持刷新失败时保留缓存和手动刷新。
- [x] 重做监控页：固定四项总览显示 API 状态、P95、失败率和业务请求数；运行条显示行情源、行情质量、覆盖、WebSocket 和在途请求。
- [x] 增加慢接口表，按后端排序展示方法、路由、请求数、平均/P95、失败和最近状态；无业务样本时显示明确空状态。
- [x] 增加最多三条后端生成的操作建议，不显示请求正文或敏感值。
- [x] 增加桌面四列、平板两列、手机单列和表格内部滚动样式；保证页面级无横向溢出。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/components/SystemMonitor.test.tsx src/lib/tradingApi.test.ts --environment jsdom`，16 项测试通过且 TypeScript 检查通过。

## Task 5：验证、浏览器检查与文档收口

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/2026-07-19-api-observability-performance.md`

- [x] 运行完整服务端、前端测试、`tsc -b` 和 Vite 生产构建。
- [x] 启动更新后的 Fastify 与前端，在已登录桌面和 390px 视口打开“模拟账户 > 运维 > 系统监控”。
- [x] 验证诊断接口不包含 Cookie、Token、密码、查询参数值或请求/响应正文；运行凭据扫描和 `git diff --check`。
- [x] 记录实际测试数量、构建模块数、页面几何、接口状态和已消除的重复 Query Key。
- [x] 将计划标为已完成并移入计划索引的已完成区，使用中文提交代码与文档；不自动推送。

## 验证结果

- 服务端 Vitest：47 个文件、750 项测试通过。
- 前端 Vitest：25 个文件、82 项测试通过。
- TypeScript 项目检查与 Vite 生产构建通过，转换 2,316 个模块。
- 桌面页面宽度 1265/1265，四列摘要各 231.7px；390px 视口页面宽度 375/375，监控区 354.7px，路由表在 355px 容器内滚动到 760px。
- 已登录 `paper + akshare` 运行环境显示 API 与行情质量健康；认证、健康和监控端点未进入业务路由样本，手动刷新正常，全新标签控制台无警告或错误。
- 策略榜与候选扫描不再包含 `pipeline` 专用 Query Key；相同参数复用同一 TanStack Query 缓存。

## 遗留问题

- 当前百分位仅代表单个 Fastify 进程启动后的有限窗口，不是跨实例或长期生产容量报告。
- Python 桥接内部抓取、缓存等待和供应商响应耗时尚未拆分到同一诊断链路。
- Prometheus 当前仍是累计耗时 Counter，后续应升级为 Histogram 并与本地滚动 P95 对账。

## 完成标准

- 系统监控页能在一个页面判断后端是否慢、哪条业务路由最慢、是否有服务端失败以及行情质量是否可读。
- 遥测内存严格有界，按路由模板聚合，不保存敏感值，也不增加磁盘缓存。
- 策略榜与候选扫描不再因页面位置不同产生重复 Query Key；Paper 计划和每日复盘刷新策略只有一个权威定义。
- 诊断状态不触发外部抓取、不进入策略或订单域。
- 完整测试、构建、桌面和手机浏览器验证通过后再提交。
