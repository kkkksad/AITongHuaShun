# 全链路 Fetch 可靠性加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除行情桥断开或上游变慢时的重叠请求与重试风暴，让全部研究模块以统一、可读、可恢复的方式降级，不再向界面暴露原始 `fetch failed`。

**Architecture:** Fastify 行情提供者改为单飞轮询并在连续失败时指数退避，成功后恢复正常节奏；AkShare 全市场缓存以刷新完成时间计算 TTL，并在失败后设置有限冷却期。服务端研究域统一通过一个只读桥接客户端处理超时、HTTP 详情、无效 JSON 和网络断开，前端 TanStack Query 消费 `AbortSignal` 取消已经离开的模块请求，同时继续保留上次成功缓存。

**Tech Stack:** TypeScript, Fastify, React 19, TanStack Query, Python, FastAPI, asyncio, Vitest, pytest.

**Status:** 已完成（2026-07-19）

---

## 约束

- 只修复只读行情和研究请求，不改变策略信号、paper 仓位、风险限额或订单行为。
- 行情桥失败时必须保留最后成功快照；没有真实数据时不得使用静态价格补位。
- 退避必须有上限，恢复成功后必须回到配置的正常轮询周期。
- 桥接错误不得包含 Token、完整查询值、Cookie、请求正文或上游响应正文；HTTP `detail` 最多保留 240 字符。
- 取消前端请求只影响已经离开的视图，不得取消 paper 自动执行器或服务端后台采样。

## Task 1：Fastify 行情轮询单飞与退避

**Files:**
- Modify: `server/market/HttpMarketProvider.ts`
- Modify: `server/market/HttpMarketProvider.test.ts`

- [x] 增加失败测试：当一次 fetch 超过 `tickMs` 时，后续定时触发不得创建第二组并发请求。
- [x] 增加失败测试：两路行情都失败时保留旧快照、按 `tickMs * 2^n` 退避且最大不超过 60 秒；任一路恢复后重置失败计数。
- [x] 将 `setInterval` 改为“本轮完成后再 `setTimeout`”的串行调度，`stop()` 同时清理定时器并禁止完成后的再次调度。
- [x] 让个股与指数请求返回结构化结果，由单轮汇总统一记录一次失败；保留部分成功更新，避免两个相同 `fetch failed` 日志。
- [x] 运行 `server/market/HttpMarketProvider.test.ts`，确认并发上限、退避、停止和原有行情契约全部通过。

## Task 2：AkShare 全市场缓存节流

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `.env.example`

- [x] 增加失败测试：模拟抓取耗时大于 TTL，刷新完成后缓存年龄应接近 0，而不是立即过期。
- [x] 增加失败测试：已有旧数据的刷新失败后，冷却期内多次读取不得再次调用上游；仍返回旧数据并保留 `last_error`。
- [x] 为 `QuoteCache` 与 `IndexCache` 使用完成时间写入 `_last_update`，并增加最长 60 秒的失败退避截止时间。
- [x] 把默认 `AKSHARE_BRIDGE_CACHE_TTL` 从 3 秒调整为 10 秒并写入 `.env.example`，使全市场 16–22 秒抓取不会连续占满网络。
- [x] 运行桥接聚焦 pytest，验证股票和指数缓存行为。

## Task 3：统一研究桥接请求

**Files:**
- Create: `server/research/bridgeRequest.ts`
- Create: `server/research/bridgeRequest.test.ts`
- Modify: `server/research/crossMarketStrategyContext.ts`
- Modify: `server/research/externalMarketImpact.ts`
- Modify: `server/research/hongKongMarketResearch.ts`
- Modify: `server/research/ipoSubscriptionResearch.ts`
- Modify: `server/research/marketRegimeResearch.ts`
- Modify: `server/research/realResearchData.ts`
- Modify: `server/research/stockTrendForecast.ts`
- Modify: `server/research/strategyRobustness.ts`
- Modify: `server/research/turningPointScanner.ts`
- Modify: `server/research/externalMarketFeatureCapture.ts`

