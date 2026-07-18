# 外部市场对 A 股影响研究实施计划

**状态：** 已完成，等待用户明确提交

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不稀释 A 股主线、不增加任何外部市场下单能力的前提下，增加美股、日股、韩股和 BTC/ETH 只读观察，并用时间安全的历史样本检验它们对 A 股风险状态是否具有增量信息。

**Architecture:** AkShare 桥接负责受控代码、真实快照、历史日线、来源和交易时区，Fastify 新增独立的外部市场影响研究模块，按“美股隔夜、亚洲市场、数字资产”分组并与 A 股指数历史对齐。第一版只输出观察信号和历史条件统计，不修改 `PaperAutoExecutor`、`PaperBroker` 或 A 股策略路由；只有样本外增量门槛通过后，才允许进入不下单的 shadow 权重实验。

**Tech Stack:** Python 3, FastAPI, AkShare, pandas, TypeScript, Fastify, Zod, React, TanStack Query, Vitest, Pytest.

---

## 范围与优先级

### 主次顺序

1. **A 股仍是唯一自动 paper 研究与执行市场。** 外部市场不拥有账户、持仓、订单或执行接口。
2. **美股隔夜优先。** 标普 500、纳斯达克和道琼斯的收盘在 A 股开盘前已知，时间边界最清楚。
3. **日股、韩股次之。** 日经 225、KOSPI 与恒生指数用于亚洲风险共振；盘中数据只能影响抓取时点之后的研究，不能回填盘前判断。
4. **BTC/ETH 最低优先级。** 它们只代表 24 小时风险偏好线索，不能单独触发 A 股方向判断、仓位增加或微信消息。
5. **人民币与美元因子比数字资产更直接，但不进入本计划第一版。** 后续应单独评估 USD/CNH、美元指数和利率，避免在一个改动里扩张过多数据源。

### 硬边界

- 不增加美股、日股、韩股、港股、数字资产或期货订单接口。
- 不把快照涨跌幅描述为对 A 股的预测概率。
- 不使用当天尚未完成的亚洲收盘价解释当天 A 股盘前决策。
- 不把数据源失败替换为静态价格、合成行情或最近一次价格冒充实时行情。
- 不默认保存 tick、分钟线或网页正文；只保存最多 750 个交易日的紧凑特征行和验证摘要。
- 外部信号在第一版不得把 A 股 `allowNewPositions=false` 改成 `true`，也不得提高仓位上限。
- 新增来源必须保留供应商、抓取时间、市场会话日期、时区、报价类型和降级原因。

## 当前事实

- `akshare-bridge/main.py` 已有 `/api/market/global`，但当前新浪回退只覆盖日经 225 和欧洲指数；2026-07-18 真实运行只返回 5 个指数，没有美股和 KOSPI。
- 当前 AkShare `1.18.64` 提供 `index_global_hist_em`、`index_global_hist_sina`、`index_us_stock_sina` 和 `crypto_js_spot`。
- `server/research/crossMarketStrategyContext.ts` 已组合全球快照与国内期货，但只按所有全球指数的平均涨跌生成一个 `global` 分组，没有区分隔夜美股、亚洲时段和 24 小时数字资产。
- 当前跨市场结果只选择研究策略族，不直接进入 A 股 paper 订单；该边界继续保留。

## 文件结构

### 新建

- `server/research/externalMarketImpact.ts`：时间对齐、分组摘要、A 股影响条件统计和观察结论。
- `server/research/externalMarketImpact.test.ts`：隔夜映射、亚洲防穿越、条件样本和降级测试。
- `server/research/externalMarketFeatureStore.ts`：最多 750 行的紧凑日级特征存储，不保存原始 tick。
- `server/research/externalMarketFeatureStore.test.ts`：容量、原子写入、坏文件和日期幂等测试。
- `src/components/ExternalMarketImpactPanel.tsx`：全球观察页签及 A 股影响说明。

### 修改

