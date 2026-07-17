# KAIROS Quant 系统优化实施计划

**状态：** 进行中；Task 1 已于 2026-07-16 完成，Task 2 为下一阶段。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用可量化的性能预算、清晰代码边界和时间安全的样本外验证，把 KAIROS Quant 从功能型原型升级为加载更快、研究可复现、策略可晋级和可回滚的 paper 研究系统。

**Architecture:** 前端按路由和研究页签按需加载，Fastify 将路由、契约和研究编排拆成独立域，AkShare 桥提供单标的有界缓存、请求合并和后台刷新。策略研究统一进入版本化数据集、purged walk-forward、成本压力测试、概率校准、shadow 观察和人工晋级流程；只读研究继续与订单执行隔离。

**Tech Stack:** React 19, TypeScript, Vite, TanStack Query, Fastify, Zod, Python, FastAPI, AkShare, Vitest, Pytest.

---

## 当前基线

核对时间：2026-07-16。

| 维度 | 当前值 | 第一目标 |
| --- | ---: | ---: |
| Recharts 构建块 | 433.50 KiB raw | 只在图表真正出现时请求 |
| 市场页构建块 | 38.91 KiB raw | 六个研究页签拆成独立异步块 |
| 应用主块 | 192.93 KiB raw | 不因新增研究模块持续增长 |
| 全局 CSS | 6,685 行 / 112.48 KiB raw | 按页面拆分，保持视觉不回归 |
| `src/lib/tradingApi.ts` | 1,468 行 | 拆为认证、市场、研究、交易四个客户端域 |
| `server/app.ts` | 1,408 行 | 路由注册与领域编排分离 |
| 港股 10 只历史冷启动 | 约 63.5 秒 | 快照先显示；历史后台完成；缓存命中低于 500 ms |
| 测试基线 | Python 66；server 665；web 20 | 每阶段不得回退 |

## 统一成效指标

- **加载：** 登录后首屏不加载未访问页面；市场页不加载未激活研究页签；缓存命中接口 P95 小于 500 ms。
- **代码：** 新增领域逻辑不继续堆入 `server/app.ts`、`tradingApi.ts` 或全局 CSS；跨域依赖通过类型契约连接。
- **策略：** 不再用策略数量或单段最高收益定义进步；主指标为样本外最大回撤、Sortino、盈利因子、成本后收益、换手和最差窗口。
- **概率：** 同时报告样本数、Wilson/Beta 区间、Brier score 和校准误差；启发式规则分永远不命名为概率。
- **执行：** 新策略和新参数只能依次经过离线验证、shadow、本地 paper 和人工晋级，不能自动扩大权限。

## Task 1：市场研究页签按需加载

**Files:**
- Create: `src/components/MarketAshareOverviewPanel.tsx`
- Create: `src/components/MarketEventsPanel.tsx`
- Modify: `src/components/MarketResearchWorkspace.tsx`
- Modify: `src/components/MarketChart.tsx`
- Modify: `docs/status/current-state.md`

- [x] 把六个页签内容改为 `React.lazy` 动态导入，`MarketOverview` 和页签导航保持同步首屏。
- [x] 为每个页签提供稳定高度的局部加载状态，加载时不改变页签和指数区域尺寸。
- [x] 鼠标悬停、键盘聚焦或触屏按下页签时预取对应模块，降低用户点击后的等待。
- [x] 修复 `MarketChart` 已计算 `chartData` 却仍把静态 `intradayData` 传给 Recharts 的绑定错误。
- [x] 运行 `npm run build`，记录拆分前后的 `MarketPage`、研究页签和 `charts` 构建块。
- [x] 用认证页面验证 A 股概览、变盘雷达、港股观察的加载状态、键盘切换、桌面与 390 x 844 页面。

Task 1 实际结果：

