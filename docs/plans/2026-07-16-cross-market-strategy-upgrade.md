# 真实策略样本与跨市场研究实施计划

**状态：** 已完成（2026-07-17）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有合成参数排行榜增加独立的真实历史稳健性验证，并新增国内期货与全球市场只读上下文，明确不同市场状态适用的策略族。

**Architecture:** 合成排行榜继续只承担可复现参数搜索演示，真实验证使用 AkShare 桥接的最多 8 只 A 股、500 个交易日和三个不重叠窗口，不在验证集重新调参。期货由 Python 桥统一归一化，Fastify 将期货趋势与全球指数风险偏好组合成只读策略上下文；这些结果不会直接进入 paper 或真实订单。

**Tech Stack:** Python, FastAPI, AkShare, TypeScript, Fastify, Zod, React, TanStack Query, Vitest, Pytest.

---

## 硬边界

- 增加合成 K 线数量不能被描述为增加真实样本。
- 真实验证与参数选择必须分离；本阶段使用预先固定的参数，不在同一批真实窗口寻找最优值。
- 国内期货主连是研究序列，不等于可交易合约，也不包含换月成本、保证金、夜盘或真实账户。
- 全球指数和期货当前只用于解释市场状态；完成发布时间对齐和历史增量价值验证前不得自动放大 A 股仓位。
- 新增策略必须属于当前策略族之外的独立逻辑，并先通过真实多窗口基线；本阶段先验证现有代表策略，不为数量强行新增重复策略。

## Task 1：真实多窗口策略稳健性验证

**Files:**
- Create: `server/research/strategyRobustness.ts`
- Create: `server/research/strategyRobustness.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Create: `src/components/StrategyRobustnessPanel.tsx`
- Modify: `src/App.tsx`

- [x] 从当前真实可交易快照按成交额选取最多 8 只股票，读取每只最多 500 根前复权日线。
- [x] 将多标的日线按交易日对齐为 `MarketSnapshot[]`，每个标的只使用该日期及之前的价格，不向前回填未来值。
- [x] 为趋势、回踩、突破、均值回归和防守策略族定义预先固定的代表参数。
- [x] 把历史拆成三个不重叠窗口；每个窗口独立重置账户、持仓和策略状态。
- [x] 报告窗口数、股票数、bar 数、总交易数、盈利窗口数、中位收益、最差收益、平均与最差回撤和平均胜率。
- [x] 只有至少 3 个窗口、6 笔交易、2 个盈利窗口、中位收益为正且最差回撤不超过 15% 才标记 `pass`。
- [x] 暴露受认证的 `GET /api/research/strategy-robustness?limit=8&days=500`；Mock 模式返回 `mock-disabled`，不返回静态结果。
- [x] 策略页新增独立“真实历史稳健性”模块，原合成排行榜继续明确标注合成来源。

固定参数报告契约：

```ts
export interface StrategyRobustnessEntry {
  strategyKey: string;
  strategyName: string;
  strategyFamily: "trend" | "pullback" | "breakout" | "mean-reversion" | "defensive";
  fixedParams: Record<string, number>;
  windows: number;
  profitableWindows: number;
  totalTrades: number;
  medianReturn: number;
  worstReturn: number;
  averageMaxDrawdown: number;
  worstMaxDrawdown: number;
  averageWinRate: number;
  stabilityGate: "pass" | "caution" | "blocked";
}
```

## Task 2：真实国内期货桥接

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] 建立受控主连观察池，覆盖股指、贵金属、有色、黑色、能源化工和农产品，不允许客户端请求任意未知代码。
- [x] 使用 `futures_zh_spot(..., market="CF", adjust="0")` 读取真实主连快照，统一价格、昨结、涨跌幅、成交量、持仓量、时间、分类和来源。
- [x] 使用 `futures_main_sina` 读取有界主连日线，复用历史 bar 契约并明确 `adjustment="continuous-main"`。
- [x] 新增 `GET /api/market/futures/quotes?limit=16` 与 `GET /api/market/futures/history?symbols=IF0,CU0&days=180`。
- [x] 上游超时或失败返回降级空结果，不使用静态价格；静态观察池只保存代码、名称和分类元数据。
- [x] 增加认证、代码白名单、数量限制、字段归一化、缓存和上游失败测试。

第一版受控观察池：

```text
股指: IF0, IH0, IC0, IM0
贵金属: AU0, AG0
有色: CU0, AL0
黑色: RB0, I0
能源化工: SC0, TA0, MA0
农产品: M0, Y0, RM0
```

## Task 3：跨市场策略上下文

**Files:**
- Create: `server/research/crossMarketStrategyContext.ts`
- Create: `server/research/crossMarketStrategyContext.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`

- [x] 组合真实全球指数快照、国内期货快照和期货 5/20/60 日结构。
- [x] 输出 `risk-on / neutral / risk-off / mixed` 风险基调、证据、数据降级和来源时间。
- [x] 输出优先与降权策略族，而不是直接输出买卖订单。
- [x] 全球和期货信号冲突时返回 `mixed`，保持现金或降低新增仓位，不强行选择方向。
- [x] 暴露受认证的 `GET /api/research/cross-market-strategy-context?limit=12&days=180`。

透明映射：

| 上下文 | 优先策略族 | 降权策略族 |
| --- | --- | --- |
| 全球风险偏好 + 股指/工业品趋势向上 | 趋势、突破、健康回踩 | 逆势均值回归、资金盾牌 |
| 全球中性 + 商品分化 | 区间均值回归、安静回踩 | 高仓位突破 |
| 全球风险规避 + 股指转弱 + 黄金走强 | 防守、减仓、现金 | 新增多头趋势、网格摊平 |
| 来源冲突或数据不足 | 现金、只观察 | 自动新增仓位 |

## Task 4：期货与策略适配前端

**Files:**
- Create: `src/components/FuturesMarketPanel.tsx`
- Modify: `src/components/MarketResearchWorkspace.tsx`
- Modify: `src/styles/index.css`

- [x] 市场工作台新增“期货观察”页签，继续使用按需代码加载和交互预取。
- [x] 展示分类、主连代码、最新价、涨跌幅、5/20/60 日收益、波动、回撤、成交/持仓和来源。
- [x] 展示当前跨市场风险基调、优先策略族、降权策略族和主要证据。
- [x] 明确显示主连连续、只读研究、不读取期货账户、不生成期货订单。
- [x] 390px 页面不得出现页面级横向溢出，宽表只在期货模块内部滚动。

## Task 5：验证和文档

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/2026-07-16-cross-market-strategy-upgrade.md`

