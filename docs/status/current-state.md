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
- **MarketDataProvider 契约** —— 抽象行情数据源，当前可选择 MockMarket 或 AkShare 只读行情桥接。
- **TradingStore 契约** —— 抽象交易数据持久化，支持 InMemoryTradingStore 与 JsonFileTradingStore，为 PostgreSQL 存储预留插槽。
- **BrokerAdapter 契约** —— 当前仅用于模拟网络连接；所有订单仍委托 PaperBroker，不包含真实券商执行。
- PaperBroker 通过契约接口依赖注入，不绑定具体实现。
- 契约一致性测试，确保任意实现类符合契约约定。
- **回测参数优化器** —— 网格搜索 + 遗传算法，支持7种策略的参数优化、多目标加权评分、收敛曲线追踪。
- **增强型风控引擎** —— 熔断器（连续亏损/日内回撤触发自动暂停）、动态限额调整（根据回撤缩减仓位权重）、风控状态追踪与手动重置。
- **网格交易运行器** —— 实时纸面交易环境中自动执行网格策略，监听行情快照，价格穿过网格线时自动提交市价单。
- **Prometheus 指标导出** —— `/metrics` 端点提供 HTTP 请求、WebSocket 连接、账户权益、订单统计、熔断器状态等指标。
- **Grafana 仪表盘** —— Docker Compose 集成 Prometheus + Grafana 监控栈，预配置 KAIROS 交易概览仪表盘。
- **审计与交易记录导出** —— 支持 CSV（含 UTF-8 BOM）和 JSON 格式导出审计日志和订单记录。
- **OpenAPI 契约** —— Swagger UI 位于 `/documentation`，JSON 文档位于 `/documentation/json`。
- **能力声明** —— `/api/capabilities` 明确返回行情来源、只读属性、纸面执行和凭据边界。
- **真实只读行情模式** —— `MARKET_DATA_PROVIDER=akshare` 与 `MARKET_MODE=paper` 可使用 AkShare 行情驱动本地模拟账户。
- **东方财富只读行情原型** —— `EastMoneyMarketProvider` 可读取公开行情并拒绝 `live`，当前尚未接入主服务的 `MARKET_DATA_PROVIDER` 选择器。
- **东方财富纸面适配器** —— `EastMoneyBrokerAdapter` 不发送外部订单，订单、费用、风控、幂等和账户状态全部委托标准 `PaperBroker` 运行时。
- **认证安全原型** —— `server/auth.ts` 提供显式配置、短期 HMAC 令牌和恒定时间凭据比较，但尚未注册到主 Fastify 服务，不保护当前 API。
- **三服务调试** —— VS Code 可同时启动 FastAPI 行情桥接、Fastify 纸面交易后端和 React 前端。

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
GET  /documentation                       (Swagger UI)
GET  /documentation/json                  (OpenAPI JSON)
```

## 验证结果

```text
npm test
24 test files passed
455 tests passed (0 failures)

npm run build
TypeScript checks and Vite production build passed

python -m pytest akshare-bridge/test_bridge.py -q
10 tests passed
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

- 实现 NewsProvider 契约，抽象新闻数据源。
- 将认证原型装配到 API，并增加账户白名单、角色权限和独立审批服务。
- 前端集成网格交易运行器控制面板。
- PostgreSQL 替代 JSON 文件持久化。
- 评估券商官方模拟环境或沙箱，继续禁止连接真实资金。

## 当前边界

- 默认行情、资金流、新闻、账户与订单数据仍是本地模拟数据；可选 AkShare 行情是只读外部数据。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- 当前没有事务型数据库或已启用的用户认证，也没有真实账户连接或真实券商执行。
- 认证原型没有默认账号、默认密码或默认 JWT 密钥；缺少显式安全配置时必须拒绝注册。
- `REAL_TRADING_ENABLED=true` 与 `MARKET_MODE=live` 都会拒绝启动。
- AkShare 模式必须使用 `MARKET_MODE=paper`，真实行情不改变订单执行权限。
- 当前没有任何真实订单执行代码。
- 新闻、资金流和分时图仍使用前端静态模拟数据。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。