- `MarketPage` raw 构建块从 `38.91 KiB` 降到 `3.82 KiB`，减少约 90%。
- 六个研究内容拆为独立异步块：A 股概览 `2.70 KiB`、港股 `5.17 KiB`、变盘 `6.01 KiB`、事件 `6.42 KiB`、板块 `7.08 KiB`、个股研判 `11.01 KiB`。
- Recharts 构建块仍为 `433.50 KiB`，但不再属于市场页同步壳，只在 A 股图表模块渲染时请求。
- 新增 2 个真实指数图表纯函数测试；Python `66`、server `665`、web `22` 全通过，生产构建通过。
- 认证页面捕获到稳定局部加载状态；真实图表横轴为昨收、今开、最低、最新、最高且存在两条非空折线。
- 1280px 与 390 x 844 验收无页面级横向溢出；键盘切换、港股按需模块和控制台检查通过。

## Task 2：研究请求缓存与冷启动

**Files:**
- Create: `akshare-bridge/research_cache.py`
- Create: `akshare-bridge/test_research_cache.py`
- Modify: `akshare-bridge/main.py`
- Create: `server/research/researchReportCache.ts`
- Create: `server/research/researchReportCache.test.ts`
- Modify: `server/research/hongKongMarketResearch.ts`
- Modify: `server/research/turningPointScanner.ts`

- [ ] 将桥接缓存从“完整参数字符串”升级为按市场、代码、复权和交易日窗口存储的单序列缓存，使不同批次能复用同一标的历史。
- [ ] 为相同在途请求建立 single-flight 合并；同一代码冷启动期间只允许一个上游请求。
- [ ] 缓存保留 `freshUntil` 和 `staleUntil`；fresh 直接返回，stale 立即返回旧结果并后台刷新，超出 stale 才阻塞等待。
- [ ] 港股页面先返回真实快照和 `historyStatus=loading`，完整历史报告通过独立查询更新，避免 10 只历史阻塞整个模块。
- [ ] 缓存键必须包含来源、复权、截止交易日和窗口，不允许把旧交易日结果伪装成当前数据。
- [ ] 增加缓存命中、single-flight、后台刷新、上游失败保留旧结果和过期淘汰测试。
- [ ] 记录冷启动与缓存命中耗时；验收目标为真实快照先显示、缓存命中 P95 小于 500 ms。

建议缓存契约：

```python
@dataclass(frozen=True)
class HistoryCacheKey:
    market: Literal["a-share", "hong-kong"]
    symbol: str
    adjustment: str
    end_date: str
    days: int

@dataclass
class CacheEntry:
    value: HistoricalSeries
    fetched_at: float
    fresh_until: float
    stale_until: float
```

## Task 3：Fastify、客户端与 CSS 领域拆分

**Files:**
- Create: `server/routes/authRoutes.ts`
- Create: `server/routes/marketRoutes.ts`
- Create: `server/routes/researchRoutes.ts`
- Create: `server/routes/tradingRoutes.ts`
- Modify: `server/app.ts`
- Create: `src/lib/api/authApi.ts`
- Create: `src/lib/api/marketApi.ts`
- Create: `src/lib/api/researchApi.ts`
- Create: `src/lib/api/tradingApi.ts`
- Modify: `src/lib/tradingApi.ts`
- Create: `src/styles/market-research.css`
- Modify: `src/styles/index.css`

- [ ] 先提取 route registration，不改变 URL、认证、CSRF、Zod 校验和返回契约。
- [ ] 每个路由模块只接收显式依赖，不从全局变量重新创建 broker、market 或 store。
- [ ] 前端客户端按领域拆分，保留一个兼容导出层，组件迁移期间不进行全仓机械改名。
- [ ] 将市场研究样式从 `index.css` 移入页面样式文件，Vite 只在市场路由加载该 CSS。
- [ ] 增加路由契约和客户端 URL 编码回归测试，再运行 `npm test` 与 `npm run build`。

Fastify 路由依赖使用明确接口：

```ts
export interface ResearchRouteDependencies {
  config: AppConfig;
  market: MarketDataProvider;
  broker: PaperBroker;
  researchState: ResearchLearningState;
}

export async function registerResearchRoutes(
  app: FastifyInstance,
  dependencies: ResearchRouteDependencies,
): Promise<void>;
```

## Task 4：真实历史策略验证内核

