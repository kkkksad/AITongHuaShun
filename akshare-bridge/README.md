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
| `AKSHARE_BRIDGE_RESEARCH_CACHE_TTL` | `900.0` | 板块与历史日线内存缓存有效期（秒） |
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
- 全球指数兼容 AkShare 当前 `index_global_spot_em()` 与旧版函数名。
- 数据延迟取决于 AkShare 当前可用来源；备用源通常更慢但在受限网络下更稳定。

### 性能说明

- 首次启动需加载全市场 ~5000 只股票数据（约 3-5 秒）
- 后续请求从内存缓存读取，延迟 < 10ms
- 缓存按 TTL 自动刷新，默认 3 秒
- 板块和历史日线默认缓存 15 分钟，避免页面刷新重复抓取公开站点