- `akshare-bridge/main.py`：受控全球指数、全球历史、BTC/ETH 快照和 A 股指数历史。
- `akshare-bridge/test_bridge.py`：字段归一化、白名单、日期和失败降级。
- `akshare-bridge/README.md`：只读接口、来源和边界。
- `server/app.ts`、`server/app.test.ts`：受认证研究路由与 OpenAPI 契约。
- `server/config.ts`、`server/config.test.ts`：紧凑特征文件、容量和采样开关。
- `src/lib/tradingApi.ts`、`src/lib/tradingApi.test.ts`：报告类型和 API 客户端。
- `src/components/MarketResearchWorkspace.tsx`：新增按需加载的“全球影响”页签。
- `src/styles/index.css`：影响摘要、区域行和移动端布局。
- `docs/product/overview.md`、`docs/architecture/system-overview.md`、`docs/safety/trading-boundaries.md`、`docs/status/current-state.md`、`docs/roadmap.md`：同步实际能力和非目标。

## Task 1：建立受控全球指数快照与历史契约

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] **Step 1：先写全球观察池和历史端点失败测试**

测试必须固定验证以下代码，不允许客户端任意透传供应商 symbol：

```python
EXPECTED_GLOBAL_SYMBOLS = [
    "DJI", "SPX", "IXIC", "HSI", "N225", "KOSPI", "SX5E",
]

def test_global_history_accepts_controlled_indices():
    symbols = ",".join(EXPECTED_GLOBAL_SYMBOLS)
    response = client.get(
        f"/api/market/global/history?symbols={symbols}&days=500"
    )
    assert response.status_code == 200

def test_global_history_rejects_unknown_indices():
    response = client.get(
        "/api/market/global/history?symbols=SPX,UNKNOWN&days=180"
    )
    assert response.status_code == 400
```

- [x] **Step 2：运行聚焦测试并确认当前失败**

```powershell
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q -k "global_history or global_market"
```

Expected: 新历史端点测试为 404 或导入失败，现有全球快照测试继续通过。

- [x] **Step 3：用单一受控规格替换零散别名**

在 `akshare-bridge/main.py` 定义并复用：

```python
GLOBAL_INDEX_WATCHLIST = {
    "DJI": {
        "name": "道琼斯指数", "region": "US",
        "timezone": "America/New_York", "eastmoney": "道琼斯",
        "sina": ".DJI", "sina_api": "us",
    },
    "SPX": {
        "name": "标普500", "region": "US",
        "timezone": "America/New_York", "eastmoney": "标普500",
        "sina": ".INX", "sina_api": "us",
    },
    "IXIC": {
        "name": "纳斯达克指数", "region": "US",
        "timezone": "America/New_York", "eastmoney": "纳斯达克",
        "sina": ".IXIC", "sina_api": "us",
    },
    "HSI": {
        "name": "恒生指数", "region": "HK",
        "timezone": "Asia/Hong_Kong", "eastmoney": "恒生指数",
        "sina": "恒生指数", "sina_api": "global",
    },
    "N225": {
        "name": "日经225", "region": "JP",
        "timezone": "Asia/Tokyo", "eastmoney": "日经225",
        "sina": "日经225指数", "sina_api": "global",
    },
    "KOSPI": {
        "name": "韩国KOSPI", "region": "KR",
        "timezone": "Asia/Seoul", "eastmoney": "韩国KOSPI",
        "sina": "首尔综合指数", "sina_api": "global",
    },
    "SX5E": {
        "name": "欧洲Stoxx50", "region": "EU",
        "timezone": "Europe/Berlin", "eastmoney": "欧洲斯托克50",
        "sina": "欧洲Stoxx50指数", "sina_api": "global",
    },
}
```

`GlobalMarketQuote` 增加可审计字段：

```python
sessionDate: str | None = None
timezone: str
quoteKind: Literal["snapshot", "daily-close"]
```

快照无法取得市场日期时 `sessionDate=None`，不得用抓取日期伪造市场会话日期。

- [x] **Step 4：实现全球历史回退**

实现 `fetch_global_history_dataframe(symbol, start_date, end_date)`：

1. 先调用 `ak.index_global_hist_em(symbol=spec["eastmoney"])`。
2. 美股回退调用 `ak.index_us_stock_sina(symbol=spec["sina"])`。
3. 日股、韩股、港股和欧洲回退调用 `ak.index_global_hist_sina(symbol=spec["sina"])`。
4. 返回实际来源 `eastmoney-global-history`、`sina-us-index-history` 或 `sina-global-index-history`。
5. 复用 `build_history_response(..., market="global-index")`，限制 7 个代码、60 至 500 日。

