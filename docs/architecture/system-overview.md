# 系统架构

LearningPipeline对共享合成榜query使用enabled=false/显式refetch，普通进入/焦点/失效/核心刷新不触发网格，缓存保留并标时间；独立策略页规则不变。客户端取消不冒充服务器网格中止，不提高并发，见[0054](../decisions/0054-learning-pipeline-synthetic-research-on-demand.md)。

Paper计划进入时复制asOf并只读一次有界审计快照，策略频次采用有限七日闭区间，防守延续要求实际北京时间日期/元数据一致且不晚于asOf、按实际毫秒择新。异步等待后不混入新证据，不改信号/额度，见[0053](../decisions/0053-paper-plan-audit-evidence-cutoff.md)。

Paper计划在原初始金额计算上增加只读newPositionFunnel，分开双扫描去重/前12、持仓/新标的和最终买单；不增加历史请求或改变经济操作。诊断进入现有运行审计，本模块未接SQLite漏斗白名单，旧页面响应不造0，见[0052](../decisions/0052-new-position-candidate-funnel.md)。

Paper执行器每轮记录单调总耗时及研究/通知/订单准备提交三个阶段，未运行为null、错误任务仍保留耗时；最终运行审计写盘不在总耗时内。SQLite/有界摘要/Node解码沿固定字段传递，页面最多显示20条，旧或无效样本未知。合并签名不含耗时，不能用持久记录推断所有运行的P95，见[0051](../decisions/0051-paper-run-monotonic-stage-timing.md)。

真实行情Paper计划直接使用真实历史路由，不运行或等待合成参数榜；兼容研究说明标记not-requested、不记作完成研究。独立排行榜和Mock演示保持，页面在轻量候选完成后独立加载计划，见[0050](../decisions/0050-real-paper-plans-independent-of-synthetic-ranking.md)。

桥接historyScheduler.timing只读提供历史limiter最近/本进程最大排队和工作区间，单调毫秒、缺样本null。工作含fetcher内executor等待与SDK网络，排除后续normalize/HTTP/策略；无新任务或列表，原并发不变，见[0049](../decisions/0049-history-queue-and-work-timing.md)。

历史缓存冷读通过asyncio.shield共享Task，单个等待者取消/超时只退出本次等待，原读取及调度预算保持至完成，失败可重试；来源时间/缓存TTL不变。主HTTP批次原本不主动取消子任务，显式clear和底层线程取消仍按原行为，精确边界见[0048](../decisions/0048-history-shared-task-cancellation.md)。

多市场独立资金、事务主账本迁移和期货准入的目标方案统一见[多市场Paper账本](multi-market-paper-ledger.md)与[0047](../decisions/0047-multi-market-paper-ledger-migration.md)；当前仍是单A股JSON主账本，SQLite只读归档，期货仅研究，不能把目标设计当成已实现撮合。

JSON交易Store仍只承载PAPER-CN-01；载入时先严格核对持久账户身份，再恢复资金/订单或迁移世代。身份不符不改写原文件、不自动创建账户，见[0046](../decisions/0046-single-account-paper-ledger-binding.md)。这不等于支持多账户，期货资金/撮合仍待独立实现。

真实策略稳健性求值以单股票/单窗口为独立研究单元，每次新建策略及内存回测账户；最多12只×17固定策略×3窗=612次，每窗后让出事件循环。响应逐股身份、单股排名、实际测试数和费用后闭合分母，前端选择股票展示；原平均窗口胜率字段仅兼容保留。入口时点/来源校验继续先于求值，见[0039](../decisions/0039-strategy-evidence-is-per-symbol-and-closed-match.md)。

固定现金预留与分时总仓位比例默认已按 [决策0010](../decisions/0010-no-fixed-paper-cash-reserve.md) 取消；`cashReserveRatio` / `cashReserveFloor` 内置值为0，`capitalPacing` / `maxInvestedRatio` 兼容值为1。阶段累计订单笔数仍单独限制，不能将这些兼容字段重新解释成必须持有现金。

