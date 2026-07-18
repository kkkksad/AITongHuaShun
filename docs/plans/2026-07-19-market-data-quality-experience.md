# 行情数据质量与市场页可信度升级实施计划

**状态：已完成（2026-07-19）。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正行情质量评分中的覆盖率、新鲜度和涨跌停误报问题，并在 A 股概览中提供清晰、轻量、可刷新的数据质量状态，彻底取消真实指数缺失时的静态数值补位。

**Architecture:** `server/market/dataQuality.ts` 继续作为唯一质量计算入口，但使用请求标的覆盖率、整批报价低分位新鲜度和合法涨跌停排除规则生成扩展契约；Fastify 保持只读 `/api/market/quality` 并提供短时私有缓存语义。React 只在后端连接时轮询该轻量接口，通过独立状态条展示可用性、覆盖率、陈旧和异常数量；指数快照无真实数据时显示空状态，不再回退静态数值。

**Tech Stack:** TypeScript, Fastify, React 19, TanStack Query, Vitest, React DOM server rendering, CSS.

---

## 约束

- 数据质量只是行情可用性诊断，不是策略评分、涨跌预测或订单许可。
- 不新增外部抓取、不扩大本地缓存、不把质量状态直接接入 paper 或真实订单。
- 接口保持向后兼容，只增加字段并修正错误语义。
- A 股概览使用全宽状态带，不把面板嵌套进图表卡片。

## Task 1：修正行情质量算法与共享契约

**Files:**
- Modify: `shared/trading.ts`
- Modify: `server/market/dataQuality.ts`
- Modify: `server/market/dataQuality.test.ts`

- [x] 增加失败测试：非法时间戳新鲜度为 0，整批新鲜度使用低分位而不是最大值，缺失请求标的降低完整度。
- [x] 增加失败测试：创业板 20% 和北交所 30% 合法涨跌停不得标记 `adjustment_gap`。
- [x] 在 `DataQualityScore` 增加 `staleCount`，在 `DataQualityReport` 增加 `requestedSymbols`、`validSymbols` 和 `qualityState`。
- [x] 实现有限值校验、10% 低分位新鲜度、请求股票池覆盖率和 `healthy / degraded / unusable` 诊断状态。
- [x] 让 `detectFlags` 与 `computeDataQuality` 共用同一个 `nowMs`，避免单次报告内部时间漂移。
- [x] 运行 `node node_modules/vitest/vitest.mjs run server/market/dataQuality.test.ts --environment node`，预期全部通过。

## Task 2：完善只读质量接口与浏览器客户端

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`

- [x] 增加接口测试，确认 `/api/market/quality` 返回扩展覆盖字段且设置 `Cache-Control: private, max-age=5, stale-while-revalidate=15`。
- [x] 将 `computeDataQuality` 改为静态导入，路由只读取当前内存快照，不触发新的外部抓取。
- [x] 新增 `fetchMarketDataQuality(signal?)`，把 TanStack Query 的取消信号传给 `fetch`。
- [x] 增加客户端测试，确认请求路径、Cookie 会话和 `AbortSignal` 均正确传递。
- [x] 运行 `node node_modules/vitest/vitest.mjs run server/app.test.ts src/lib/tradingApi.test.ts --environment node`，预期全部通过。

## Task 3：新增 A 股数据质量状态带并移除静态指数补位

**Files:**
- Create: `src/components/MarketDataQualityStrip.tsx`
- Create: `src/components/MarketDataQualityStrip.test.tsx`
- Create: `src/components/MarketOverview.test.tsx`
- Modify: `src/components/MarketAshareOverviewPanel.tsx`
- Modify: `src/components/MarketResearchWorkspace.tsx`
- Modify: `src/components/MarketOverview.tsx`
- Modify: `src/styles/index.css`

- [x] 先写组件测试：健康、降级、接口失败保留缓存、刷新按钮和离线状态均可区分。
- [x] 质量状态带只在后端连接时请求，每 30 秒刷新、20 秒内复用缓存；展示综合分、新鲜度、请求覆盖和陈旧/异常数量。
- [x] 把 `connectionState` 传入 A 股概览，断线时停止轮询并显示后端离线状态。
- [x] 主要指数缺失时渲染明确空状态，不导入或展示 `mockData.ts` 的静态指数。
- [x] 增加桌面四列、移动两列和窄屏单列样式，保证按钮、状态和长代码不溢出。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/components/MarketDataQualityStrip.test.tsx src/components/MarketOverview.test.tsx --environment jsdom`，预期全部通过。

## Task 4：验证、浏览器检查与文档收口

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/plans/README.md`

- [x] 记录质量状态只读边界、评分语义、接口缓存和静态指数不补位原则。
- [x] 运行 `npm test` 与 `npm run build`。
- [x] 在已登录浏览器验证 A 股概览桌面与 390px 视口，无页面级横向溢出，质量状态和空/降级语义一致。
- [x] 运行 `git diff --check` 和凭据扫描。
- [x] 将本计划标记为完成，使用中文提交本轮代码与文档；不自动推送。

## 验证结果

- 服务端 Vitest：46 个文件、740 项测试通过。
- 前端 Vitest：23 个文件、74 项测试通过。
- TypeScript 项目检查和 Vite 生产构建通过，转换 2,315 个模块。
- 已登录真实运行环境为 `paper + akshare`；质量报告为 100/100、覆盖 100%、关键问题 0。
- 桌面页面宽度 1265/1265，390px 视口页面宽度 375/375；质量状态带宽度 355px，无文字重叠和控制台错误。
- `git diff --check` 通过，仅有 Git 的行尾转换提示；凭据扫描未发现本轮新增秘密。

## 遗留问题

- 当前质量报告只观察最新内存快照，尚未保存历史质量趋势或供应商字段级对账结果。
- 交易所节假日、停复牌主数据和除权除息事件仍需接入授权、可追溯的数据集。

## 完成标准

- 缺失请求标的会降低完整度，一个新报价不能掩盖一批陈旧报价。
- 合法创业板、科创板和北交所涨跌停不再被误报为复权缺口。
- A 股概览能直接看见当前行情来源、质量、覆盖、陈旧和异常摘要。
- 主要指数缺失时不展示静态数值冒充当前快照。
- 质量诊断不新增外部请求、不改变策略路由、不触发订单。