- [x] **Step 5：验证测试通过；按用户习惯等待统一提交**

```powershell
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q -k "global_history or global_market"
git add akshare-bridge/main.py akshare-bridge/test_bridge.py akshare-bridge/README.md
git commit -m "补齐全球指数快照与历史"
```

## Task 2：增加 BTC/ETH 只读快照，不伪造历史

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] **Step 1：写受控币种和失败降级测试**

```python
def test_crypto_quotes_only_return_btc_and_eth():
    response = client.get("/api/market/crypto/quotes")
    assert response.status_code == 200
    assert {item["symbol"] for item in response.json()["items"]} <= {
        "BTCUSD", "ETHUSD",
    }

def test_crypto_quotes_do_not_fabricate_prices_on_failure():
    with patch("main.fetch_crypto_spot_dataframe", side_effect=RuntimeError("offline")):
        response = client.get("/api/market/crypto/quotes")
    assert response.json()["items"] == []
    assert response.json()["source"] == "unavailable"
```

- [x] **Step 2：实现最小币种契约**

```python
CRYPTO_WATCHLIST = {
    "BTCUSD": "比特币",
    "ETHUSD": "以太坊",
}

class CryptoQuote(BaseModel):
    symbol: str
    name: str
    priceUsd: float
    change24hPercent: float
    high24h: float | None = None
    low24h: float | None = None
    volume24h: float | None = None
    updatedAt: str
    source: str
```

`fetch_crypto_spot_dataframe` 只调用 `ak.crypto_js_spot()`；归一化字段使用“交易品种、最近报价、涨跌幅、24小时最高、24小时最低、24小时成交量、更新时间”。第一版不提供币价历史端点，因为当前 AkShare 没有与该快照同口径的 BTC/ETH 日线；历史不可用必须明确留空，不能用 CME 比特币期货替代现货 BTC/ETH。

- [x] **Step 3：增加 15 分钟内存缓存并验证**

非空快照使用现有有界 `research_cache`；空结果不缓存。运行：

```powershell
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q -k crypto
```

- [x] **Step 4：桥接改动完成；按用户习惯等待统一提交**

```powershell
git add akshare-bridge/main.py akshare-bridge/test_bridge.py akshare-bridge/README.md
git commit -m "增加BTC与ETH只读观察"
```

## Task 3：补齐 A 股指数历史基准

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`

- [x] **Step 1：写指数白名单与日期测试**

只允许 `SH000001`、`SZ399001`、`SZ399006` 和 `SH000300`，拒绝股票代码和未知指数。

- [x] **Step 2：实现 `/api/market/index-history`**

使用现有 `INDEX_SYMBOL_MAP` 的规范代码。历史源依次为：

```python
ak.stock_zh_index_daily_em(symbol="sh000300", start_date=..., end_date=...)
ak.stock_zh_index_daily_tx(symbol="sh000300", start_date=..., end_date=...)
ak.stock_zh_index_daily(symbol="sh000300")
```

端点限制 4 个指数、60 至 500 日，`adjustment="none"`，保留实际来源。

- [x] **Step 3：桥接 84 项测试通过；按用户习惯等待统一提交**

```powershell
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q
git add akshare-bridge/main.py akshare-bridge/test_bridge.py
git commit -m "增加受控A股指数历史基准"
```

## Task 4：构建时间安全的外部市场影响报告

**Files:**
- Create: `server/research/externalMarketImpact.ts`
- Create: `server/research/externalMarketImpact.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] **Step 1：定义报告契约和失败测试**

```ts
export interface ExternalMarketImpactReport {
  generatedAt: string;
  mode: "paper" | "live";
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  influenceMode: "observation-only" | "shadow-validated";
  groups: Array<{
    key: "us-overnight" | "asia" | "crypto";
    tone: "positive" | "neutral" | "negative" | "unavailable";
    coverage: number;
    averageChangePercent: number | null;
    asOf: string | null;
    symbols: string[];
  }>;
  aShareImpact: {
    bias: "supportive" | "neutral" | "restrictive" | "conflicted";
    confidence: number;
    evidenceGrade: "snapshot-only" | "historically-observed" | "walk-forward-validated";
    allowPositionIncrease: false;
    rationale: string[];
  };
  validation: {
    benchmark: "SH000300";
    samples: number;
    directionalHitRate: number | null;
    averageNextDayReturn: number | null;
    unconditionalAverageReturn: number | null;
    incrementalReturn: number | null;
  };
  warnings: string[];
  guardrails: string[];
}
```

