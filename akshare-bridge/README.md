# AkShare A股行情桥接微服务

为 AI量化交易系统提供 A 股实时行情数据的 HTTP API 桥梁。

## 快速开始

### 安装

```bash
cd akshare-bridge
pip install -r requirements.txt
```

### 运行

```bash
python main.py
# 或指定端口
AKSHARE_BRIDGE_PORT=8800 python main.py
```

服务默认监听 `http://127.0.0.1:8800`。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AKSHARE_BRIDGE_HOST` | `127.0.0.1` | 监听地址 |
| `AKSHARE_BRIDGE_PORT` | `8800` | 监听端口 |
| `AKSHARE_BRIDGE_CACHE_TTL` | `3.0` | 行情缓存有效期（秒） |
| `AKSHARE_BRIDGE_RESEARCH_CACHE_TTL` | `900.0` | 板块、历史日线与港股研究内存缓存有效期（秒） |
| `AKSHARE_BRIDGE_TOKEN` | (空) | 服务端 API 认证令牌（不设置则不校验） |
| `AKSHARE_BRIDGE_DISABLE_PROXY` | `true` | 拉取东方财富行情时默认绕过系统代理，避免本机代理中断行情连接 |
| `AKSHARE_BRIDGE_ORIGINS` | `http://127.0.0.1:8787` | 允许的来源，多个值使用逗号分隔 |

### API

#### 健康检查

```
GET /health
GET /api/health
```

响应：
```json
{
  "status": "ok",
  "service": "akshare-market-bridge",
  "cachedSymbols": 5200,
  "cacheAgeSec": 1.2,
  "proxyDisabled": true,
  "timestamp": "2026-07-11T03:00:00Z"
}
```

#### 获取行情

```
GET /api/market/quotes?symbols=600519,000001,300750
```

响应：
```json
{
  "quotes": [
    {
      "symbol": "600519",
      "name": "贵州茅台",
      "tradable": true,
      "price": 1492.60,
      "previousClose": 1486.80,
      "changePercent": 0.39,
      "volume": 12345678,
      "updatedAt": "2026-07-11T03:00:00.000Z"
    }
  ]
}
```

#### 按名称或代码搜索 A 股

```text
GET /api/market/stock-search?query=贵州茅台&limit=8
```

- 搜索复用全 A 股实时行情的内存缓存，精确代码、精确名称、代码/名称前缀和名称包含依次排序。
- 单次最多返回 20 个只读候选，包含代码、名称、最新价、涨跌幅和行情更新时间。
- 搜索结果不写入磁盘，不读取账户，也不包含下单能力；无匹配时返回空数组，不生成静态候选。

#### 获取真实板块与历史日线

```text
GET /api/market/sectors?limit=20
GET /api/market/sector-history?sectors=半导体,银行&days=180
GET /api/market/stock-history?symbols=600519,000001&days=180
```

- 行业快照最多返回 100 个板块；研究端读取 80 个涨跌排序快照，再等距抽取默认 10 个强、中、弱板块做历史计算，降低只研究当日领涨板块的选择偏差。
- 行业历史单次最多 20 个板块，使用板块名称查询，不复权。
- 个股历史单次最多 12 只股票，使用 6 位代码查询，前复权。
- `days` 只能在 60 至 500 之间；响应保留实际命中的来源、抓取时间、复权语义和部分失败警告。
- 历史数据只在 Python 进程内按 TTL 缓存，不写入本地无上限原始文件。

#### 获取真实港股快照与历史日线

```text
GET /api/market/hk/quotes?limit=20
GET /api/market/hk/history?symbols=00700,09988&days=180
```

- 港股代码必须是 5 位数字；快照最多返回 50 只，历史单次最多查询 12 只。
- 快照优先使用新浪港股行情，失败时回退到东方财富；历史优先使用东方财富前复权日线，失败时回退到新浪前复权日线。
- 响应保留实际来源、抓取时间、前复权语义、有效序列数量和部分失败警告。
- 港股接口只读取公开行情，不读取港股账户，不生成订单，也不套用 A 股 T+1、100 股整手或人民币费用规则。
- 快照和历史结果只在 Python 进程内按研究 TTL 有界缓存，不默认落盘。