限价挂单的现金冻结只属于买单；卖单通过Broker的同标的待卖数量预占检查限制持仓，不占用现金，也不能释放其他买单的冻结。InMemory与JSON保持该方向规则一致；JSON载入从待买单重建冻结，不信任旧缓存数值。

执行成本按[决策0014](../decisions/0014-paper-execution-cash-costs.md)统一：Store保留本金冻结，Broker派生挂单必要费用补差并对外扣除；回测上下文/曲线也经Broker读取。每次实际撮合先保留其他待买完整预算，再核验本单含佣金现金流，Store修改前作独立余额兜底；不增加固定比例或迁移订单字段/JSON版本。

单股暴露按[决策0017](../decisions/0017-paper-pending-buy-position-exposure.md)在提交时累计同股待买名义金额，成交前按同快照实际持仓和本单真实成本投影费用后权益。每单先现金后仓位、逐单读取已成交账；不同股和待卖不混算，旧超承诺逐笔拒绝超限部分，不自动缩单或提高额度。

无有效行情时仅生成观察降级计划，单股/单笔额度同正常计划读取RiskEngine当前动态有效上限，再按原档位规则展示；无行情分支不提交订单。正常计划已复用Broker成本模型投影滑点/佣金和费用后权益，静态金额不合格时缩至合法整手或保留观察；动态风险、行情和挂单仍由Broker重查，不能据计划放宽风控。

Paper暂停保留已有挂单及预占，行情估值/account事件和主动撤单仍可使用；每笔匹配及同步Store/Risk回调后、实际状态修改前复核pause，不因暂停拒绝或取消旧挂单。恢复只切换状态，下一次行情才继续匹配；新提交仍由现有Risk拒绝，不加入待成交队列。

挂单成交前按[决策0022](../decisions/0022-paper-pending-order-risk-recheck.md)重新执行统一RiskEngine：同一匹配快照、当前实际账、排除自身冻结后的现金和实际持仓，重查日亏损/熔断/单笔额度/T+1，之后保留费用后单股检查。提交时许可不延续到以后；同批逐单读取前一成交后的账户。

账户累计`realizedPnl`按[决策0015](../decisions/0015-account-net-realized-pnl.md)从总现金、剩余持仓成交成本和初始权益派生，已付买卖费用即时计入，清仓/重开/历史裁剪不丢累计净结果；挂单预算不是费用。持仓级字段与研究FIFO定义独立保留，不能求当前持仓已实现之和代替账户累计。

完整持仓周期净结果按[决策0028](../decisions/0028-paper-position-cycle-net-results.md)独立保存实际买卖现金流，仅完全清仓时新增一次样本；旧持仓入场证据缺失明确为null，最近512项不随订单历史剪裁。JSON T+1统一使用注入时钟的北京时间日期。

RiskEngine按[决策0029](../decisions/0029-risk-clock-and-equity-observation.md)将注入时钟与权益观察独立于交易计数，北京时间换日只重置每日峰值/回撤，保留多日亏损序列；冷却和恢复期保留原触发时间。主system按[决策0030](../decisions/0030-paper-risk-consumption-and-recovery.md)显式启用Broker风险Tracker，持久保存状态与已消费闭合序列，可靠权益观察/成交后更新；普通GET不改风险。保存失败阻断后续执行，完整结果已提交则如实返回；未来/缺口证据须显式复核重置。该接线尚未扩展到独立历史Backtest的增强风险参数。

JSON公开状态变更按[决策0031](../decisions/0031-json-ledger-atomic-mutations.md)合并嵌套审计保存为一次原子文件替换，失败恢复资金、仓位、订单、序列、世代及检查点，后续保存不能带入失败操作；依然仅支持单进程，不提供数据库多实例隔离或逐tick持久化。

