# 当前状态

**核对日期：** 2026-07-11

## 已实现

- React + TypeScript + Vite 响应式量化研究工作台。
- 总览、策略实验室、市场观察、模拟账户和研究管线五个视图。
- 固定种子的确定性回测、净值曲线、基准曲线、交易记录和风险指标。
- Fastify + TypeScript 本地服务，提供 REST API 与 WebSocket 实时通道。
- 确定性模拟行情，每秒推送指数和可交易股票报价。
- 可切换的内存或本地 JSON 模拟账户、持仓、订单、成交、手续费、滑点和审计事件。
- 模拟市价单、限价单挂单与撤销、客户端订单 ID 幂等、暂停和恢复撮合。
- 单笔金额、单标的仓位、整手数量、每日亏损和可用资金检查。
- React 页面通过 API 和 WebSocket 显示实时模拟行情、权益、持仓和订单。
- Zod 环境变量与订单请求校验。
- VS Code 前后端复合断点调试。
- 回测、风险引擎、模拟券商和 Fastify API 的 Vitest 测试。
- **MarketDataProvider 契约** —— 抽象行情数据源，支持 MockMarket 实现，为接入 AkShare/Tushare/券商行情网关预留插槽。
- **TradingStore 契约** —— 抽象交易数据持久化，支持 InMemoryTradingStore 与 JsonFileTradingStore，为 PostgreSQL 存储预留插槽。
- **BrokerAdapter 契约** —— 抽象券商连接，支持 MockBrokerAdapter，为东方财富/华泰等实盘券商预留插槽。
- PaperBroker 通过契约接口依赖注入，不绑定具体实现。
- 契约一致性测试，确保任意实现类符合契约约定。
- **回测参数优化器** —— 网格搜索 + 遗传算法，支持7种策略的参数优化、多目标加权评分、收敛曲线追踪。
- **增强型风控引擎** —— 熔断器（连续亏损/日内回撤触发自动暂停）、动态限额调整（根据回撤缩减仓位权重）、风控状态追踪与手动重置。
- **网格交易运行器** —— 实时纸面交易环境中自动执行网格策略，监听行情快照，价格穿过网格线时自动提交市价单。
- **Prometheus 指标导出** —— `/metrics` 端点提供 HTTP 请求、WebSocket 连接、账户权益、订单统计、熔断器状态等指标。
- **Grafana 仪表盘** —— Docker Compose 集成 Prometheus + Grafana 监控栈，预配置 KAIROS 交易概览仪表盘。
- **审计与交易记录导出** —— 支持 CSV（含 UTF-8 BOM）和 JSON 格式导出审计日志和订单记录。

## 可用接口

```text
GET  /api/health
GET  /api/capabilities
GET  /metrics                              (Prometheus 指标)
GET  /api/market/snapshot
GET  /api/account
GET  /api/positions
GET  /api/orders
GET  /api/orders/export?format=csv|json    (交易记录导出)
GET  /api/risk/limits
GET  /api/risk/state
POST /api/risk/reset
GET  /api/audit
GET  /api/audit/export?format=csv|json     (审计日志导出)
POST /api/orders
POST /api/trading/pause
POST /api/trading/resume
DELETE /api/orders/:orderId
WS   /ws
```

## 验证结果

```text
npm test
13 test files passed
228 tests passed (0 failures)

npm run build
TypeScript build: 1 pre-existing error (brokerAdapter.test.ts rejectionCode)
```

## 架构进展

```
server/
├── contracts/
│   ├── MarketDataProvider.ts   # 行情数据源契约（可插拔）
│   ├── BrokerAdapter.ts         # 券商适配器契约（可插拔）
│   ├── TradingStore.ts          # 交易数据持久化契约（可插拔）
│   ├── index.ts
│   └── contracts.test.ts       # 契约一致性测试（18 tests）
├── optimizer/                   # 回测参数优化器
│   ├── types.ts                 # 类型定义
│   ├── gridSearch.ts            # 网格搜索
│   ├── geneticAlgorithm.ts      # 遗传算法
│   ├── scoreUtils.ts            # 得分计算
│   ├── index.ts                 # 统一导出 + 7种策略工厂
│   └── optimizer.test.ts       # 22 tests
├── risk/
│   ├── riskEngine.ts            # 增强型风控引擎（熔断+动态限额）
│   └── riskEngine.test.ts      # 26 tests
├── broker/
│   ├── GridTradingRunner.ts     # 实时网格交易运行器
│   └── GridTradingRunner.test.ts # 网格运行器测试
├── monitoring/
│   ├── exportUtils.ts           # 审计/交易记录导出工具
│   └── exportUtils.test.ts     # 导出工具测试
├── metrics.ts                   # Prometheus 指标注册表
```

## 监控配置

```bash
# Prometheus + Grafana 监控栈
docker compose --profile monitoring up

# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3000 (admin/admin)
```

### Prometheus 指标

| 指标 | 类型 | 说明 |
|------|------|------|
| `http_requests_total` | Counter | HTTP 请求总数 |
| `http_request_duration_seconds_total` | Counter | HTTP 请求累计耗时 |
| `ws_connections` | Gauge | WebSocket 连接数 |
| `orders_total` | Counter | 订单总数 |
| `account_equity` | Gauge | 账户权益 |
| `account_cash` | Gauge | 账户现金 |
| `account_positions_count` | Gauge | 持仓数量 |
| `risk_circuit_breaker` | Gauge | 熔断器状态 (0=正常, 1=熔断) |

## 增强风控配置（环境变量）

```bash
CIRCUIT_MAX_CONSECUTIVE_LOSSES=5   # 连续亏损次数触发熔断
CIRCUIT_MAX_DAILY_DRAWDOWN=0.08    # 日内最大回撤比例触发熔断
CIRCUIT_COOLDOWN_MINUTES=15        # 熔断冷却时间（分钟）
CIRCUIT_RECOVERY_MINUTES=5         # 恢复观察期（分钟）
DYNAMIC_POSITION_SCALING=true      # 启用动态仓位缩放
MAX_DRAWDOWN_REDUCTION_FACTOR=0.25 # 最大回撤时仓位缩减至原始权重的比例
```

## 下一步

- 实现东方财富行情数据提供者，接入 A 股实时/延迟行情（已有框架，待接入真实API）。
- 实现东方财富券商适配器，对接实盘交易接口（已有框架，待填入真实交易逻辑）。
- 实现 NewsProvider 契约，抽象新闻数据源。
- 增加用户认证、账户白名单和独立审批服务。
- 前端集成网格交易运行器控制面板。

## 当前边界

- 所有行情、资金流、新闻、账户与订单数据仍是本地模拟数据。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- 当前没有真实数据供应商、事务型数据库、用户认证或券商连接。
- `REAL_TRADING_ENABLED=false`，`MARKET_MODE=live` 会拒绝启动。
- 当前没有任何真实订单执行代码。
- 新闻、资金流和分时图仍使用前端静态模拟数据。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。