- [x] 先写桥接客户端测试，覆盖成功 JSON、HTTP `detail` 截断、超时、连接失败、无效 JSON、Token 头和定时器清理。
- [x] 实现 `fetchBridgeJson<T>()` 和 `bridgeErrorMessage()`：只输出“行情桥连接失败 / 超时 / HTTP 状态 / 响应格式错误”等稳定中文语义。
- [x] 删除各研究模块复制的 `fetchJson`，全部改用共享客户端；保留每个模块现有的 `degraded`、部分数据和 warning 契约。
- [x] 新股与外盘特征采样也使用共享客户端，确保没有漏掉直接 `fetch` 的只读桥接路径。
- [x] 更新现有研究单测断言，确认网络失败返回降级报告而不是 Fastify 500，且任何 warning 都不含原始 `fetch failed`。

## Task 4：前端取消过期研究请求

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/lib/researchQueries.ts`
- Modify: `src/lib/researchQueries.test.ts`
- Modify: `src/components/DailyQualityStocks.tsx`
- Modify: `src/components/ExternalMarketImpactPanel.tsx`
- Modify: `src/components/FlowPanel.tsx`
- Modify: `src/components/FuturesMarketPanel.tsx`
- Modify: `src/components/HongKongMarketPanel.tsx`
- Modify: `src/components/IpoSubscriptionPanel.tsx`
- Modify: `src/components/MarketRegimePanel.tsx`
- Modify: `src/components/NewsPanel.tsx`
- Modify: `src/components/StockTrendForecastPanel.tsx`
- Modify: `src/components/StrategyRobustnessPanel.tsx`
- Modify: `src/components/TurningPointPanel.tsx`

- [x] 为全部 GET 研究客户端增加可选 `AbortSignal`，并通过测试确认信号传给 `fetch`。
- [x] 统一 Query Options 和各独立组件使用 `queryFn: ({ signal }) => ...`，用户切换模块后取消无用浏览器请求。
- [x] 保留 `ResearchQueryState` 的缓存降级语义：首次失败显示模块不可用，刷新失败继续显示上次成功数据。
- [x] 运行前端聚焦测试，确认参数边界、查询键和取消能力不回归。

## Task 5：集成验证与文档收口

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/2026-07-19-fetch-reliability-hardening.md`

- [x] 运行完整 Python、服务端和前端测试，以及 `tsc -b`、Vite 生产构建和 `git diff --check`。
- [x] 重启更新后的行情桥与 Fastify，依次打开 A 股、变盘、板块、港股、期货、全球和新闻模块。
- [x] 检查系统监控和运行日志：行情轮询无重叠，桥失败不重复刷屏，研究 warning 无原始 `fetch failed`，页面保留缓存降级状态。
- [x] 记录实际测试数量、模块耗时和残余上游缺口；不得把上游真实缺失描述为已取得数据。
- [x] 使用中文提交代码与文档；除非用户另行要求，不推送远程。

## 验证结果

- Python：103 tests passed；1 条 FastAPI/httpx 依赖弃用警告。
- Server Vitest：48 files / 758 tests passed；Web Vitest：25 files / 83 tests passed。
- `tsc -b` 通过；Vite 生产构建 4.40 秒完成，转换 2,316 个模块。
- 新进程启动时故意让 Fastify 先于桥接恢复，日志只出现 10/20/40 秒三轮退避，没有原始 `fetch failed`；桥接恢复后行情质量为 100/100。
- 浏览器首次/缓存加载耗时：A 股 20.4 秒、变盘 12.2 秒、板块 2.1 秒、港股 58.9 秒、期货 4.1 秒、全球 4.1 秒、新闻 6.1 秒；均完成加载且无原始错误。
- 全球模块仍按真实结果降级：10 个全球指数取得 9 个、恒生历史暂缺，2 个数字资产取得 1 个。该缺口保留为 warning，未用静态数据补位。

## 完成标准

- 行情桥不可用 15 秒时，Fastify 最多存在一轮行情轮询，且下一轮按退避执行。
- 全市场抓取完成后至少经过 TTL 才再次刷新，失败后不会每 5 秒重打上游。
- 所有服务端研究模块使用同一桥接请求实现，返回可读降级信息而不是 `fetch failed` 或无边界响应正文。
- 页面切走后对应 TanStack Query 能取消客户端请求，已有数据刷新失败时继续显示缓存。
- 全量测试、构建、桌面浏览器和运行日志验证通过后再提交。