部署源码与镜像材料按[决策0032](../decisions/0032-retain-previous-healthy-release-assets.md)留存：健康运行标签匹配后打包源码、绑定镜像ID/运行指纹，健康发布后原子切换上一槽位；失败不改旧指针，正常只保留一份上一材料。runtime与私有配置不进源码归档，资金仍由原账本保留；新发布器不执行宿主全局prune，不把同盘源码留存当数据库灾备。

API运行镜像只携带server/shared/scripts及现有依赖，dist仅进入Nginx web；完整TS/Vite仍在builder验证。纯前端产物变化可复用API运行指纹以保留会话与内存缓存，服务配置变化仍由Compose处理，见[决策0033](../decisions/0033-separate-api-runtime-from-web-assets.md)。

`RiskPanel`只在挂载并取得账户/限额时，使用`paper-risk-state`独立查询读取`/api/risk/state`；15秒轮询、10秒stale、透传AbortSignal，未进入全局bootstrap，也不触发研究或执行。账户重置清除该缓存，认证继续使用App全业务查询取消/清除边界。实际风险日期和最近评估、未知账本/证据、失败旧快照明确展示；日停止线仅使用当前北京日期的`tradingDayPerformance`，不从累计盈亏回退。冷却恢复仍由服务端判断，浏览器不计算订单许可。

WebSocket每次认证握手除市场/账户/持仓外还发送`orders.snapshot`最近50笔，等同浏览器bootstrap的显式订单读取上限。初始化/刷新按[决策0016](../decisions/0016-bootstrap-realtime-read-windows.md)合并本轮已收到的更新，首读失败保留未落地事件；旧生命周期/socket不能回写。缺完整订单快照时兼容增量有界缓冲，溢出仅补读一次并诚实显示失败，不提供服务端绝对全序保证。

动态资源加载失败恢复只对当前session最近完整href自动刷新一次；`window.load`不代表所有懒加载成功，不能清恢复标记。自动刷新前必须向真实sessionStorage写入并读回标记，存储不可用或静默丢写时保留错误边界和手动恢复；document内Map不能证明跨刷新上限。

浏览器认证边界按[决策0019](../decisions/0019-browser-authentication-lifecycle-isolation.md)同步推进App内存epoch，再取消/清除业务QueryClient；六类mutation及跨await研究清理只写发起时认证仍有效的缓存与提示。旧verify/退出不覆盖新认证，切换清旧pending并重建socket；同会话缓存、路由和参数保持。这不撤销已提交到服务器的操作。

API请求另捕获认证generation，旧保护请求401只向原调用方拒绝，不触发新会话过期或清新CSRF；当前401与显式过期继续生效。当前verify成功推进边界，旧verify和旧logout清理不能覆写后来的内存CSRF；不保证浏览器并发Set-Cookie顺序。

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
        ├─ ProcessResources   按需API进程CPU/内存/事件循环区间，只读诊断
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

前后端共享 `shared/trading.ts` 中的行情、账户、持仓、订单、风险和实时事件契约。`AccountSnapshot.dailyPnl*` 是兼容旧客户端的历史字段名，存储语义是账户重置以来累计结果。日亏损风控使用独立`tradingDayPerformance`，双Store按总现金、完整当日成交、隔夜股数和当日来源昨收还原每日基线；缺失时明确返回null并限制新买单，见[决策0021](../decisions/0021-paper-trading-day-risk-baseline.md)。每日复盘同日复用此基线，旧快照/上一交易日兼容重建按含预约总现金和实际成交日期，避免挂单制造虚假盈亏。

Paper核心行业/个股历史先于辅助外盘/新闻启动，核心12秒期限及辅助1.5至4秒期限分别降级；全局桥接并发上限保持，其他API和已在运行的后台任务不受此局部顺序保证。缓存和等待代价见[决策0027](../decisions/0027-core-research-before-auxiliary.md)。

