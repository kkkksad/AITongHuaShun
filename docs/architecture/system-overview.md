# 系统架构

## 当前结构

```text
React + TypeScript :4173
        │ REST / WebSocket
        ▼
Fastify + TypeScript :8787
        │
        ├─ MockMarket       确定性模拟行情
        ├─ RiskEngine       下单前风险检查
        ├─ PaperBroker      模拟撮合与账户更新
        └─ InMemoryStore    订单、持仓与审计事件
```

前后端共享 `shared/trading.ts` 中的行情、账户、持仓、订单、风险和实时事件契约。

## 当前模块

```text
src/
  components/    导航、策略、图表、新闻、账户与审批组件
  data/          尚未接入后端的静态模拟数据
  hooks/         后端启动快照、WebSocket 和交易操作状态
  lib/           回测、指标和 HTTP API 客户端
  styles/        响应式设计系统
  types/         前端研究领域类型

server/
  broker/        PaperBroker 模拟撮合
  market/        MockMarket 模拟行情
  realtime/      WebSocket 连接与广播
  risk/          风险规则
  store/         内存交易状态与审计
  app.ts         Fastify 插件、路由和事件装配
  config.ts      Zod 环境变量校验
  index.ts       服务进程入口

shared/
  trading.ts     前后端稳定交易契约
```

## 依赖方向

- React 组件只能通过 `tradingApi` 和 `useTradingBackend` 访问服务端，不直接依赖存储或券商实现。
- `PaperBroker` 依赖行情、风险和仓储，不依赖 HTTP、WebSocket 或 React。
- `RiskEngine` 只依赖共享领域数据，不产生网络或存储副作用。
- `InMemoryTradingStore` 是当前状态实现，不是未来数据库模型的替代品。
- `shared/` 只保存跨进程契约，不包含浏览器或 Node.js 运行时副作用。
- 行情读取和订单执行保持为不同模块与未来不同权限域。

## 运行时数据流

1. `MockMarket` 使用固定随机状态生成可复现的行情 Tick。
2. Fastify 将行情通过 `/ws` 广播给 React。
3. React 通过 `POST /api/orders` 提交带客户端幂等键的模拟订单。
4. `RiskEngine` 检查交易状态、标的、整手、额度、仓位、亏损和资金。
5. `PaperBroker` 只在检查通过后计算滑点、手续费和模拟成交。
6. `InMemoryTradingStore` 更新现金、持仓、订单和审计事件。
7. 新账户、持仓和订单状态再次通过 WebSocket 推送。

## 面向真实数据的适配器

### `MarketDataProvider`

未来提供带来源、授权、时间戳、交易日历、时区和复权语义的行情。上层逻辑不得直接绑定 AkShare、Tushare Pro 或单一供应商返回格式。

### `NewsProvider`

未来提供原始来源、发布时间、抓取时间、关联标的和去重依据。

### `ExecutionGateway`

真实券商执行必须是独立实现和独立部署的权限域，不能把 `PaperBroker` 改一个配置就升级为实盘。真实执行需要账户白名单、逐笔批准、额度、幂等、审计、撤单和紧急停止。

## 关键质量属性

- **确定性**：固定输入、参数和版本应得到相同结果。
- **可审计**：结果能追溯到数据、参数、代码版本和执行时间。
- **时间安全**：计算只能使用决策时点已经可获得的信息。
- **权限隔离**：只读研究能力与订单执行能力分离。
- **可替换性**：外部数据、持久化和券商通过边界明确的适配器替换。
- **默认拒绝**：未实现或未授权的真实交易模式必须在启动和下单前失败。
