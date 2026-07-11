# 系统架构

## 当前结构

```text
React + TypeScript :4173
React Router + TanStack Query
        │ REST / WebSocket
        ▼
Fastify + TypeScript :8787
        │
        ├─ MarketDataProvider
        │   ├─ MockMarket               确定性模拟行情
        │   └─ AkShareMarketProvider    只读外部行情
        ├─ RiskEngine       下单前风险检查
        ├─ PaperBroker      模拟撮合与账户更新
        └─ TradingStore     内存或本地 JSON 状态

FastAPI + AkShare :8800
        └─ 只读行情桥接，无账户和订单接口
```

前后端共享 `shared/trading.ts` 中的行情、账户、持仓、订单、风险和实时事件契约。

`server/broker/eastmoney/` 还包含未装配到主服务的东方财富公开行情原型。其行情提供者只读且拒绝 `live`；同目录的券商适配器仅模拟连接生命周期，所有纸面订单继续委托 `PaperBroker + RiskEngine`，不包含外部订单请求。`server/broker/tonghuashun/` 提供同花顺模拟盘纸面适配器骨架，同样只允许 `paper` 或 `sandbox`，用于后续接入同花顺模拟账户前验证连接、行情注入、风控和模拟订单事件。

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
  broker/        PaperBroker 模拟撮合、受控纸面适配器与只读行情原型
  market/        MockMarket、HTTP 与 AkShare 只读行情适配器
  realtime/      WebSocket 连接与广播
  risk/          风险规则
  store/         内存与本地 JSON 交易状态
  contracts/     行情和交易仓储适配器契约
  auth.ts        未装配的显式配置认证原型
  app.ts         Fastify 插件、路由和事件装配
  config.ts      Zod 环境变量校验
  index.ts       服务进程入口

shared/
  trading.ts     前后端稳定交易契约
```

## 依赖方向

- React 组件只能通过 `tradingApi` 和 `useTradingBackend` 访问服务端，不直接依赖存储或券商实现。
- React Router 只负责视图 URL；TanStack Query 保存 REST 快照，WebSocket 和交易 mutation 增量更新同一缓存。
- `PaperBroker` 依赖行情、风险和仓储，不依赖 HTTP、WebSocket 或 React。
- `RiskEngine` 只依赖共享领域数据，不产生网络或存储副作用。
- `InMemoryTradingStore` 是默认实现，`JsonFileTradingStore` 只用于本地单进程恢复；两者都不是未来数据库模型的替代品。
- `shared/` 只保存跨进程契约，不包含浏览器或 Node.js 运行时副作用。
- 行情读取和订单执行保持为不同模块与未来不同权限域。
- `server/auth.ts` 当前不由 `app.ts` 注册；未来启用必须显式注入账号、密码和至少 32 字符的密钥，并为真实执行使用独立身份提供商和会话策略。

## 运行时数据流

1. `MARKET_DATA_PROVIDER` 选择 `MockMarket` 或 `AkShareMarketProvider`。
2. AkShare 模式通过 FastAPI 桥接读取行情，且必须使用 `MARKET_MODE=paper`。
3. Fastify 将行情通过 `/ws` 广播给 React。
4. React 通过 `POST /api/orders` 提交带客户端幂等键的模拟订单。
5. `RiskEngine` 检查交易状态、标的、整手、额度、仓位、亏损和资金。
6. `PaperBroker` 只在检查通过后计算滑点、手续费和模拟成交。
7. 当前选定的 `TradingStore` 更新现金、持仓、订单和审计事件。
8. 新账户、持仓和订单状态再次通过 WebSocket 推送。

Fastify 使用 Helmet 设置基础安全响应头，并使用 Rate Limit 对 HTTP 请求进行全局限流。统一错误处理必须保留插件产生的 4xx 状态，不能把 429 改写为 500。
Fastify 使用 Swagger/OpenAPI 发布当前 API 契约，并通过 `/api/capabilities` 声明只读行情与纸面执行边界。

## 面向真实数据的适配器

### `MarketDataProvider`

当前可使用 MockMarket 或 AkShare 桥接。外部行情必须保留来源、授权、时间戳、交易日历、时区和复权语义；上层逻辑不得直接绑定单一供应商返回格式。

### `NewsProvider`

未来提供原始来源、发布时间、抓取时间、关联标的和去重依据。

### `ExecutionGateway`

真实券商执行必须是独立实现和独立部署的权限域，不能把 `PaperBroker` 改一个配置就升级为实盘。真实执行需要账户白名单、逐笔批准、额度、幂等、审计、撤单和紧急停止。

### `BrokerAdapter`

当前 `MockBrokerAdapter`、`EastMoneyBrokerAdapter` 与 `TongHuaShunPaperAdapter` 都只用于模拟网络连接和异步调用，订单、费用、幂等和风控全部委托给 `PaperBroker`。它们都拒绝 `live` 环境；东方财富和同花顺纸面适配器不调用任何外部订单端点，且当前未装配到主交易系统。配置只保存服务端 `credentialsRef`，不接受浏览器或源码中的明文 Token。未来真实执行适配器不能以替换这些模拟类或修改模式开关的方式直接启用，仍必须经过独立审批与执行网关。

## 关键质量属性

- **确定性**：固定输入、参数和版本应得到相同结果。
- **可审计**：结果能追溯到数据、参数、代码版本和执行时间。
- **时间安全**：计算只能使用决策时点已经可获得的信息。
- **权限隔离**：只读研究能力与订单执行能力分离。
- **可替换性**：外部数据、持久化和券商通过边界明确的适配器替换。
- **默认拒绝**：未实现或未授权的真实交易模式必须在启动和下单前失败。