`server/market/dataQuality.ts` 是行情质量的唯一计算入口。它按请求股票池计算有效覆盖，使用整批报价低 10% 分位新鲜度避免单条最新报价掩盖陈旧批次，并把合法主板、创业板、科创板和北交所涨跌停与越界价格异常分开。`/api/market/quality` 只读取当前内存快照，不触发外部抓取；浏览器只在后端连接时轮询该接口。

AkShare Paper订单按单票来源`updatedAt`执行120秒年龄和5秒未来偏差门槛；陈旧个股只进入等待/观察，其他新鲜个股不被连坐。Mock与历史回放不使用墙钟年龄检查，详细边界见[决策0023](../decisions/0023-paper-quote-source-age-gate.md)。

桥接和HTTP适配器不得用抓取/接纳时间填充未知`updatedAt`；空时间保留为未知，Python观察报价不可交易，初始零价占位也无来源时间。`marketTime`和缓存完成年龄仍独立记录本地接纳状态，见[决策0037](../decisions/0037-quote-source-time-is-not-fetch-time.md)。

Paper计划操作附带候选分区；另有只读`candidatePool`合并两扫描器、持仓和已有计划，按股去重统计观察、待确认、买入计划就绪、持仓和待退出，最多120条明细并报告省略数。原因区分逐股计划、全局限制、扫描和缺失诊断，不参与预算、队列或提交；Broker仍是最终边界，见[决策0024](../decisions/0024-paper-candidate-tiers.md)。

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

腾讯指定股票快照第38字段按百分数映射到既有turnover，3.25就是3.25%；无效/负值沿用可选缺失语义，量/额单位和来源时间保持。两个扫描器直接消费现有规则，不改变阈值，见[0045](../decisions/0045-requested-quote-turnover-percent.md)。

ResearchResultCache在途任务不被容量淘汰，生产实例每个最多8个封装Promise；桥接HTTP有独立Node进程级64个实际读取预算，缓存命中共享，clear不释放仍在途任务。满载新任务不排队、明确降级或503，指定行情通道独立，见[0044](../decisions/0044-bounded-research-admission.md)。

Paper异步研究/通知绑定Store进程内执行控制修订；成功的暂停状态、策略/档位变化及重置递增，JSON写盘失败回滚，正常成交不递增。服务在研究完成后、执行器在通知后及逐笔提交前重查，stop另有生命周期失效，见[0043](../decisions/0043-paper-execution-control-revision.md)。这不替代Broker最终风控或多市场隔离。