#### 获取国内期货主连只读行情

```text
GET /api/market/futures/quotes?limit=16
GET /api/market/futures/history?symbols=IF0,CU0&days=180
```

- 快照观察池固定为 16 个国内主连代码，覆盖股指、贵金属、有色、黑色、能源化工和农产品；客户端不能请求任意未知代码。
- 静态元数据只保存代码、名称和分类，价格、涨跌幅、成交量、持仓量与日线均来自当前 AkShare/Sina 响应。
- 历史序列标记为 `continuous-main`，用于研究连续趋势，不代表可直接交易的具体月份合约，也未计入换月、保证金、夜盘和交割约束。
- 上游失败时返回空数组和警告，不使用静态或合成期货价格补位；非空结果只在 Python 进程内按研究 TTL 缓存。
- 两个端点均只读，不读取期货账户、不生成期货订单，也不会直接改变 A 股本地 paper 仓位。

#### 获取真实新股申购与上市数据

```text
GET /api/research/ipo-subscriptions?limit=80
```

- 数据来自 AkShare `stock_xgsglb_em()` 的东方财富新股申购表，保留申购代码、申购/上市日期、发行价、发行/行业市盈率、顶格市值、中签率和上市后公开涨幅。
- `发行总数` 按万股返回，`网上发行` 与 `申购上限` 按股返回，`顶格申购需配市值` 按万元返回；未定价字段保持 `null`。
- 单次最多返回 200 行，只在 Python 进程内按研究 TTL 缓存非空归一化结果，不写入磁盘。
- 该端点只读，不读取账户资格、持仓或资金，也不包含申购和下单能力。

### 对接 TypeScript 后端

```typescript
// server/system.ts 或启动脚本中
import { AkShareMarketProvider } from "./market/AkShareProvider";

const market = new AkShareMarketProvider({
  baseUrl: "http://127.0.0.1:8800",
  tickMs: 5000,
  mode: "paper",
  symbols: ["600519", "000001", "300750"],
  apiKey: process.env.AKSHARE_BRIDGE_TOKEN,
});
```

真实行情只改变 `MarketDataProvider`，订单仍进入 TypeScript 服务中的
`PaperBroker`。该桥接不包含账户、持仓或下单接口。

### 数据来源

使用 [AkShare](https://github.com/akfamily/akshare) 开源金融数据接口：
- 优先使用 `ak.stock_zh_a_spot_em()` —— 东方财富沪深京 A 股实时行情。
- 当东方财富接口被本机网络或代理中断时，自动降级到 `ak.stock_zh_a_spot()`。
- 备用源返回的 `sh/sz/bj` 前缀代码会统一归一化为 6 位证券代码。
- 支持全部 A 股（沪深北交所）实时数据。
- 行业快照优先使用东方财富，失败时回退到同花顺行业一览。
- 行业日线优先使用东方财富，失败时回退到同花顺行业指数。
- 个股日线依次尝试东方财富、腾讯和新浪，并在每条序列中记录实际来源。
- 港股快照优先新浪并回退到东方财富；港股日线优先东方财富并回退到新浪，所有序列统一为 5 位代码和前复权语义。
- 国内期货主连快照使用新浪期货行情，主连连续日线使用新浪主力连续历史；观察池代码由服务端白名单控制。
- 新股申购与上市记录使用东方财富新股申购表，并保留空定价和实际抓取时间。
- 全球指数兼容 AkShare 当前 `index_global_spot_em()` 与旧版函数名。
- 数据延迟取决于 AkShare 当前可用来源；备用源通常更慢但在受限网络下更稳定。

### 性能说明

- 首次启动需加载全市场 ~5000 只股票数据（约 3-5 秒）
- 后续请求从内存缓存读取，延迟 < 10ms
- 缓存按 TTL 自动刷新，默认 3 秒
- 板块、股票/港股/期货历史日线、非空期货快照和非空新股表默认缓存 15 分钟，避免页面刷新重复抓取公开站点
- 港股批量历史冷启动受公开来源限速影响，在当前开发网络下 10 只股票可能约需 60 秒；命中 15 分钟研究缓存后不会重复冷启动
