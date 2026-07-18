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
        ├─ MarketDataQuality  行情覆盖、新鲜度与异常只读诊断
        ├─ RequestTelemetry   有界路由性能与失败诊断
        ├─ PaperAutoExecutor  本地 paper 计划自动执行
        ├─ RiskEngine       下单前风险检查
        ├─ PaperBroker      模拟撮合与账户更新
        └─ TradingStore     内存或本地 JSON 状态

FastAPI + AkShare :8800
        ├─ 实时个股与指数快照
        ├─ 全 A 股名称/代码搜索（内存行情缓存）
        ├─ 财新/央视/东方财富多源新闻与全球指数
        ├─ 行业板块、行业日线与个股日线
        ├─ 受控全球指数历史、A 股指数历史与 BTC/ETH 快照
        ├─ 国内期货主连快照与连续日线
        └─ 新股申购与上市记录（只读，无账户和订单接口）
```

前后端共享 `shared/trading.ts` 中的行情、账户、持仓、订单、风险和实时事件契约。

`server/market/dataQuality.ts` 是行情质量的唯一计算入口。它按请求股票池计算有效覆盖，使用整批报价低 10% 分位新鲜度避免单条最新报价掩盖陈旧批次，并把合法主板、创业板、科创板和北交所涨跌停与越界价格异常分开。`/api/market/quality` 只读取当前内存快照，不触发外部抓取；浏览器只在后端连接时轮询该接口。

`server/monitoring/requestTelemetry.ts` 在每个 Fastify 应用实例内按路由模板聚合最近耗时。它最多保留 64 条路由、每路由 128 个样本，路由满时淘汰最久未更新项；只统计方法、路由模板、状态、耗时和时间，不保存查询值、请求/响应正文或凭据。`/api/system/performance` 把该窗口与当前内存行情质量和 WebSocket 状态组合，不触发外部请求。

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
  research/      策略排行、真实稳健性、跨市场状态、外盘影响/紧凑特征、候选池、板块/形态研究、纸面计划与 SuperMind 信号包
  monitoring/    日志查询、导出与有界 API 请求遥测
  notifications/ WxPusher 四时点简报、重要事件去重与十条发送预算
  trading/       本地 paper 自动执行器
  realtime/      WebSocket 连接与广播
  risk/          风险规则
  store/         内存与本地 JSON 交易状态
  contracts/     行情和交易仓储适配器契约
  auth.ts        scrypt 密码验证、可撤销会话、Cookie 与 CSRF
  app.ts         Fastify 插件、路由和事件装配
  config.ts      Zod 环境变量校验
  index.ts       服务进程入口

shared/
  trading.ts     前后端稳定交易契约
```

## 依赖方向

- React 组件只能通过 `tradingApi` 和 `useTradingBackend` 访问服务端，不直接依赖存储或券商实现。
- React Router 只负责视图 URL；TanStack Query 保存 REST 快照，WebSocket 和交易 mutation 增量更新同一缓存。
- `src/lib/researchQueries.ts` 是重复研究请求的 Query Key、stale 时间和轮询策略唯一入口；展示位置不得再进入同参数请求的缓存键。
- `PaperBroker` 依赖行情、风险和仓储，不依赖 HTTP、WebSocket 或 React。
- `PaperAutoExecutor` 只读取纸面计划并向 `PaperBroker` 提交本地模拟订单；它不能调用真实券商、同花顺、SuperMind 或浏览器自动化能力。
- `RiskEngine` 只依赖共享领域数据，不产生网络或存储副作用。
- `InMemoryTradingStore` 是默认实现，`JsonFileTradingStore` 只用于本地单进程恢复；两者都不是未来数据库模型的替代品。
- `shared/` 只保存跨进程契约，不包含浏览器或 Node.js 运行时副作用。
- 行情读取和订单执行保持为不同模块与未来不同权限域。
- `server/auth.ts` 由 `app.ts` 默认注册；浏览器只能通过 `HttpOnly` Cookie 使用服务端会话，业务 API、指标、文档和 WebSocket 不得建立匿名旁路。当前内存会话只支持单实例；真实执行仍必须使用独立身份提供商和权限域。

## 运行时数据流

1. React 启动时验证服务端会话；未登录时只渲染登录页，不启动业务 REST 或 WebSocket。
2. `MARKET_DATA_PROVIDER` 选择 `MockMarket` 或 `AkShareMarketProvider`。
3. AkShare 模式通过 FastAPI 桥接读取行情，且必须使用 `MARKET_MODE=paper`。
4. `/api/market/quality` 对当前内存快照生成只读质量报告，使用私有 5 秒缓存和 15 秒 stale-while-revalidate；它不触发新的行情请求，也不写入策略或订单状态。
5. Fastify 在请求完成时同时更新 Prometheus 累计指标和应用实例级有限遥测；`/api/system/performance` 自身、健康检查、认证和指标端点不进入业务性能窗口。
6. `/api/research/real-data-feed` 优先选择当前持仓，再按实时成交额补足最多 8 只新闻观察标的，并聚合最多 80 条多源新闻；`/api/research/market-regime` 通过桥接读取有界行业/个股历史日线；`/api/research/stock-trend` 先按名称或代码解析单只 A 股，再读取默认 360 日、最多 500 日前复权日线；`/api/research/strategy-robustness` 用固定参数运行三个不重叠真实窗口；`/api/research/cross-market-strategy-context` 组合全球指数与国内期货主连；`/api/research/external-market-impact` 严格用早于 A 股目标日期的美股/亚洲指数日线和沪深 300 对齐，并把 BTC/ETH 限制为快照参考；`/api/research/ipo-subscriptions` 读取有界新股表。这些路径都只读且不接触账户或订单。
7. Fastify 验证会话 Cookie 与 WebSocket 来源后，将行情通过 `/ws` 广播给 React。
8. React 通过带 Cookie、CSRF 和客户端幂等键的 `POST /api/orders` 提交模拟订单；或 `PaperAutoExecutor` 在启用后按 A 股交易时段把纸面计划提交成本地模拟订单。
9. `RiskEngine` 检查交易状态、标的、整手、额度、仓位、亏损和资金。
10. `PaperBroker` 只在检查通过后计算滑点、手续费和模拟成交。
11. 当前选定的 `TradingStore` 更新现金、持仓、订单和审计事件。
12. 新账户、持仓和订单状态再次通过已认证 WebSocket 推送。

