# 系统架构

固定现金预留与分时总仓位比例默认已按 [决策0010](../decisions/0010-no-fixed-paper-cash-reserve.md) 取消；`cashReserveRatio` / `cashReserveFloor` 内置值为0，`capitalPacing` / `maxInvestedRatio` 兼容值为1。阶段累计订单笔数仍单独限制，不能将这些兼容字段重新解释成必须持有现金。

限价挂单的现金冻结只属于买单；卖单通过Broker的同标的待卖数量预占检查限制持仓，不占用现金，也不能释放其他买单的冻结。InMemory与JSON保持该方向规则一致；JSON载入从待买单重建冻结，不信任旧缓存数值。

执行成本按[决策0014](../decisions/0014-paper-execution-cash-costs.md)统一：Store保留本金冻结，Broker派生挂单必要费用补差并对外扣除；回测上下文/曲线也经Broker读取。每次实际撮合先保留其他待买完整预算，再核验本单含佣金现金流，Store修改前作独立余额兜底；不增加固定比例或迁移订单字段/JSON版本。

单股暴露按[决策0017](../decisions/0017-paper-pending-buy-position-exposure.md)在提交时累计同股待买名义金额，成交前按同快照实际持仓和本单真实成本投影费用后权益。每单先现金后仓位、逐单读取已成交账；不同股和待卖不混算，旧超承诺逐笔拒绝超限部分，不自动缩单或提高额度。

Paper暂停保留已有挂单及预占，行情估值/account事件和主动撤单仍可使用；每笔匹配及同步Store/Risk回调后、实际状态修改前复核pause，不因暂停拒绝或取消旧挂单。恢复只切换状态，下一次行情才继续匹配；新提交仍由现有Risk拒绝，不加入待成交队列。

账户累计`realizedPnl`按[决策0015](../decisions/0015-account-net-realized-pnl.md)从总现金、剩余持仓成交成本和初始权益派生，已付买卖费用即时计入，清仓/重开/历史裁剪不丢累计净结果；挂单预算不是费用。持仓级字段与研究FIFO定义独立保留，不能求当前持仓已实现之和代替账户累计。

WebSocket每次认证握手除市场/账户/持仓外还发送`orders.snapshot`最近50笔，等同浏览器bootstrap的显式订单读取上限。初始化/刷新按[决策0016](../decisions/0016-bootstrap-realtime-read-windows.md)合并本轮已收到的更新，首读失败保留未落地事件；旧生命周期/socket不能回写。缺完整订单快照时兼容增量有界缓冲，溢出仅补读一次并诚实显示失败，不提供服务端绝对全序保证。

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

前后端共享 `shared/trading.ts` 中的行情、账户、持仓、订单、风险和实时事件契约。`AccountSnapshot.dailyPnl*` 是兼容旧客户端的历史字段名，当前存储语义是账户重置以来累计结果；交易日收益由每日复盘按昨收和当日成交独立重建。

`server/market/dataQuality.ts` 是行情质量的唯一计算入口。它按请求股票池计算有效覆盖，使用整批报价低 10% 分位新鲜度避免单条最新报价掩盖陈旧批次，并把合法主板、创业板、科创板和北交所涨跌停与越界价格异常分开。`/api/market/quality` 只读取当前内存快照，不触发外部抓取；浏览器只在后端连接时轮询该接口。

`server/monitoring/requestTelemetry.ts` 在每个 Fastify 应用实例内按路由模板聚合最近耗时。它最多保留 64 条路由、每路由 128 个样本，路由满时淘汰最久未更新项；只统计方法、路由模板、状态、耗时和时间，不保存查询值、请求/响应正文或凭据。`/api/system/performance` 把该窗口与当前内存行情质量和 WebSocket 状态组合，不触发外部请求。

`server/broker/eastmoney/` 还包含未装配到主服务的东方财富公开行情原型。其行情提供者只读且拒绝 `live`；同目录的券商适配器仅模拟连接生命周期，所有纸面订单继续委托 `PaperBroker + RiskEngine`，不包含外部订单请求。`server/broker/tonghuashun/` 提供同花顺模拟盘纸面适配器骨架，同样只允许 `paper` 或 `sandbox`，用于后续接入同花顺模拟账户前验证连接、行情注入、风控和模拟订单事件。

## 当前模块

