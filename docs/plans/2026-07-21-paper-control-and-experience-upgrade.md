# Paper 账户控制与研究体验升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能安全重置本地 paper 账户、选择明确的风险档位、收到包含真实模拟成交明细的完整通知，并获得独立数字资产观察、统一图表和稳定一键启动体验。

**Architecture:** 账户初始资金和策略档位由 `TradingStore` 持久化，Fastify 通过受认证且受 CSRF 保护的账户控制接口修改，重置操作原子清空旧 paper 持仓/订单/审计并重置风控，不接触真实券商。策略档位只约束 paper 计划的现金保留、候选门槛、单轮买入数量和新增仓位缩放；通知复用已成交订单事实，数字资产模块复用现有 BTC/ETH 只读报告，不增加账户或外盘订单能力。

**Tech Stack:** TypeScript, Fastify, React 19, TanStack Query, Recharts, Vitest, PowerShell, AkShare bridge.

---

## 约束

- 账户重置仅允许 `paper`，初始资金限制为 1,000 至 100,000,000 元，并要求用户输入确认短语。
- 重置必须清空当前本地 paper 的持仓、挂单、历史订单和旧审计，再创建一条新账户审计；不得删除研究缓存、日志或认证配置。
- 风险档位不得绕过 T+1、100 股整手、现金、仓位、每日订单上限、熔断或 `REAL_TRADING_ENABLED=false`。
- “进取”表示允许更低现金保留和更高 paper 风险预算，不得描述为保证高收益。
- BTC/ETH 继续保持只读快照和 A 股辅助观察，不增加数字资产下单、账户或收益承诺。

## Task 1：账户生命周期与策略档位契约

**Files:**
- Modify: `shared/trading.ts`
- Modify: `server/contracts/TradingStore.ts`
- Modify: `server/store/inMemoryTradingStore.ts`
- Modify: `server/store/jsonFileTradingStore.ts`
- Modify: `server/broker/paperBroker.ts`
- Test: `server/store/jsonFileTradingStore.test.ts`
- Test: `server/contracts/contracts.test.ts`

- [x] 定义 `PaperStrategyProfile` 四档及账户快照中的初始权益/档位字段。
- [x] 为两种仓储实现 `resetAccount`、`getStrategyProfile`、`setStrategyProfile`，并保证 JSON 原子持久化与旧文件向后兼容。
- [x] 让 `PaperBroker` 重置账户时同步重置 `RiskEngine`，广播新的账户和空持仓。
- [x] 增加重置清空、档位持久化、旧 JSON 默认档位和输入边界测试。

## Task 2：受保护账户控制 API

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/hooks/useTradingBackend.ts`

- [x] 增加 `POST /api/account/reset`，校验初始资金、策略档位和确认短语，仅在 paper 模式执行。
- [x] 增加 `PUT /api/account/strategy-profile`，允许不清空账户地切换后续 paper 计划档位。
- [x] 客户端 mutation 成功后原子替换账户、持仓和订单缓存，并向用户显示明确结果。
- [x] 覆盖非法金额、错误确认、非 paper 拒绝、成功清空和 CSRF 保护测试。

## Task 3：策略档位进入计划与复盘

**Files:**
- Create: `server/trading/paperStrategyProfile.ts`
- Create: `server/trading/paperStrategyProfile.test.ts`
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlan.test.ts`
- Modify: `server/research/dailyMarketReview.ts`
- Modify: `src/components/LearningPipeline.tsx`

- [x] 为现金防守、稳健、均衡、进取定义透明的现金底线、买入分数、单轮新仓数量和仓位缩放。
- [x] 把档位约束与市场状态取更保守值，市场路由禁止买入时任何档位都不能重新放开。
- [x] Paper 计划返回当前档位、约束说明和实际生效参数；复盘展示当前策略、问题与下一步升级建议。
- [x] 用确定性测试证明进取档位仍受硬风控，现金防守档位不新增仓位。

## Task 4：设置页账户工作流

**Files:**
- Modify: `src/components/Settings.tsx`
- Create: `src/components/Settings.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/index.css`

