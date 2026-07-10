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
| `AKSHARE_BRIDGE_TOKEN` | (空) | 服务端 API 认证令牌（不设置则不校验） |
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
- `ak.stock_zh_a_spot_em()` —— 东方财富沪深京 A 股实时行情
- 支持全部 A 股（沪深北交所）实时数据
- 数据延迟约 3-5 秒（取决于东方财富源）

### 性能说明

- 首次启动需加载全市场 ~5000 只股票数据（约 3-5 秒）
- 后续请求从内存缓存读取，延迟 < 10ms
- 缓存按 TTL 自动刷新，默认 3 秒