- Service Worker只拦截同源白名单静态资源/已知SPA壳；API、认证、账户、订单及未知/跨源请求完全透传，不读取旧版本缓存。v3激活先清旧kairos-*后claim，保留无关cache，见[决策0018](../decisions/0018-service-worker-static-cache-boundary.md)。
- React 组件只能通过 `tradingApi` 和 `useTradingBackend` 访问服务端，不直接依赖存储或券商实现。
- 导航焦点在无显式目标且main中已有被选中的ARIA tab焦点时交给页签管理，仍完成导航key/观察器清理；跨页/快速搜索/显式深链及过时lazy取消保持原定位。
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
- `paperTradingPlan`复用Broker的滑点/成交价/佣金舍入，按费用后权益检查单股权重并逐笔累计买单损耗；保留价格>=1的保守手数上限与严格本金cap，用有界二分找整手。参考报价与可选`estimatedExecution`分开，摘要使用预计实际本金/费用/扣款，Executor/Broker仍按实际执行成本复核，见[0042](../decisions/0042-paper-plan-post-cost-sizing.md)。
- `paperTradingPlanService` 在发起真实历史研究前同步生成有界候选，将当前持仓、强势回踩候选和优质股候选按优先级去重后放入最多 12 只历史股票池；`paperTradingPlan` 只允许通过历史持续性、往返佣金和同日回补检查的候选形成新增仓位。
- `RiskEngine` 只依赖共享领域数据，不产生网络或存储副作用。
- `InMemoryTradingStore` 是默认实现，`JsonFileTradingStore` 只用于本地单进程恢复；两者都实现账户重置和策略档位持久化，但都不是未来数据库模型的替代品。
- Store读取不缓存账户或持仓快照。空持仓直接返回空数组；非空持仓每次读取注入时钟，仅在精确毫秒相同时复用交易日格式化字符串，时间前进或回拨均重新计算，行情与账户值始终重新估值。
- `BacktestEngine`每bar先撮合并按Broker实际顺序记录此前挂单的成交，再生成策略账户/持仓context；当前bar的批信号仍共享该context。返回的权益曲线、成交元素及配置与引擎隔离，同引擎再次run不能清空或改写旧报告；同bar成交价格、费用、T+1及初始权益点模型不变。
- 合成回测的`TurtleStrategy`首次tradable绑定到reset，缺失/不可交易等待，不混用其他股票的价格或估算高低；仅用当前价格之前完整N/M条观测构造入场/退出通道，比较时排除当前bar；当前行情契约未提供真实OHLC，仍沿用价格±1%的估算高低点，并保留含当前价格的均线过滤，不能解释为真实高低价海龟历史验证。信号读取绑定股实际模拟持仓/可卖整手，拒买不形成虚拟仓，T+1或拒卖后按持续突破/退出条件重查，两filter退出分支保持。
- 回测`DCAStrategy`的止盈依据目标标的实际持仓、成交均价和T+1可卖整手量，不把买入信号累加为已成交持仓，也不在卖出意图时清账；拒绝/部分卖出后下bar重新核对。均价含滑点不含佣金，止盈阈值属于价格收益，买入尝试周期保持独立。
- 回测`RSIStrategy`首次选择tradable标的后绑定到reset，仅累积该股历史；缺失/不可交易等待，不拼接其他报价。以该股实际持仓决定是否已有仓位，超买退出使用当前可卖整手；拒买不形成虚拟仓，T+1或拒卖后下一bar继续读取实际仓。RSI采用最近period涨跌简单平均的Cutler形式，涨跌均零按[0060](../decisions/0060-neutral-rsi-flat-windows.md)取中性50；period+1暖机、严格阈值比较与买入权重保持，未切换Wilder平滑。
- 回测`BollingerBandsStrategy`首次tradable绑定至reset，仅追加该股历史，换序保持/缺失或不可交易等待；同样读取目标实际持仓/可卖整手，不因买卖意图翻转仓位状态；保留原period暖机、标准差参数，新增仓位按[0061](../decisions/0061-bollinger-flat-entry-boundary.md)要求真实非平价窗口及upper>lower后再比较下轨<=，原中轨/上轨>=退出、T+1或拒单后的实际仓等待/重试保持。
- 回测`MomentumStrategy`首次tradable绑定至reset，报价换序保持同股，缺失/不可交易等待；入场/退出比较使用排除当前bar的完整过去N/M条观测，至少N+1/M+1条才有完整通道；保留原>=/<=与买入权重。后续持仓决策读取同标的实际quantity/可卖整手，拒买不形成虚拟仓、T+1/拒卖后重读实际账；窗口与持仓两项独立验证，不宣称收益提升。
- 回测`MovingAverageCrossStrategy`首次tradable绑定到reset，报价换序保持、缺失/不可交易等待；slow+1暖机、严格交叉比较与买入权重保持；以同股实际模拟持仓判断空仓，退出取可卖整手，无新交叉不补单，T+1等待不会错当已空仓。
- 回测`MACDStrategy`首次tradable绑定至reset，缺失/不可交易时不推进价格或prevHistogram；EMA、slow+signal暖机与histogram正负穿越事件、买入权重保持；同股实际quantity判断空仓，退出取实际可卖整手，不把T+1/拒卖当已空仓，负hist持续且无新死叉不补卖。
- 回测`GridTradingStrategy`在onStart用同一tradable报价绑定symbol与base，后续仅同股、缺失/不可交易等待，reset清绑定与原网格状态；原初始空/全不可交易时整轮不启用，log/round/clamp/层级同步与每格数量保持。
- `shared/` 只保存跨进程契约，不包含浏览器或 Node.js 运行时副作用。
- 行情读取和订单执行保持为不同模块与未来不同权限域。
- `server/auth.ts` 由 `app.ts` 默认注册；浏览器只能通过 `HttpOnly` Cookie 使用服务端会话，业务 API、指标、文档和 WebSocket 不得建立匿名旁路。当前内存会话只支持单实例；真实执行仍必须使用独立身份提供商和权限域。