WxPusher 通知属于 paper 观察域，不属于订单执行域。自动执行器在四个盘中阶段生成上下文，通知器只在 09:35、10:30、13:30、14:50 开放固定简报；`risk-off`、数据降级、paper 拒单或暂停可以使用事件预留。同类事件按交易日审计去重，多种事件同轮合并，全部成功/失败请求共享每天十条硬上限。

Fastify 使用 Helmet 设置基础安全响应头，并使用 Rate Limit 对 HTTP 请求进行全局限流。统一错误处理必须保留插件产生的 4xx 状态，不能把 429 改写为 500。
Fastify 使用 Swagger/OpenAPI 发布当前 API 契约，并通过 `/api/capabilities` 声明只读行情与纸面执行边界。

## 面向真实数据的适配器

### `MarketDataProvider`

当前可使用 MockMarket 或 AkShare 桥接。外部行情必须保留来源、授权、时间戳、交易日历、时区和复权语义；上层逻辑不得直接绑定单一供应商返回格式。

质量报告中的完整度以请求标的数量为分母，缺失和无效报价都会扣分；新鲜度取低 10% 分位而不是整批最大值。合法涨跌停只记录市场状态，超出对应板块涨跌停范围的非停牌价格才进入越界异常。`healthy / degraded / unusable` 只用于界面诊断，不能改变 `AdaptiveStrategyRouter`、`PaperAutoExecutor`、风险限额或订单审批。

历史研究接口按请求即时读取并在 Python 进程内短期缓存，不会把无上限原始日线写入本地磁盘。普通研究响应和历史单序列分别使用有界 TTL/LRU，默认最多 64 和 128 个 key；读写路径主动清理过期项，历史 single-flight 请求完成前受淘汰保护。行业日线明确为不复权，个股日线明确为前复权；单次请求受板块数、股票数和交易日数限制。多个公开源只用于可用性回退，每条历史序列保留实际命中的来源。

运行日志与交易状态属于不同存储边界。开发启动前的清理器只处理仓库内 `logs/*.log`，按保留天数、单文件大小和目录总大小执行；`data/` 下的 paper 账户、持仓、开放订单和审计留存继续由 `TradingStore` 独立管理，日志清理器不得访问。

国内期货只允许服务端白名单中的 16 个主连代码。快照优先使用 AkShare 新浪批量接口，当前版本字段不兼容时回退到同一新浪结构化接口；历史使用主力连续日线并标记 `continuous-main`。Fastify 只把这些数据组合成风险基调和策略族上下文，浏览器不直接访问桥接，结果也不进入订单域。

外部市场影响模块按“美股隔夜、亚洲市场、数字资产”分组。历史对齐只选择严格早于 A 股目标交易日的外部收盘，防止用同日尚未完成的亚洲收盘解释盘前决策；BTC/ETH 没有同口径历史时只保留当前 24 小时快照，不能独立产生 A 股方向。至少 60 个样本才展示历史统计，至少 250 个样本、三个窗口和方向命中改善门槛通过后也只产生 `shadow` 对比字段，正式路由的置信度、新增仓位许可和仓位上限保持不变。

可选的外盘特征采样器只允许在 `paper + akshare` 模式启用：北京时间 09:20 写入当时可见的紧凑特征，15:10 给同一交易日补沪深 300 日标签。文件默认最多 750 行，采用临时文件加原子重命名，损坏 JSON 会隔离为 `.corrupt-<timestamp>`；不保存原始响应、tick、分钟线或凭据。

单股趋势研究由 `server/research/stockTrendForecast.ts` 独立负责。每个历史决策点只使用当时及之前的收盘、均线、动量、RSI、波动、ATR 和量能特征，再读取之后 3/5/10 个交易日收盘做验证；当前规则分与历史命中率是两个独立字段，不得把命中率回填为当前上涨概率。前端只通过受保护 Fastify 接口访问，不直接调用 AkShare 桥。

### `NewsProvider`

当前桥接尚未抽成独立 `NewsProvider` 接口，但已用统一新闻契约归一化财新、央视和东方财富：每条保留来源、发布时间、抓取时间、关联标的、分类、短摘要、URL 和稳定去重 ID。Fastify 会对滚动升级期间的旧桥接响应做第二层去重，并优先排列当前持仓相关新闻。非空批次只在 Python 进程内缓存 15 分钟，不保存全文；正式 Provider 契约、授权记录、历史 point-in-time 新闻数据集和实体识别仍待后续实现。

### `IpoResearchProvider`

当前由 AkShare 桥接归一化东方财富新股申购表，Fastify 负责北京时间窗口、状态分类和时间安全评分。发行价、发行市盈率或行业市盈率缺失时必须等待定价；上市后涨幅只能展示，不能回填申购建议。该模块不读取账户市值、交易权限或资金规则，也没有申购执行接口。

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
- **数据可观察性**：真实快照缺失、陈旧或异常时必须显式降级，不得用静态行情掩盖。
- **性能可观察性**：慢接口和服务端失败必须能按路由模板定位，同时保持统计有界且不保存敏感请求内容。