测试必须覆盖：

- 美股日期 `D` 只能映射到第一个日期大于 `D` 的 A 股交易日。
- 日经/KOSPI 日收盘只能映射到之后的 A 股交易日，不能解释同日盘前。
- BTC/ETH 快照没有历史样本时 `evidenceGrade="snapshot-only"`。
- 任一分组不可用时降级但保留其他分组。
- `allowPositionIncrease` 始终为 `false`。

- [x] **Step 2：实现透明的分组规则**

固定使用：

```ts
const GROUP_THRESHOLDS = {
  "us-overnight": 0.45,
  asia: 0.50,
  crypto: 1.50,
} as const;
```

平均涨跌超过正阈值为 `positive`，低于负阈值为 `negative`，其余为 `neutral`。BTC/ETH 只能补充证据：当美股和亚洲市场都为中性时，币价方向不得单独把 A 股影响改成 `supportive` 或 `restrictive`。

- [x] **Step 3：实现时间安全的历史条件统计**

使用固定规则，不在验证样本中调阈值：

1. 美股会话日 `D` 映射到第一个 `aShareDate > D` 的沪深 300 交易日。
2. 日股、韩股和港股日收盘同样只映射到之后的 A 股交易日。
3. 外部综合为正且沪深 300 次日上涨，或外部综合为负且次日下跌，才记为方向命中。
4. 至少 60 个对齐样本才显示命中率；不足时全部统计字段为 `null`。
5. 至少 250 个样本、三个不重叠窗口均有覆盖，才允许标记 `walk-forward-validated`。

- [x] **Step 4：暴露受认证只读路由**

```text
GET /api/research/external-market-impact?days=500
```

Mock 模式返回 `mock-disabled`，不返回静态外盘；OpenAPI 描述必须写明“不直接生成订单、不提高 A 股仓位”。

- [x] **Step 5：聚焦服务端测试通过；按用户习惯等待统一提交**

```powershell
node node_modules/vitest/vitest.mjs run server/research/externalMarketImpact.test.ts server/app.test.ts --environment node
git add server/research/externalMarketImpact.ts server/research/externalMarketImpact.test.ts server/app.ts server/app.test.ts
git commit -m "增加外部市场对A股影响研究"
```

## Task 5：建立紧凑的 09:20 特征样本，而不是缓存海量行情

**Files:**
- Create: `server/research/externalMarketFeatureStore.ts`
- Create: `server/research/externalMarketFeatureStore.test.ts`
- Modify: `server/config.ts`
- Modify: `server/config.test.ts`
- Modify: `server/index.ts`

- [x] **Step 1：写容量、幂等和损坏恢复测试**

```ts
expect(store.rows()).toHaveLength(750);
expect(store.rows().at(0)?.tradeDate).toBe("2023-08-01");
expect(store.upsert(sameDateRow)).toHaveLength(750);
```

同一交易日重复采样只能覆盖同一行，不追加重复记录；坏 JSON 重命名为 `.corrupt-<timestamp>` 后从空存储启动，不得影响交易状态文件。

- [x] **Step 2：实现独立研究特征文件**

默认路径 `data/research/external-market-features.json`，每行只保存：

```ts
interface ExternalMarketFeatureRow {
  tradeDate: string;
  capturedAt: string;
  usOvernightReturn: number | null;
  japanOpenReturn: number | null;
  koreaOpenReturn: number | null;
  hongKongOpenReturn: number | null;
  btcOvernightReturn: number | null;
  ethOvernightReturn: number | null;
  hs300CloseReturn: number | null;
  sourceStatus: "complete" | "partial";
}
```

`09:20` 只写当时已知特征，`15:10` 只补同一行的沪深 300 当日收盘标签。默认上限 750 行，预计远低于 2 MB；不保存原始响应、tick、分钟线或凭据。

- [x] **Step 3：增加安全配置**

