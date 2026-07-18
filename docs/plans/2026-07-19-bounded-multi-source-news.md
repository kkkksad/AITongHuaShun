# 有界多源真实新闻升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前单标的、前端仅显示 5 条的新闻链路升级为有界、多源、可去重和可分页的真实新闻观察模块，同时保持只读、内存缓存和 paper-only 边界。

**Architecture:** AkShare 桥接聚合财新市场新闻、央视宏观新闻和最多 8 只受控 A 股的东方财富个股新闻，按标题/链接去重并在内存缓存 15 分钟。Fastify 优先覆盖当前持仓，再从真实行情按成交额选择观察标的，前端按分类过滤和每页 10 条展示；新闻不会直接修改策略路由或生成订单。

**Tech Stack:** Python 3, FastAPI, AkShare, pandas, TypeScript, Fastify, React, TanStack Query, Vitest, Pytest.

**状态：** 已完成，等待用户明确提交。

---

## 约束

- 不抓取或保存新闻全文到磁盘；只在响应中保留最多 240 字摘要、标题、链接、来源和时间。
- 单次最多请求 8 只 A 股、最多返回 80 条；跨标的抓取最多 4 个工作线程。
- 任一来源失败时保留其他真实来源并返回警告，不使用静态模拟新闻补位。
- 标题与链接去重使用稳定哈希，进程重启后同一条新闻 ID 不漂移。
- 新闻情绪仍是透明关键词标签，不是校准概率，也不得直接触发 paper 或真实订单。

## Task 1：桥接多源抓取、去重与缓存

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] 增加最多 8 个 `symbols` 查询参数及默认宽基观察池，拒绝未知格式和超量请求。
- [x] 分别抓取 `stock_news_main_cx()`、最近可用交易日的 `news_cctv()` 和每个受控标的的 `stock_news_em(symbol=...)`；部分失败写入 warnings。
- [x] 归一化 `macro / market / company` 分类，提取代码、来源、发布时间、摘要和链接，并按规范标题/URL 去重。
- [x] 使用 SHA-256 截断生成稳定 ID，按分类轮转保留来源多样性，最多返回 80 条。
- [x] 仅缓存非空 `NewsResponse`，缓存键包含有序标的与 limit；不落盘正文。
- [x] 运行 `D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q -k news`。

## Task 2：Fastify 选择相关标的并保留覆盖元数据

**Files:**
- Modify: `server/research/realResearchData.ts`
- Create: `server/research/realResearchData.test.ts`
- Modify: `server/research/paperTradingPlanService.ts`

- [x] 当前持仓代码优先，再按实时成交额和成交量补足最多 8 只 A 股。
- [x] 请求桥接 `/api/research/news?limit=80&symbols=...`，解析来源覆盖、原始数量和去重数量。
- [x] 对旧桥接或异常响应做二次规范化、去重和发布时间排序；持仓相关新闻排在普通新闻之前。
- [x] 保持 `buildRealResearchDataFeed` 只读，不把新闻情绪接入 `AdaptiveStrategyRouter` 或订单域。
- [x] 运行 `node node_modules/vitest/vitest.mjs run server/research/realResearchData.test.ts server/app.test.ts --environment node`。

## Task 3：前端分类、分页和原文链接

**Files:**
- Modify: `src/components/NewsPanel.tsx`
- Modify: `src/components/NewsPanel.test.tsx`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/styles/index.css`

- [x] 移除固定 `slice(0, 5)`，增加全部/宏观/市场/个股分类和每页 10 条分页。
- [x] 显示总条数、来源数、覆盖标的数、去重数量和最近更新时间。
- [x] 原文链接使用带 `rel="noreferrer"` 的外链图标按钮；无 URL 时不渲染伪链接。
- [x] 已有成功结果刷新失败时继续保留旧数据和统一查询状态。
- [x] 验证 1440 x 900 与 390 x 844 无页面级横向溢出。
- [x] 运行 `node node_modules/vitest/vitest.mjs run src/components/NewsPanel.test.tsx src/lib/tradingApi.test.ts --environment jsdom`。

## Task 4：文档、全量验证和真实来源检查

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/plans/README.md`

- [x] 记录多源新闻当前能力、数量上限、内存缓存、来源降级和非交易边界。
- [x] 运行 `D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q`。
- [x] 运行服务端与前端全量 Vitest、TypeScript 和 Vite 生产构建。
- [x] 重启桥接与 Fastify，记录真实新闻总数、分类、来源覆盖、标的覆盖和警告。
- [x] 浏览器验证桌面/390px 分类切换、分页、原文链接、缓存刷新状态和控制台。
- [x] 运行 `git diff --check`；按用户习惯等待明确提交指令。

## 验证结果

- Python 桥接全量测试：89 项通过，1 项依赖弃用警告。
- 服务端 Vitest：46 个文件、736 项测试通过；前端 Vitest：21 个文件、66 项测试通过。
- TypeScript 检查和 Vite 生产构建通过；构建转换 2,314 个模块，`NewsPanel` 分包为 5.47 KiB。
- 桥接对 8 只标的返回 80 条：原始 193 条、可用 180 条、去重 13 条，覆盖个股 34 条、市场 33 条、宏观 13 条、16 个来源，无新闻源警告。
- Fastify 动态选择 `300308,300502,688256,688008,300750,000725,688981,000938`，返回 80 条：原始 193 条、可用 181 条、去重 12 条，覆盖 13 个来源，无新闻源警告。整体 `sourceStatus=degraded` 仅因全球指数取得 9/10，不是新闻链路失败。
- 已登录浏览器验证通过：桌面页面宽度 1265/1265；390px 视口页面宽度 375/375，新闻面板 353/353、筛选和覆盖统计均为 324/324。宏观分类 13 条，第一页 10 条、第二页 3 条，原文链接可用，控制台无警告或错误。
- `git diff --check` 通过，仅有现有换行符转换提示；变更保留在未提交区，等待用户明确提交。

## 完成标准

- 当前新闻不再来自 `stock_news_em()` 的默认单只股票。
- 正常情况下返回数量明显高于 20 条并覆盖宏观、市场和多只 A 股；源失败时如实降级。
- 重复标题或同链接不会重复展示，ID 在进程重启后稳定。
- 前端每页只渲染 10 条，用户可按分类浏览全部有界结果。
- 不新增磁盘正文、无限缓存、额外微信消息或任何订单能力。