## 运行时数据流

1. React 启动时验证服务端会话；未登录时只渲染登录页，不启动业务 REST 或 WebSocket。
2. `MARKET_DATA_PROVIDER` 选择 `MockMarket` 或 `AkShareMarketProvider`。
3. AkShare 模式通过 FastAPI 桥接读取行情，且必须使用 `MARKET_MODE=paper`。Fastify 行情提供者最多执行一轮在途请求，本轮完成后才安排下一轮；整轮失败有界退避并保留最后成功快照，任一路恢复后回到正常轮询周期。
4. `/api/market/quality` 对当前内存快照生成只读质量报告，使用私有 5 秒缓存和 15 秒 stale-while-revalidate；它不触发新的行情请求，也不写入策略或订单状态。
5. Fastify 在请求完成时同时更新应用实例独立的 Prometheus 累计指标和有限遥测；标签只使用已注册路由模板，未知路径统一`/__unmatched__`且不进入业务性能窗口，不保存原始URL/query。`/api/system/performance` 自身、健康检查、认证和指标端点不进入业务性能窗口。

性能端点另外按需采样API进程资源，CPU/ELU使用至少一秒的单调时间差值，内存有独立测量时刻，延迟直方图20ms分辨率、有界且关闭释放。短间隔保留上个区间，未采样不补0；不执行Shell/网络/数据库或修改交易，边界见[0041](../decisions/0041-api-process-resource-diagnostics.md)。
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

指定股票/指数行情使用独立腾讯批次缓存，各一在途、无待执行队列，两专用线程与AkShare历史执行槽分开；逐标的TTL从成功完成后计算10秒，失败/缺失20秒冷却，冷读6秒先返回已有结果。缓存分别256/32项，正负结果共用LRU容量；取消调用不取消共享抓取。健康接口输出计数，报价保留真实来源时间，零成交量只观察。名称搜索按需后台加载全市场，冷启动立即说明预热；服务启动不等待全市场来源。见[决策0038](../decisions/0038-requested-quotes-independent-of-discovery-and-history.md)。

全市场发现缓存继续按完成时间计算10秒TTL，失败保留旧结果并最长60秒冷却；它不再是常规指定报价路径。历史研究按请求读取且只保存在进程短期缓存，不无限落盘。普通研究响应与历史单序列最多64/128项，TTL/LRU和在途淘汰保护保持；历史调度器最多接纳24序列、同时处理2个，6秒预算先返回完成部分并后台预热其余。行业不复权、个股前复权，每条历史保留实际来源，失败不补静态数据。

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

回测MACDStrategy按[0059](../decisions/0059-incremental-macd-backtest-state.md)使用每实例有界MacdAccumulator，从首根价格按原EMA运算次序递推，保留原暖机、交叉、实际持仓、报价绑定与reset。纯macd仍为兼容参考；N根从重复全前缀的O(N²)变为O(N)，不改参数、经济结果或在线候选代理，不代表整体排行榜已显著加速。

实时观察通道按[0058](../decisions/0058-websocket-client-transport-isolation.md)隔离单个客户端的send/ping/terminate异常，先清理注册表与心跳、再尽力终止，其他广播和行情/Broker回调继续。重复注册幂等，30秒心跳实际执行90秒无pong清理；服务端JSON编码错误仍显式抛出，不重试订单或提供事件重放。