```text
EXTERNAL_MARKET_FEATURE_CAPTURE_ENABLED=false
EXTERNAL_MARKET_FEATURE_MAX_ROWS=750
EXTERNAL_MARKET_FEATURE_FILE=data/research/external-market-features.json
```

默认关闭采样；只有 `paper + akshare` 可开启。真实交易配置不能借此启用任何执行能力。

- [x] **Step 4：存储、采样和配置测试通过；采样器接入 Fastify 生命周期并按用户习惯等待统一提交**

```powershell
node node_modules/vitest/vitest.mjs run server/research/externalMarketFeatureStore.test.ts server/config.test.ts --environment node
git add server/research/externalMarketFeatureStore.ts server/research/externalMarketFeatureStore.test.ts server/config.ts server/config.test.ts server/index.ts
git commit -m "增加有界外盘特征样本"
```

## Task 6：增加独立“全球影响”页签

**Files:**
- Create: `src/components/ExternalMarketImpactPanel.tsx`
- Modify: `src/components/MarketResearchWorkspace.tsx`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/styles/index.css`

- [x] **Step 1：先写 API 请求和展示降级测试**

验证请求固定为 `/api/research/external-market-impact?days=500`，来源失败时保留已成功报告并显示刷新失败，不清空旧数据。

- [x] **Step 2：实现按需加载页签**

在“期货研判”之后、“事件资讯”之前增加 `全球影响`。页面只显示：

- 美股隔夜：DJI、SPX、IXIC。
- 亚洲市场：HSI、N225、KOSPI。
- 数字资产：BTC、ETH，明确标记 24 小时风险偏好参考。
- 对 A 股影响：偏支持、中性、偏约束或冲突，显示置信度、样本数、数据截止时间和证据等级。
- 历史验证不足 60 个样本时显示“样本不足”，不显示伪概率。

页面不增加市场选择器、下单按钮、仓位按钮或自动交易开关。

- [x] **Step 3：验证响应式布局**

桌面区域卡使用三列；低于 760px 改为单列。390 x 844 下页面宽度不得超过视口，任何宽表只能在模块内部横向滚动。

- [x] **Step 4：运行前端测试与构建；等待用户明确提交**

```powershell
node node_modules/vitest/vitest.mjs run src/lib/tradingApi.test.ts src/components/ResearchQueryState.test.tsx --environment jsdom
npm run build
git add src/components/ExternalMarketImpactPanel.tsx src/components/MarketResearchWorkspace.tsx src/lib/tradingApi.ts src/lib/tradingApi.test.ts src/styles/index.css
git commit -m "增加全球市场影响观察页"
```

## Task 7：只进入 shadow 验证，不直接改变 A 股 paper

**Files:**
- Modify: `server/research/externalMarketImpact.ts`
- Modify: `server/research/externalMarketImpact.test.ts`
- Modify: `server/research/adaptiveStrategyRouter.ts`
- Modify: `server/research/adaptiveStrategyRouter.test.ts`

- [x] **Step 1：定义严格晋级门槛测试**

只有同时满足以下条件，才能产生 `shadowModifier`：

```ts
const EXTERNAL_SHADOW_GATE = {
  minimumSamples: 250,
  minimumWindows: 3,
  minimumDirectionalImprovement: 0.03,
  maximumModifier: 0.05,
} as const;
```

任一条件不满足时 modifier 必须为 0。即使门槛通过，外盘风险偏好也不能把 `allowNewPositions=false` 改为 `true`。

- [x] **Step 2：只记录影子结果**

`adaptiveStrategyRouter` 返回当前正式结果和 `shadow.externalMarket` 对比字段，但 `paperTradingPlan` 继续只读取正式结果。外盘偏弱允许提出最多 `-0.05` 的 shadow 置信度修正；外盘偏强只记录假设，不提高正式仓位。

- [x] **Step 3：路由测试通过；按用户习惯等待统一提交**

```powershell
node node_modules/vitest/vitest.mjs run server/research/externalMarketImpact.test.ts server/research/adaptiveStrategyRouter.test.ts --environment node
git add server/research/externalMarketImpact.ts server/research/externalMarketImpact.test.ts server/research/adaptiveStrategyRouter.ts server/research/adaptiveStrategyRouter.test.ts
git commit -m "增加外盘影响影子验证"
```

## Task 8：通知、文档和完整验证

**Files:**
- Modify: `server/notifications/paperPlanNotifier.ts`
- Modify: `server/notifications/paperPlanNotifier.test.ts`
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/2026-07-18-external-market-a-share-impact.md`