**Files:**
- Create: `server/research/datasets/researchDataset.ts`
- Create: `server/research/datasets/researchDataset.test.ts`
- Create: `server/research/validation/purgedWalkForward.ts`
- Create: `server/research/validation/purgedWalkForward.test.ts`
- Create: `server/research/validation/probabilityCalibration.ts`
- Create: `server/research/validation/probabilityCalibration.test.ts`
- Modify: `server/research/turningPointScanner.ts`
- Modify: `server/research/hongKongMarketResearch.ts`
- Modify: `server/research/marketRegimeResearch.ts`

- [ ] 为每次研究绑定数据集版本、来源、复权、截止时间、代码提交、参数和成本模型。
- [ ] 使用当时可见的股票池和行业成分，禁止只用今天仍上市或今天最活跃的标的回测过去。
- [ ] 对 5 日、10 日重叠标签使用 purged walk-forward，并在训练与验证之间设置至少一个标签窗口的 embargo。
- [ ] 实现 Wilson 区间、Brier score、expected calibration error 和最少有效独立样本。
- [ ] 对佣金、最低佣金、印花税、过户费、滑点、T+1、整手、涨跌停和无法成交进行成本压力测试。
- [ ] 分趋势、震荡、risk-off 和数据降级状态报告结果，不再只给全样本平均值。
- [ ] 当前变盘和港股概率只有在独立折校准通过后才升级为 `calibratedProbability`；否则继续标为 `historicalFrequency`。

核心折叠类型：

```ts
export interface PurgedFold {
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  embargoTradingDays: number;
}
```

## Task 5：策略组合、shadow 与晋级回滚

**Files:**
- Create: `server/research/strategyRegistry.ts`
- Create: `server/research/strategyPromotion.ts`
- Create: `server/research/strategyPromotion.test.ts`
- Create: `server/portfolio/portfolioAllocator.ts`
- Create: `server/portfolio/portfolioAllocator.test.ts`
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/trading/paperAutoExecutor.ts`

- [ ] 策略注册表声明适用状态、禁用状态、最少样本、最大风险预算和基线。
- [ ] 同一策略族只保留少量低相关代表，冲突信号按市场状态、校准质量和组合风险消解。
- [ ] 新候选先进入 shadow，只记录本来会产生的订单意图，不提交本地 paper。
- [ ] 晋级要求连续多个样本外窗口和 paper 周期优于基线，且最大回撤、换手和最差窗口不恶化。
- [ ] 连续退化触发自动降权或回滚到上一稳定参数；系统不得自动放宽风控阈值挽救策略。
- [ ] 组合分配限制单票、单行业、策略族、相关因子和 T+1 隔夜风险。

晋级状态只允许以下流转：

```ts
export type StrategyStage =
  | "research"
  | "shadow"
  | "paper-candidate"
  | "paper-active"
  | "suspended"
  | "rolled-back";
```

## Task 6：性能与策略质量门禁

**Files:**
- Create: `scripts/check-build-budget.mjs`
- Create: `server/monitoring/researchMetrics.ts`
- Create: `server/monitoring/researchMetrics.test.ts`
- Modify: `package.json`
- Modify: `docs/status/current-state.md`

- [ ] 构建脚本检查主块、市场页、图表块和 CSS 的 raw/gzip 预算，超过预算时 CI 失败。
- [ ] Prometheus 增加研究接口耗时、缓存命中、上游失败、样本不足、校准误差和策略晋级/回滚指标。
- [ ] 每次策略版本记录数据版本、提交、参数、成本、样本外指标和审批人。
- [ ] 每阶段运行 Python、server、web、build、diff 和凭据检查，并把实际结果写回状态页。

标准验证命令：

```powershell
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py akshare-bridge\test_research_cache.py -q
npm test
npm run build
node scripts/check-build-budget.mjs
git diff --check
```

## 执行顺序

1. Task 1 先改善用户可感知加载并建立构建基线。
2. Task 2 处理真实研究冷启动和重复上游请求。
3. Task 3 在继续增加研究能力前降低代码耦合。
4. Task 4 建立策略准确性的可信底座，是策略升级的最高优先级。
5. Task 5 在验证底座稳定后建设组合与晋级闭环。
6. Task 6 把性能和策略质量变成长期自动门禁。

任何阶段都不得因为追求速度而返回静态假数据，也不得因为提高回测指标而引入未来数据、放宽 paper 风控或扩大真实交易权限。