真实交易个股形态入口按[0056](../decisions/0056-stock-regime-history-evidence-boundary.md)先校验请求股票/实际来源/qfq、唯一日期/有效量价及完整日线时间上限，再运行61根门槛、形态与历史条件频率。构建时冻结报告/快照较早上限，Paper共享其asOf，缓存按已完成日线日期隔离；有效部分独立保留并显示排除警告。行业入口按[0057](../decisions/0057-sector-history-identity-and-time-boundary.md)增加本次采样行业的唯一名称/代码身份、实际来源与none复权校验，复用相同完整日线规则，冲突别名不以后写覆盖。

长期Paper复盘采用[独立SQLite只读观察副本](../decisions/0025-read-only-sqlite-paper-history.md)：Python标准库任务每分钟读取JSON账本，使用持久账户世代隔离实验，订单365天、样本/运行摘要90天，受容量和进程资源限制。它不参与订单执行，不替代JSON主账本，也不保存任意原始审计data。安装与备份见[操作手册](../operations/paper-history.md)。

网站长期运行证据按[0040](../decisions/0040-paper-history-bounded-read-model.md)读取一分钟后台生成的当前世代七日JSON摘要；API只读挂载子目录、严格限大小和时刻/总数，查询不启动数据库或策略。会话缺失保持未知、过期明确，重置与认证切换清除旧查询；不把归档计数作为交易权限或收益证据。

合成策略排行榜由`strategyLeaderboardService`统一服务API与Paper研究：按TradingSystem实例隔离，以provider、参数及完整有序快照序列化的SHA256区分输入，结果完成后30秒内复用，保留原生成/快照时间。每实例最多8个在途封装计算，容量只淘汰已完成条目，clear不释放未完成预算；失败移除，TTL求值失败可重试，见[0044](../decisions/0044-bounded-research-admission.md)。缓存只含只读排行榜，账户、现金、订单与最终Paper计划仍实时重建；行情质量年龄可能随原报告短时复用，不能把命中当成重新评估。

网格参数搜索每约8ms在trial边界使用Node setImmediate放行宏任务，失败组合也遵循同一调度。参数组合、种子、回测顺序、评分和排名不变；计算总量与单trial同步耗时不变。这样研究期间可处理计时器、REST与WebSocket事件；不能把该机制解释成并行回测或总计算时间缩短。

网格与遗传搜索均按调用者objectives使用同一computeScore归一化加权。遗传trial、缓存命中、best和收敛曲线使用同一个目标得分，不硬编码为Sharpe；固定种子和成本模型保持一致。当前研究排行榜使用网格路径，遗传路径是独立公开优化库能力。

遗传搜索按[0055](../decisions/0055-genetic-search-cooperative-scheduling.md)在个体评估（含缓存/失败）及对子代繁殖边界使用同样8ms单调切片与setImmediate，让定时器和网络事件获得执行机会。每次调用独立计时，种子/顺序/经济输出保持；单次同步工厂或回测不可抢占，8ms不是硬延迟上限，也不减少总计算量。

- **确定性**：固定输入、参数和版本应得到相同结果。
- **可审计**：结果能追溯到数据、参数、代码版本和执行时间。
- **时间安全**：计算只能使用决策时点已经可获得的信息。
- **权限隔离**：只读研究能力与订单执行能力分离。
- **可替换性**：外部数据、持久化和券商通过边界明确的适配器替换。
- **默认拒绝**：未实现或未授权的真实交易模式必须在启动和下单前失败。
- **数据可观察性**：真实快照缺失、陈旧或异常时必须显式降级，不得用静态行情掩盖。
- **性能可观察性**：慢接口和服务端失败必须能按路由模板定位，同时保持统计有界且不保存敏感请求内容。