- [x] 运行 Python 桥接、聚焦 Vitest、`npm test`、`npm run build` 和 `git diff --check`。
- [x] 扫描源码和文档中的真实 SPT、UID、密码和 Token，排除 `.env.local` 与测试占位符。
- [x] 真实源可用时记录品种数、来源、最新日期和耗时；不可用时记录真实降级，不声称已经取得数据。
- [x] 在认证桌面和 390 x 844 页面验证策略稳健性、期货页签、加载状态、内部滚动和控制台。
- [x] 记录合成排行榜与真实稳健性验证的区别，禁止把前者的胜率和后者的多窗口结果混为一谈。

标准命令：

```powershell
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
npx vitest run server/research/strategyRobustness.test.ts server/research/crossMarketStrategyContext.test.ts --environment node
npm test
npm run build
git diff --check
```

## 完成结果

- Python 桥接测试 76 个通过；服务端 40 个文件、678 个测试通过；前端 5 个文件、24 个测试通过；生产构建转换 2,303 个模块。
- 真实 A 股报告覆盖 8 只流动性股票、494 个共同交易日、3 个不重叠窗口和 10 个固定策略，当前 4 个策略通过门槛。
- 国内期货真实运行返回 12 份快照和 12 份 180 日主连历史，最新日期为 2026-07-16；当前跨市场基调为 `risk-off`。
- 桌面和 390 x 844 页面均无页面级横向溢出，宽表只在各自模块内部滚动，干净认证页面无应用控制台错误。
- 凭据扫描未在受跟踪源码和文档中发现真实长度的 SPT、UID、密码或 Token；`.env.local`、日志、运行数据和构建产物未纳入扫描。