```text
src/
  components/    导航、策略、图表、新闻、账户与审批组件
  data/          尚未接入后端的静态模拟数据
  hooks/         后端启动快照、WebSocket 和交易操作状态
  lib/           回测、指标、HTTP API 客户端与模块目录
  styles/        响应式设计系统
  types/         前端研究领域类型

server/
  broker/        PaperBroker 模拟撮合、受控纸面适配器与只读行情原型
  market/        MockMarket、HTTP 与 AkShare 只读行情适配器
  research/      策略排行、真实稳健性、跨市场状态、板块脉冲、外盘影响/紧凑特征、候选池、板块/形态研究、纸面计划与 SuperMind 信号包
  monitoring/    日志查询、导出与有界 API 请求遥测
  notifications/ WxPusher 六检查点 Paper 简报、成交回执、行情异动与发送审计
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
- React Router 只负责视图 URL；`src/lib/moduleCatalog.ts` 是主页面和二级模块导航、搜索关键词与 query 深链接的唯一目录，TanStack Query 保存 REST 快照，WebSocket 和交易 mutation 增量更新同一缓存。
- `src/lib/researchQueries.ts` 是重复研究请求的 Query Key、stale 时间和轮询策略唯一入口；展示位置不得再进入同参数请求的缓存键。
- 浏览器研究 GET 必须把 TanStack Query 的 `AbortSignal` 传给 `tradingApi`；取消只终止已经离开视图的浏览器读取，不得影响服务端行情轮询、外盘采样或 paper 自动执行器。
- `server/research/bridgeRequest.ts` 是研究域访问 AkShare 桥的唯一请求实现，统一负责 Token 头、超时、HTTP `detail` 截断、网络错误和 JSON 校验；领域模块只把稳定错误语义写入自己的降级报告。
- `PaperBroker` 依赖行情、风险和仓储，不依赖 HTTP、WebSocket 或 React。已有挂单撮合跳过明确tradable=false的报价，保留预约与行情估值，后续可交易报价再检查；缺字段旧快照兼容。
- `PaperAutoExecutor` 的BUY预检复用Broker的executionCosts/hasSufficientCash，按相同滑点、价格/佣金舍入和累计cashDebit预算；不靠0.001现金容差放行真实不足。
- `PaperAutoExecutor` 只读取纸面计划并向 `PaperBroker` 提交本地模拟订单；它不能调用真实券商、同花顺、SuperMind 或浏览器自动化能力。
- `PaperAutoExecutor` 将计划构建或上游研究暂不可用转换为可审计的 `not-run` 观察轮次；定时任务使用完成后调度，上一轮结束后才开始计算下一间隔。启动时空行情不得形成未处理拒绝或终止 Fastify 进程。
- `AdaptiveStrategyRouter` 直接路由与降级稳定是两个阶段：只有同一交易日已确认的 `risk-off` 或 `risk-off-recovery` 可在真实历史研究短暂降级为 `unclear` 时保留防守标签；稳定阶段必须禁用新增仓位、使用 `hold` 姿态，不得依据缺失历史继续普通减仓。旧70%现金储备政策已由决策0010取代；外盘 shadow 和跨日审计不能成为稳定输入。
- `auto` 执行策略继续由 `AdaptiveStrategyRouter` 决定新增仓位资格和缩放；17 个固定 Paper 策略按自身 setup 生成候选，不使用市场路由的 `allowNewPositions` 或 `newPositionScale`。手动模式仍必须通过策略档位、真实历史、流动性、追高、费用、现金、仓位、整手、T+1、熔断、阶段预算、每日上限、幂等和 PaperBroker 风控；`capital-preservation` 继续禁止新增仓位。
- 每日复盘从自动执行审计中优先选择最近的有效盘中决策，盘后启动产生的 `not-run` 不能覆盖同日 `open` 交易时段形成的计划质量和跳过原因。没有盘中证据且没有订单时必须返回运行覆盖缺口；行情快照日期与复盘日不一致时，不得使用旧宽度、指数或累计账户结果替代当日证据。
- `paperTradingPlanService` 在发起真实历史研究前同步生成有界候选，将当前持仓、强势回踩候选和优质股候选按优先级去重后放入最多 12 只历史股票池；`paperTradingPlan` 只允许通过历史持续性、往返佣金和同日回补检查的候选形成新增仓位。
- `RiskEngine` 只依赖共享领域数据，不产生网络或存储副作用。
- `InMemoryTradingStore` 是默认实现，`JsonFileTradingStore` 只用于本地单进程恢复；两者都实现账户重置和策略档位持久化，但都不是未来数据库模型的替代品。
- Store读取不缓存账户或持仓快照。空持仓直接返回空数组；非空持仓每次读取注入时钟，仅在精确毫秒相同时复用交易日格式化字符串，时间前进或回拨均重新计算，行情与账户值始终重新估值。
- `BacktestEngine`每bar先撮合并按Broker实际顺序记录此前挂单的成交，再生成策略账户/持仓context；当前bar的批信号仍共享该context。返回的权益曲线、成交元素及配置与引擎隔离，同引擎再次run不能清空或改写旧报告；同bar成交价格、费用、T+1及初始权益点模型不变。
- 合成回测的`TurtleStrategy`仅用当前价格之前完整N/M条观测构造入场/退出通道，比较时排除当前bar；当前行情契约未提供真实OHLC，仍沿用价格±1%的估算高低点，并保留含当前价格的均线过滤，不能解释为真实高低价海龟历史验证。
- 回测`DCAStrategy`的止盈依据目标标的实际持仓、成交均价和T+1可卖整手量，不把买入信号累加为已成交持仓，也不在卖出意图时清账；拒绝/部分卖出后下bar重新核对。均价含滑点不含佣金，止盈阈值属于价格收益，买入尝试周期保持独立。
- 回测`RSIStrategy`首次选择tradable标的后绑定到reset，仅累积该股历史；缺失/不可交易等待，不拼接其他报价。以该股实际持仓决定是否已有仓位，超买退出使用当前可卖整手；拒买不形成虚拟仓，T+1或拒卖后下一bar继续读取实际仓。RSI计算、period+1暖机、严格阈值比较与买入权重保持。
- 回测`BollingerBandsStrategy`首次tradable绑定至reset，仅追加该股历史，换序保持/缺失或不可交易等待；同样读取目标实际持仓/可卖整手，不因买卖意图翻转仓位状态；保留原period暖机、标准差参数、下轨<=买入和中轨/上轨>=退出比较，T+1或拒单后按实际仓等待/重试。
- 回测`MomentumStrategy`首次tradable绑定至reset，报价换序保持同股，缺失/不可交易等待；入场/退出比较使用排除当前bar的完整过去N/M条观测，至少N+1/M+1条才有完整通道；保留原>=/<=与买入权重。后续持仓决策读取同标的实际quantity/可卖整手，拒买不形成虚拟仓、T+1/拒卖后重读实际账；窗口与持仓两项独立验证，不宣称收益提升。
- `shared/` 只保存跨进程契约，不包含浏览器或 Node.js 运行时副作用。
- 行情读取和订单执行保持为不同模块与未来不同权限域。
- `server/auth.ts` 由 `app.ts` 默认注册；浏览器只能通过 `HttpOnly` Cookie 使用服务端会话，业务 API、指标、文档和 WebSocket 不得建立匿名旁路。当前内存会话只支持单实例；真实执行仍必须使用独立身份提供商和权限域。

## 运行时数据流

1. React 启动时验证服务端会话；未登录时只渲染登录页，不启动业务 REST 或 WebSocket。
2. `MARKET_DATA_PROVIDER` 选择 `MockMarket` 或 `AkShareMarketProvider`。
3. AkShare 模式通过 FastAPI 桥接读取行情，且必须使用 `MARKET_MODE=paper`。Fastify 行情提供者最多执行一轮在途请求，本轮完成后才安排下一轮；整轮失败有界退避并保留最后成功快照，任一路恢复后回到正常轮询周期。
4. `/api/market/quality` 对当前内存快照生成只读质量报告，使用私有 5 秒缓存和 15 秒 stale-while-revalidate；它不触发新的行情请求，也不写入策略或订单状态。
5. Fastify 在请求完成时同时更新应用实例独立的 Prometheus 累计指标和有限遥测；标签只使用已注册路由模板，未知路径统一`/__unmatched__`且不进入业务性能窗口，不保存原始URL/query。`/api/system/performance` 自身、健康检查、认证和指标端点不进入业务性能窗口。
6. `/api/research/real-data-feed` 优先选择当前持仓，再按实时成交额补足最多 8 只新闻观察标的，并聚合最多 80 条多源新闻；`/api/research/market-regime` 通过桥接读取有界行业/个股历史日线；`/api/research/stock-trend` 先按名称或代码解析单只 A 股，再读取默认 360 日、最多 500 日前复权日线；`/api/research/strategy-robustness` 用固定参数运行三个不重叠真实窗口；`/api/research/cross-market-strategy-context` 组合全球指数与国内期货主连；`/api/research/external-market-impact` 严格用早于 A 股目标日期的美股/亚洲指数日线和沪深 300 对齐；轻量 `/api/research/crypto-market` 只读取 BTC/ETH 24 小时快照并有 5 秒上限；`/api/research/ipo-subscriptions` 读取有界新股表。这些路径都只读且不接触账户或订单。
7. Fastify 验证会话 Cookie 与 WebSocket 来源后，将行情通过 `/ws` 广播给 React。
8. React 通过带 Cookie、CSRF 和客户端幂等键的 `POST /api/orders` 提交模拟订单；或 `PaperAutoExecutor` 在启用后按 A 股交易时段把纸面计划提交成本地模拟订单。
9. `RiskEngine` 检查交易状态、标的、整手、额度、仓位、亏损和资金。
10. `PaperBroker` 只在检查通过后计算滑点、手续费和模拟成交。
11. 当前选定的 `TradingStore` 更新现金、持仓、订单和审计事件。
12. 新账户、持仓和订单状态再次通过已认证 WebSocket 推送。

WxPusher 通知属于 paper 观察域，不属于订单执行域。调度器只在统一 A 股交易日历确认的真实交易日交易时段运行，并在 09:35、10:15、11:00、13:30、14:15、14:50 六个检查点各尝试一条定时 Paper 简报；事件消息最多 4 条，优先承载逐订单成交/拒单回执，其次承载真实只读行情异动。6 条定时额度和 4 条事件额度共享每日 10 条硬上限，事件发送不能挤占尚未到达的定时检查点。同一检查点、同一订单回执和同一异动冷却窗口均去重；成功与失败请求都计入尝试额度，失败不重试。服务在盘中恢复时只发送最近已到检查点，不补刷更早简报；周末、法定节假日、盘前、午休、盘后和日历覆盖外不运行。正文展示持仓、盈亏、计划及计划后仓位、主要阻塞、成交/拒单和市场风险；行情降级仍发送诚实简报。通知中的“已成交”只从 `TradingStore` 的当日订单和可核实审计重建；计划、跳过和拒绝保持独立分区，缺失的历史理由不得推断。通知失败不改变 Paper 订单、策略或风控状态。

Fastify 使用 Helmet 设置基础安全响应头，并使用 Rate Limit 对 HTTP 请求进行全局限流。统一错误处理必须保留插件产生的 4xx 状态，不能把 429 改写为 500。
Fastify 使用 Swagger/OpenAPI 发布当前 API 契约，并通过 `/api/capabilities` 声明只读行情与纸面执行边界。

## 面向真实数据的适配器

### `MarketDataProvider`

`sequence`和`marketTime`表示同一行情版本，后者只在本地生成或实际接纳非空新批次时更新；读取、重播、失败和空响应不能刷新旧数据日期。上游报价时间仍在`quotes[].updatedAt`，质量年龄使用实际时钟。Paper执行器在任何计划日期额度、幂等、通知或订单动作前拒绝日期与本轮实际交易日期不符的计划；Broker的成交、审计与T+1时钟独立。见[决策0012](../decisions/0012-market-snapshot-version-time.md)。

当前可使用 MockMarket 或 AkShare 桥接。外部行情必须保留来源、授权、时间戳、交易日历、时区和复权语义；上层逻辑不得直接绑定单一供应商返回格式。

质量报告中的完整度以请求标的数量为分母，缺失和无效报价都会扣分；新鲜度取低 10% 分位而不是整批最大值。合法涨跌停只记录市场状态，超出对应板块涨跌停范围的非停牌价格才进入越界异常。`healthy / degraded / unusable` 只用于界面诊断，不能改变 `AdaptiveStrategyRouter`、`PaperAutoExecutor`、风险限额或订单审批。

全市场股票与指数快照缓存以刷新完成时间计算默认 10 秒 TTL；失败时保留旧快照并进入最长 60 秒冷却，避免慢抓取完成后立即过期形成重试风暴。空表和不可解析批次也视为失败，不会覆盖已有快照；A 股个股和四个主要指数在既有源失败时可读取腾讯公开只读文本快照，股票备用池与生产 `MARKET_SYMBOLS` 保持一致，并保留交易所报价时间。历史研究接口按请求即时读取并在 Python 进程内短期缓存，不会把无上限原始日线写入本地磁盘。普通研究响应和历史单序列分别使用有界 TTL/LRU，默认最多 64 和 128 个 key；读写路径主动清理过期项，历史 single-flight 请求完成前受淘汰保护。历史抓取调度器默认最多接纳 24 个不同序列且最多并行处理 2 个；批次默认等待 6 秒后先返回已完成序列，其余已接纳任务继续后台预热，超出队列的序列明确返回繁忙警告。行业日线明确为不复权，个股日线明确为前复权；单次请求受板块数、股票数和交易日数限制。多个公开源只用于可用性回退，每条历史序列保留实际命中的来源，不使用静态历史填补缺口。

Fastify 的 `bridgeRequest` 是 Python 桥接缓存之外的第二层短时只读缓存。它按 URL、凭据哈希作用域和请求实现区分键，最多保留 64 个 Promise；相同在途读取只访问一次桥接，失败立即删除，过期与超限按有界顺序淘汰，缓存键不保存原始 Token。当前行情快照使用 1 至 2 分钟，历史日线使用 10 分钟，新股申购元数据使用 30 分钟；账户、持仓、订单、审计以及任何写请求不得进入该缓存。

`AdaptiveStrategyRouter` 只在至少 2 个板块和 1 只股票具备有效真实历史时把研究报告视为 `live-read-only`。次要数据源警告继续进入证据与风险标记，但不会抹去已经完成的有效历史；覆盖不足仍回退 `unclear`。Paper 候选随后必须同时匹配当前路由允许的策略键与股票历史形态，才能进入现金、整手、T+1、费用、持仓和熔断检查。

AkShare 原生调用使用单工作线程串行化，避免其 JavaScript 运行时在并发研究请求下终止桥接进程。A 股历史优先使用东方财富并回退腾讯，两者默认各使用 8 秒显式网络超时；不再调用无法传入明确超时的新浪 A 股日线第三回退。Fastify 的历史日线读取统一限制在 8 至 30 秒，不再由各研究模块放大到 60 至 360 秒。BTC/ETH 的 Jin10、Binance 与 CoinGecko 公共 JSON 回退使用独立单工作线程，不能占用 AkShare 队列；Fastify 对该轻量报告最多等待 5 秒，超时后返回无价格的降级报告。

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

合成策略排行榜由`strategyLeaderboardService`统一服务API与Paper研究：按TradingSystem实例隔离，以provider、参数及完整有序快照序列化的SHA256区分输入，结果完成后30秒内复用，保留原生成/快照时间。最多保留8个键，失败移除；沿用最早插入淘汰，可淘汰在途项，因此不限制为8个并发计算。缓存只含只读排行榜，账户、现金、订单与最终Paper计划仍实时重建；行情质量年龄可能随原报告短时复用，不能把命中当成重新评估。

网格参数搜索每约8ms在trial边界使用Node setImmediate放行宏任务，失败组合也遵循同一调度。参数组合、种子、回测顺序、评分和排名不变；计算总量与单trial同步耗时不变。这样研究期间可处理计时器、REST与WebSocket事件；不能把该机制解释成并行回测或总计算时间缩短。

网格与遗传搜索均按调用者objectives使用同一computeScore归一化加权。遗传trial、缓存命中、best和收敛曲线使用同一个目标得分，不硬编码为Sharpe；固定种子和成本模型保持一致。当前研究排行榜使用网格路径，遗传路径是独立公开优化库能力。

- **确定性**：固定输入、参数和版本应得到相同结果。
- **可审计**：结果能追溯到数据、参数、代码版本和执行时间。
- **时间安全**：计算只能使用决策时点已经可获得的信息。
- **权限隔离**：只读研究能力与订单执行能力分离。
- **可替换性**：外部数据、持久化和券商通过边界明确的适配器替换。
- **默认拒绝**：未实现或未授权的真实交易模式必须在启动和下单前失败。
- **数据可观察性**：真实快照缺失、陈旧或异常时必须显式降级，不得用静态行情掩盖。
- **性能可观察性**：慢接口和服务端失败必须能按路由模板定位，同时保持统计有界且不保存敏感请求内容。
