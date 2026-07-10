# 当前状态

**核对日期：** 2026-07-11

## 已实现

- React 19 + TypeScript + Vite 响应式量化研究工作台。
- React Router 管理总览、策略实验室、市场观察、模拟账户和研究管线五个可直达 URL。
- TanStack Query 统一管理 REST 启动快照、WebSocket 增量事件和交易 mutation 结果。
- 模拟账户包含持仓分析、交易下单、订单历史和风控面板。
- 固定种子的确定性回测、净值曲线、基准曲线、交易记录和风险指标。
- 均线、RSI、布林带、动量、网格、MACD 和海龟策略，以及网格搜索和遗传算法参数优化器。
- Fastify + TypeScript 本地服务，提供 REST API 与 WebSocket 实时通道。
- WebSocket 心跳监测和指数退避重连。
- Fastify Helmet 安全响应头和全局 Rate Limit 限流。
- 确定性模拟行情，每秒推送指数和可交易股票报价。
- 可切换的内存或本地 JSON 模拟账户、持仓、订单、成交、手续费、滑点和审计事件。
- 模拟市价单、限价单挂单与撤销、客户端订单 ID 幂等、暂停和恢复撮合。
- 单笔金额、单标的仓位、整手数量、每日亏损和可用资金检查。
- Zod 环境变量与订单请求校验。
- VS Code 前后端复合断点调试。
- `MarketDataProvider` 行情数据源契约与 Mock、HTTP 适配器。
- `TradingStore` 持久化契约与内存、JSON 文件实现。
- `BrokerAdapter` 连接契约与 `MockBrokerAdapter` 模拟网络实现。
- `MockBrokerAdapter` 只代理 `PaperBroker`，不复制撮合、费用或风控逻辑，并拒绝 `live` 环境。

## 可用接口

```text
GET  /api/health
GET  /api/market/snapshot
GET  /api/account
GET  /api/positions
GET  /api/orders
GET  /api/risk/limits
GET  /api/audit
POST /api/orders
POST /api/trading/pause
POST /api/trading/resume
DELETE /api/orders/:orderId
WS   /ws
```

## 验证结果

```text
npm test
11 test files passed
173 tests passed

npm run build
TypeScript build passed
Vite production build passed
```

## 当前边界

- 所有行情、资金流、新闻、账户与订单数据仍是本地模拟数据。
- `HttpMarketProvider` 只是经过测试的适配器，还没有配置任何真实数据供应商。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- 当前没有事务型数据库、用户认证、审批服务、密钥管理或真实券商连接。
- `REAL_TRADING_ENABLED=false`，`MARKET_MODE=live` 会拒绝启动。
- `MockBrokerAdapter` 在 `environment=live` 时会拒绝构造。
- 当前没有任何真实订单执行代码。
- 新闻、资金流和部分分时展示仍使用前端静态模拟数据。
- 工作区中未提交的外部券商实验文件不属于当前已实现能力，也未纳入本次提交。

## 下一步

- 优先接入带来源、授权、时区和更新时间的只读历史或延迟行情。
- 引入 PostgreSQL 保存实验、订单、审计与数据版本元信息。
- 增加用户认证、角色权限、账户白名单和独立逐笔审批服务。
- 只在上述控制完成后评估官方券商模拟环境或沙箱。
- 真实执行必须作为独立项目、独立部署和独立权限域评估。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。