- [x] **Step 1：限制微信占用**

不新增独立外盘消息。四条固定简报只增加一行：

```text
外盘：美股隔夜偏弱；亚洲分化；BTC/ETH仅作参考｜对A股：偏约束（历史样本 126）
```

外盘变化不得使用十条预算中的事件预留，除非同时满足现有 `risk-off` 或真实数据降级条件。

- [x] **Step 2：运行全量验证**

```powershell
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q
npm test
npm run build
git diff --check
```

- [x] **Step 3：运行真实只读检查**

记录全球指数数量、BTC/ETH 数量、每个来源、最新会话日期和警告。源不可用时记录真实降级，不用测试夹具充当运行结果。

- [x] **Step 4：浏览器验证**

登录后检查桌面和 390 x 844：页签按需加载、数据质量、样本不足、来源、更新时间、内部滚动和控制台。不得出现页面级横向溢出。

- [x] **Step 5：更新状态；按用户习惯等待明确提交指令**

```powershell
git add docs server/notifications/paperPlanNotifier.ts server/notifications/paperPlanNotifier.test.ts
git commit -m "记录全球市场影响研究边界"
```

## 实际验证结果

- Python 桥接：84 项通过，只有 1 项 FastAPI/httpx 依赖弃用警告。
- 服务端 Vitest：45 个文件、734 项通过；前端 Vitest：21 个文件、64 项通过。
- TypeScript 与 Vite 生产构建通过，转换 2,314 个模块；`ExternalMarketImpactPanel` 独立块 6.98 KiB。
- 真实桥接取得 9 个全球指数快照、5 条各 500 日全球历史、1 条 500 日沪深 300 历史和 1 个 BTC 快照；恒生历史与 ETH 当前不可用并保留警告。
- Fastify 报告为 `live-read-only / observation-only`，严格对齐样本 197、三个窗口、方向命中率 57.87%、`allowPositionIncrease=false`；因未达到 250 样本，不进入 shadow 修正。
- 浏览器桌面正文 1265/1265；390px 下正文 375/375、全球面板 353/353，宽表只在模块内部 325/940 横向滚动，控制台无警告或错误。

## 完成标准

- 美股、日股、韩股和 BTC/ETH 都有真实只读来源、受控代码、抓取时间和明确降级。
- A 股影响统计严格使用决策时点之前可见的数据，历史样本不足时不展示概率。
- 外盘模块不会增加任何外部市场订单能力，也不会提高正式 A 股 paper 仓位。
- 日级特征最多 750 行，不保存 tick 或无限历史，坏文件不影响交易状态。
- 全量 Python、服务端、前端测试和生产构建通过。
- 文档明确区分快照观察、历史条件统计、shadow 验证和正式策略路由。

## 关键决策

1. **新增独立“全球影响”页签，而不是把更多表格塞进期货页。** 期货页继续负责国内主连，全球页负责外部风险因子，职责更清楚。
2. **数字资产只做低权重观察。** BTC/ETH 与 A 股关系不稳定，且当前 AkShare 缺少同口径历史，不能抢在美股和亚洲指数之前进入策略。
3. **先验证，再影响。** 外盘方向符合直觉不等于具有增量预测力；至少 250 个时间对齐样本和三个窗口通过后，也只先进入 shadow。
4. **只存紧凑特征。** 09:20 和 15:10 各更新同一条日记录，既能积累 point-in-time 样本，又不会让电脑被行情缓存拖慢。

## 遗留问题

- 当前免费公开源的稳定性、延迟和授权条款仍需逐项确认；不可用时保持降级。
- 亚洲市场开盘后对 A 股的分钟级影响需要授权的 point-in-time 分钟历史，本计划不回填不存在的历史快照。
- USD/CNH、美元指数、美国利率和离岸人民币可能比 BTC/ETH 更有解释力，应在本计划完成后建立独立、同样时间安全的验证计划。
- 任何让外盘 shadow 结果进入正式 paper 路由的改动，都需要新的决策记录和人工批准。