- [x] 移除浏览器本地 API 密钥区和 `kairos_api_keys` 持久化，设置页不再诱导把服务端凭据放进浏览器。
- [x] 增加四档策略选择器，显示当前档位、现金底线、节奏和适用市场。
- [x] 增加初始金额、确认短语和不可逆提示组成的“开始新模拟”工作流；按钮在条件不完整时禁用。
- [x] 重置成功后刷新全局交易状态，移动端不横向溢出，交互测试覆盖切档和重置确认。

## Task 5：通知加入实际操作明细

**Files:**
- Modify: `server/notifications/paperPlanNotifier.ts`
- Modify: `server/notifications/paperPlanNotifier.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`

- [x] `summarizePaperOrders` 返回当日已成交买卖的名称、数量、价格、金额、策略和原因。
- [x] 简报明确区分“已经成交”“本时段计划”“未成交/拒绝”，不把计划动作写成实际交易。
- [x] 四条固定简报均包含档位、当前持仓、已成交操作、计划动作、盘面/新闻/外围、风险和下一节点；列表有界以遵守十条预算。
- [x] 测试覆盖同日买卖、无成交、拒单和 HTML 转义，不泄漏凭据。

## Task 6：币模块、图表与一键启动

**Files:**
- Create: `src/components/CryptoMarketPanel.tsx`
- Create: `src/components/CryptoMarketPanel.test.tsx`
- Modify: `src/components/MarketResearchWorkspace.tsx`
- Modify: `src/components/MarketChart.tsx`
- Modify: `src/components/StockTrendForecastPanel.tsx`
- Modify: `src/components/BacktestResults.tsx`
- Modify: `src/components/StrategyCompare.tsx`
- Modify: `src/styles/index.css`
- Modify: `.vscode/tasks.json`
- Modify: `docs/operations/development.md`

- [x] 新增独立“数字资产”页签，展示 BTC/ETH 真实快照、24 小时区间、涨跌、成交量、来源和对 A 股的受限解释。
- [x] 统一 Recharts 的网格、轴、Tooltip、涨跌颜色、边距和移动端高度；不伪造数字资产历史或大盘分时。
- [x] 修复 VS Code 后台任务对 Vite ANSI 输出的脆弱匹配，使用稳定宽松的 4173 就绪规则，避免 `Timed out waiting for debuggee to spawn`。

## Task 7：验证、运行态复盘与文档

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/2026-07-21-paper-control-and-experience-upgrade.md`

- [x] 运行聚焦测试、完整 Python/Server/Web 测试、`tsc -b`、Vite build 和 `git diff --check`。
- [x] 重启三服务，浏览器验证桌面与 390px：设置重置、四档策略、每日复盘、数字资产、图表和一键启动状态。
- [x] 使用当前真实可用数据复盘当天 paper 操作；没有成交时明确写“无成交”，不得虚构买卖或收益。
- [x] 更新权威文档，记录实现事实、残余数据缺口与不可突破边界。

## 验证结果

- 2026-07-21：服务端 50 个文件、771 项 Vitest，前端 27 个文件、89 项 Vitest，Python 94 项 pytest 全部通过；仅保留一项 FastAPI/httpx 依赖弃用警告。
- `tsc -b` 与 Vite 生产构建通过，构建转换 2,318 个模块；`git diff --check` 通过。
- API 在 AkShare 首批行情到达前保持健康，随后桥接缓存 5,440 只股票和 562 个指数；4173 代理返回 API JSON。
- 1280x720 与 390x844 设置页、市场页和策略图表无页面级横向溢出；回测图表在桌面/手机为非零响应式尺寸，控制台无错误。
- 数字资产源在当前网络不可用时于 5 秒内返回降级报告，不显示静态价格；A 股桥接继续健康。
- 未执行账户重置验证，避免删除用户现有 Paper 记录；重置行为由 API、仓储和设置交互自动化测试覆盖。
- 2026-07-21 盘中复盘确认两笔本地模拟卖出、零买入、零拒绝；逐笔理由来自持久化决策审计。

## 完成标准

- 用户可在设置页选择四档 paper 策略，并以明确确认重置为指定初始金额的纯现金账户。
- 通知逐项列出当日真实模拟成交，并与待执行计划、拒单和空仓观察明确分开。
- 数字资产成为独立只读模块，图表风格统一且不伪造历史。
- VS Code 一键启动稳定识别 Vite 就绪，不再因 ANSI 文本导致调试器等待超时。
- 全量测试、构建、浏览器和运行态复盘通过后再提交。
