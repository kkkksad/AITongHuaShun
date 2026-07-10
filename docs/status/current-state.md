# 当前状态

**核对日期：** 2026-07-11

## 已实现

- React + TypeScript + Vite 响应式量化研究工作台。
- 总览、策略实验室、市场观察、模拟账户和研究管线五个视图。
- 固定种子的确定性回测、净值曲线、基准曲线、交易记录和风险指标。
- Fastify + TypeScript 本地服务，提供 REST API 与 WebSocket 实时通道。
- 确定性模拟行情，每秒推送指数和可交易股票报价。
- 内存模拟账户、持仓、订单、成交、手续费、滑点和审计事件。
- 模拟市价单、限价单挂单与撤销、客户端订单 ID 幂等、暂停和恢复撮合。
- 单笔金额、单标的仓位、整手数量、每日亏损和可用资金检查。
- React 页面通过 API 和 WebSocket 显示实时模拟行情、权益、持仓和订单。
- Zod 环境变量与订单请求校验。
- VS Code 前后端复合断点调试。
- 回测、风险引擎、模拟券商和 Fastify API 的 Vitest 测试。
- **MarketDataProvider 契约** —— 抽象行情数据源，支持 MockMarket 实现，为接入 AkShare/Tushare/券商行情网关预留插槽。
- **TradingStore 契约** —— 抽象交易数据持久化，支持 InMemoryTradingStore 实现，为 PostgreSQL 存储预留插槽。
- PaperBroker 通过契约接口依赖注入，不绑定具体实现。
- 契约一致性测试，确保任意实现类符合契约约定。

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
5 test files passed
42 tests passed

npm run build
TypeScript build passed
Vite production build passed
```

## 当前边界

- 所有行情、资金流、新闻、账户与订单数据仍是本地模拟数据。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 交易状态只保存在内存中，服务重启后会恢复初始模拟账户。
- 当前没有真实数据供应商、持久化数据库、用户认证或券商连接。
- `REAL_TRADING_ENABLED=false`，`MARKET_MODE=live` 会拒绝启动。
- 当前没有任何真实订单执行代码。
- 新闻、资金流和分时图仍使用前端静态模拟数据。

## 架构进展

```
server/contracts/
├── MarketDataProvider.ts   # 行情数据源契约（可插拔）
├── TradingStore.ts          # 交易数据持久化契约（可插拔）
├── index.ts                 # 统一导出
└── contracts.test.ts       # 契约一致性测试（18 tests）
```

## 下一步

- 实现 NewsProvider 契约，抽象新闻数据源。
- 引入 PostgreSQL / SQLite 实现 TradingStore 接口。
- 接入带来源、时间戳和授权记录的真实历史或延迟行情。
- 增加用户认证、账户白名单和独立审批服务。
- 为主要 React 交互增加组件与端到端测试。
- 按视图动态加载 Recharts，降低首屏 bundle。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。
