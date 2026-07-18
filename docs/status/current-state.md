# 当前状态

**核对日期：** 2026-07-18

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
- **回测参数优化器** —— 网格搜索 + 遗传算法，支持 14 种策略的参数优化、多目标加权评分、收敛曲线追踪。
- **增强型风控引擎** —— 熔断器（连续亏损/日内回撤触发自动暂停）、动态限额调整（根据回撤缩减仓位权重）、风控状态追踪与手动重置。
- **网格交易运行器** —— 实时纸面交易环境中自动执行网格策略，监听行情快照，价格穿过网格线时自动提交市价单。
- **Prometheus 指标导出** —— `/metrics` 端点提供 HTTP 请求、WebSocket 连接、账户权益、订单统计、熔断器状态等指标。
- **Grafana 仪表盘** —— Docker Compose 集成 Prometheus + Grafana 监控栈，预配置 KAIROS 交易概览仪表盘。
- **审计与交易记录导出** —— 支持 CSV（含 UTF-8 BOM）和 JSON 格式导出审计日志和订单记录。
- **OpenAPI 契约** —— Swagger UI 位于 `/documentation`，JSON 文档位于 `/documentation/json`。
- **能力声明** —— `/api/capabilities` 明确返回行情来源、只读属性、纸面执行和凭据边界。
- **真实只读行情模式** —— `MARKET_DATA_PROVIDER=akshare` 与 `MARKET_MODE=paper` 可使用 AkShare 个股与主要指数行情驱动本地模拟账户；桥接默认绕过本机代理，并在东方财富个股源不可用时降级到 AkShare 备用 A 股实时源。指数代码使用 `SH000001`、`SZ399001` 等命名空间，避免和个股 `000001` 混用。
- **东方财富只读行情原型** —— `EastMoneyMarketProvider` 可读取公开行情并拒绝 `live`，当前尚未接入主服务的 `MARKET_DATA_PROVIDER` 选择器。
- **东方财富纸面适配器** —— `EastMoneyBrokerAdapter` 不发送外部订单，订单、费用、风控、幂等和账户状态全部委托标准 `PaperBroker` 运行时。
- **同花顺模拟盘纸面适配器骨架** —— `TongHuaShunPaperAdapter` 只允许 `paper`/`sandbox`，接收行情注入后委托 `PaperBroker + RiskEngine` 完成模拟成交；拒绝 `live` 和 `tradingEnabled=true`，当前未装配到主服务，也不包含同花顺真实下单端点。
- **强制服务端会话认证** —— 正常运行默认要求登录，密码配置只保存 `scrypt` 散列；浏览器使用可撤销的 `HttpOnly`、`SameSite=Strict` Cookie，会话有过期时间与数量上限，生产环境要求 HTTPS `Secure` Cookie。除最小健康检查和认证入口外，业务 API、指标、OpenAPI 与 WebSocket 都受保护。
- **认证感知前端连接** —— 前端只有在服务端会话验证成功后才拉取交易 bootstrap 并建立 WebSocket；令牌不进入 `localStorage` 或 WebSocket URL，任意业务 API 401 或 WebSocket 1008 会立即返回登录页。修改请求额外携带会话级 CSRF，登出会服务端撤销会话。
- **自优化与存储控制状态** —— `/api/research/self-optimization` 声明 paper-only 策略自优化输入、目标和有界本地研究缓存策略，默认只计划保存紧凑日线/特征，不保存无上限垃圾数据。
- **三服务调试** —— VS Code 可同时启动 FastAPI 行情桥接、Fastify 纸面交易后端和 React 前端。
- **策略研究排行榜** —— `/api/research/strategy-leaderboard` 基于当前行情快照生成确定性研究样本，运行内置策略参数搜索，并在前端策略页展示成功率/胜率优先排名；排序同时约束交易次数、正收益和最大回撤，结果明确标注为研究/模拟，不代表真实收益。
- **A 股强势回踩确认战法** —— 新增偏高胜率的研究候选策略：中期趋势向上、温和回踩、放量反包确认后入场，并使用固定止盈止损控制单笔风险；已纳入策略研究排行榜，但当前仍基于快照合成样本，不代表真实收益。
- **今日候选扫描器** —— `/api/research/daily-candidates` 基于当前行情快照输出 A 股强势回踩确认战法的候选清单、模拟动作、建议 paper 仓位和止盈止损；前端默认展示 24 个候选，后端最多支持 80 个，结果只用于研究和模拟盘观察。
- **每日优质股筛选器** —— `/api/research/daily-quality-stocks` 基于当前行情快照按流动性、涨跌幅健康度、波动稳定性、日内强度和换手率生成优质股观察池；前端默认展示 30 个标的，后端最多支持 120 个，当前尚未接授权历史 K 线、财务因子或真实新闻。
- **研究学习状态** —— `/api/research/learning-state` 记录运行期内存中的行情快照样本、策略排行榜运行、今日候选扫描和每日优质股运行摘要；研究管线页显示累计样本、研究运行、覆盖标的和下一批数据需求。当前仅为内存观测层，服务重启会清空，尚未升级为授权历史行情缓存或数据库。
- **研究管线实时化** —— 研究管线页已从静态说明升级为读取策略排行榜、今日候选扫描和学习状态，并修复默认导出组件被命名懒加载误用导致的页面渲染异常。
- **前端稳定性防护** —— 开发环境自动注销 PWA Service Worker 并清理缓存；REST 客户端会识别 API 代理误返回 HTML 的情况，WebSocket 默认支持同源代理和显式 `VITE_WS_URL`。
- **连接状态诊断** —— 顶栏将 REST 后端连接、运行模式、行情源和 WebSocket 实时通道分开展示，避免 React 开发模式下短暂的 WebSocket 预关闭被误判为后端未连接或行情源回落到 mock。
- **A 股链路健康检查** —— `npm run check:a-share` 通过临时 Cookie 会话验证 Fastify API、AkShare 桥接、Vite 代理、指数行情、个股行情和受保护的 KAIROS 行情快照是否处于同一套正在运行的服务；密码只从安全提示或当前进程环境变量读取。
- **纸面账户纯现金启动配置** —— `TRADING_STARTING_CASH` 控制新建本地模拟账户初始资金，`TRADING_SEED_PORTFOLIO=false` 可关闭默认演示持仓种子，用于从 10000 元纯现金开始做本地 paper 观察。
- **大盘指数展示修正** —— 主要指数卡片在 AkShare 模式下显示指数成交额，市场页指数图表改为使用当前后端指数快照，不再把静态模拟分时图伪装成实时大盘走势。
- **A 股 T+1 纸面规则** —— 持仓快照新增 `availableQuantity` 与 `t1LockedQuantity`；当天买入数量在本地 paper 账户中会被锁定，当天卖出会被风控拒绝。
- **每日纸面操作计划** —— `/api/research/paper-trading-plan` 基于策略排行榜、今日候选、每日优质股、账户资金和 A 股交易规则生成只读操作过程；计划会从更大候选池里优先选择 10000 元 paper 账户买得起一手的标的，同时继续展示 T+1、现金和仓位拦截原因。
- **纸面计划质量诊断** —— `/api/research/paper-trading-plan` 新增 `qualitySummary`，返回候选池数量、可买候选数量、持仓冲突数量、动作分布、拦截原因、拟买入/卖出金额和现金使用比例；研究管线页面展示该诊断，用于判断系统是在主动生成可执行 paper 计划，还是因为资金、T+1 或持仓约束保持观望。
- **本地 paper 自动执行器** —— `PAPER_AUTO_EXECUTION_ENABLED=true` 时，Fastify 会在 A 股交易时段按间隔读取纸面计划，把 `paper-buy-plan` / `paper-sell-plan` 提交到本地 `PaperBroker`；状态接口为 `/api/trading/auto-paper-execution/status`，手动触发接口为 `/api/trading/auto-paper-execution/run`。该执行器只作用于本地模拟账户，继续受 100 股一手、T+1、现金、仓位、熔断和幂等键限制，不连接真实券商。
- **WxPusher 模拟计划提醒** —— 可选 `WXPUSHER_ENABLED=true` 使用服务端 SPT，在可执行 paper 计划提交到本地 `PaperBroker` 前发送一次模拟研究提醒；同一交易日相同操作签名会去重，成功和失败均写入不含凭据的审计事件。提醒不连接同花顺或任何真实券商，也不代表真实交易建议。
- **自动执行完整留痕** —— 每次本地 paper 自动运行都会追加 `paper-auto-execution.run` 审计，记录交易时段、计划质量、订单状态和跳过原因；即使没有订单或处于盘外，也能在重启后通过 JSON 审计复盘。
- **七天交易历史留存** —— JSON 仓储默认按 `TRADING_HISTORY_RETENTION_DAYS=7` 清理已结束订单和审计事件，同时永久保留账户现金、当前持仓、暂停状态、序列号和未完成订单，防止本地状态文件无限增长。
- **KAIROS 防守型策略组** —— 新增低波趋势、安静回踩和资金盾牌三种确定性研究策略，内置优化策略总数增至 12；排行榜与纸面计划更重视最大回撤、Sortino、Sharpe、盈利因子和候选防守分，低分候选会保持观望。结果仍是回测/本地 paper 研究，不是实际收益。
- **累计资金预留与保守执行节奏** —— 同一批 paper 买单会按顺序扣减预计成交额和手续费，默认保留权益的 10% 现金，并将自动执行收紧为每轮最多 1 笔、每天最多 4 笔；开盘/上午/下午/尾盘累计最多使用全天额度的 50%/75%/100%/100%，避免开盘数分钟内耗尽全天额度。`回撤控制` 硬止损可绕过阶段预算，但不能绕过全天上限、T+1、幂等或风险引擎。提交前仍按最新报价、滑点和佣金复核，资金不足时只记录跳过原因，不创建订单。
- **逐笔交易理由审计** —— 新自动订单会写入 `paper-auto-execution.decision`，保留策略名称、买卖理由、规则检查、预计金额和最终状态；修复前缺失的历史理由明确标注缺失，不做事后推测。
- **每日盘面与交易复盘** —— `/api/research/daily-review` 聚合观察池涨跌家数、主要指数、账户权益、持仓、订单、手续费和逐笔理由，并在研究管线页展示策略优点、问题和下一步改进。周末及工作日开盘前自动回看最近工作日；复盘日收益由开盘现金、开盘持仓昨收、当日成交和手续费重建，与累计 paper 收益分开，昨收缺失时保持不可用。当前尚未接交易所节假日日历。
- **SuperMind 模拟盘信号桥** —— `/api/integrations/supermind/signal-package` 将本地 paper 操作计划转换为可人工复核的 SuperMind 信号 CSV 和云端策略模板；该接口不登录同花顺、不保存密码/Cookie/Token，也不会自动提交订单。
- **真实新闻与全球市场只读研究流** —— AkShare 桥接新增 `/api/research/news` 与 `/api/market/global`；Fastify 新增 `/api/research/real-data-feed` 聚合真实新闻、全球主要指数和 A 股影响摘要。前端新闻面板优先展示该真实只读研究流，源不可用时明确显示降级，不再用静态模拟新闻替代真实来源。
- **真实板块与历史日线桥接** —— AkShare 桥接新增真实行业板块、行业日线和个股前复权日线接口；行业快照优先东方财富并回退到同花顺行业一览，行业历史优先东方财富并回退到同花顺行业指数，个股历史依次尝试东方财富、腾讯和新浪。请求限制为最多 20 个板块、12 只股票和 60 至 500 个交易日，返回实际来源、抓取时间、复权语义与部分失败警告。
- **板块 3/5 日展望与滚动验证** —— `/api/research/market-regime` 使用真实板块日线、当前板块涨跌/广度/资金流计算启发式增长评分，并逐日滚动比较之后 3/5 个交易日结果，返回样本数、方向命中率和平均前瞻收益。板块快照读取 80 个行业后等距抽取强、中、弱样本，降低只研究当日领涨行业的选择偏差。评分不是校准概率，也不代表确定收益。
- **洗盘候选与趋势恶化识别** —— 同一研究接口使用 180 日个股前复权日线，基于 20/60 日收益、均线斜率、回撤深度和量能变化区分“缩量洗盘候选、趋势恶化、健康趋势、信号不清、数据不足”；洗盘只作为待确认解释，不做必然拉升断言。
- **KAIROS 形态策略与回测日期修复** —— 新增“洗盘恢复”和“趋势健康”两种确定性研究策略，内置优化策略增至 14，并纳入合成样本排行榜候选。回测仓储改用当前历史 bar 的市场日期执行 A 股 T+1，不再把所有历史 bar 错当成电脑当天而永久拦截卖出。
- **真实板块研究前端** —— 市场页新增“板块展望 / 形态识别”模块；旧 `FlowPanel` 不再读取静态 `sectorFlows`，上游不可用时显示降级原因。桌面与手机宽表格将横向滚动限制在模块内部。
- **市场状态自适应策略路由** —— `AdaptiveStrategyRouter` 使用真实行业 20/60 日收益、均线斜率、波动率、板块宽度和个股形态宽度，确定性输出六类市场状态、置信度、允许/禁用策略、仓位姿态、现金储备和新增仓位缩放。它只在 AkShare 只读行情模式下参与本地 paper 计划；Mock 模式继续保留原有确定性演示行为。
- **策略路由 1.1 明确操作手册** —— 六类市场状态现在分别输出优先策略、适用条件、回避条件、复核触发器以及开盘/上午/下午/尾盘最大 paper 仓位；可用的市场宽度必须确认上升趋势，宽度偏弱会进入风险标记。该手册是确定性研究规则，不是校准后的盈利概率。
- **分时资金节奏与执行前预检** —— 本地 paper 自动执行器在 09:30、10:15、13:00 和 14:15 四个阶段重新评估，先完成每日/阶段/单轮笔数、幂等、行情、现金储备和买入后总仓位检查，再形成精确的本轮模拟动作；普通降风险卖出不受买入仓位上限限制，但仍受阶段订单预算约束。
- **预算化 WxPusher 盘中简报** —— 默认每天最多尝试 8 条并硬限制为 10 条，正常发送四个阶段简报，包含当前/计划后 paper 持仓、精确模拟动作、现金、仓位、策略条件、前三板块和风险/数据警告。同阶段实质变化默认冷却 20 分钟，价格变化不触发重发，发送失败也计入额度且审计不保存凭据。
- **全市场偏弱明确提醒** —— 当前配置股票池至少 10 只、平均涨跌幅不高于 -0.8% 且上涨/下跌家数比不高于 0.67 时，WxPusher 阶段简报标题和正文明确显示“市场不宜操作”，提示暂停新增 paper 仓位；该状态进入通知签名和审计，转弱可绕过同阶段冷却，但仍受每日消息预算限制。
- **真实新股申购研究** —— AkShare 桥接新增东方财富新股申购表只读端点，Fastify `/api/research/ipo-subscriptions` 按北京时间筛选前后 30 天的今日/即将申购、待上市和近期上市记录；只用发行价与发行/行业市盈率形成 0-100 启发式规则分，未定价时等待定价，上市后涨幅不参与历史建议。市场页提供三个标签和来源/风险展示，不读取账户资格或自动申购。
- **按名称/代码的个股趋势研判** —— AkShare 桥复用全 A 股内存行情缓存解析代码、完整名称和模糊名称；Fastify `/api/research/stock-trend` 读取单股默认 360 日前复权日线，基于均线、5/20/60 日动量、RSI、波动、ATR 和量能输出 3/5/10 个交易日规则分，并严格滚动验证过去同方向信号。市场页显示真实 Close/MA20/MA60 图、经验涨跌/震荡概率、阶段高低点中位交易日和幅度、支撑压力、依据与风险；规则分和经验频率都不是校准后的未来概率，也不会触发订单。
- **A 股五日变盘雷达** —— `/api/research/turning-points` 使用决策时点冻结的 20 日区间和 ATR 阈值定义之后 5 个交易日的向上、向下或不变盘，并按历史相似压缩状态统计条件频率；至少 20 个样本才返回概率，样本不足时明确留空。准备度综合历史频率、压缩、边界、量能和样本置信度，仅用于排序，当前只扫描最多 12 只受控观察池且不会直接生成 paper 或真实订单。
- **港股真实只读研究** —— AkShare 桥新增 `/api/market/hk/quotes` 与 `/api/market/hk/history`，Fastify `/api/research/hong-kong-market` 输出真实港股快照、前复权日线、5/20/60 日趋势、波动、回撤、量能和同趋势历史验证。快照优先新浪并回退东方财富，历史优先东方财富并回退新浪；港股不读取账户，不继承 A 股 T+1、100 股整手或费用规则，也不进入当前 A 股 paper。
- **真实 A 股多窗口稳健性验证** —— `/api/research/strategy-robustness` 从真实可交易快照按流动性选取最多 8 只 A 股，读取每只最多 500 根前复权日线，以预先固定参数在三个互不重叠窗口独立回测 10 个代表策略。报告交易数、盈利窗口、中位/最差收益、平均/最差回撤和平均胜率；不在验证样本上重新调参，并与合成参数排行榜分开展示。
- **国内期货只读研究桥** —— AkShare 桥接和 Fastify 提供 16 个白名单主连代码的快照与有界历史接口，覆盖股指、贵金属、有色、黑色、能源化工和农产品。历史序列明确标记 `continuous-main`；上游失败返回空结果和警告，不返回静态价格，也不读取期货账户或生成期货订单。
- **跨市场策略上下文** —— `/api/research/cross-market-strategy-context` 组合全球指数、股指期货、工业品和贵金属的真实只读数据，输出 `risk-on / neutral / risk-off / mixed`、优先与降权策略族、仓位姿态、证据和降级信息。该结果只解释当前适用策略，不直接修改 A 股 paper 计划或提交订单。
- **市场研究七页签** —— 市场页按 A 股概览、变盘雷达、个股研判、板块形态、港股观察、期货观察和事件资讯拆分，历史研究只在激活页签时加载；页签支持方向键和 Home/End，390px 下两列排列，宽表横向滚动限制在模块内部。
- **市场页按需加载与真实指数图表** —— 七个市场研究内容已拆为独立 `React.lazy` 异步块，并在悬停、聚焦或触屏按下页签时预取；当前 `MarketPage` 构建块为 4.19 KiB，期货观察块为 5.40 KiB。指数图表修复了已计算真实 `chartData` 却仍传入静态分时数组的问题，现在使用当前真实指数快照的昨收、今开、最低、最新和最高点。
- **持仓优先的历史形态研究** —— 生成市场状态前会把当前 paper 持仓放在个股历史研究队列前部，去重后仍限制最多 12 只，避免候选池挤掉真正需要退出判断的已有仓位。
- **趋势恶化减仓与现金观察** —— `risk-off` 下，高置信度“趋势恶化”且 T+1 可卖的持仓会生成有上限的半仓减仓计划；原有 3% 亏损退出仍是更严格的全量止损。健康趋势和洗盘候选明确保持观察；从计划开始就没有任何一手可负担候选时，只生成一条现金观察，不再重复列出十条注定资金不足的买入。
- **风险收缩日内减仓纪律** —— 普通市场状态减仓和风险仓位再平衡按持久化订单限制为同一标的每个交易日最多一轮，避免多次“减半”突破原风险预算；3% 硬止损仍可覆盖该限制。`risk-off` 且仓位高于现金目标时，计划优先对趋势恶化、信号不清或数据不足且 T+1 可卖的持仓执行最多四分之一仓位的一手级分阶段减仓，不机械卖出健康趋势或洗盘候选。
- **自动执行审计降噪** —— `PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY=true` 时，定时器只在 A 股交易时段运行；盘前、午休、盘后和周末不再每分钟写入重复跳过记录。交易时段内相同的无订单 timer 结果只在状态变化或 15 分钟心跳时持久化；订单提交、拒绝、manual、startup 和决策审计仍逐笔保留。
- **策略状态前端解释** —— 研究管线页显示当前市场状态、路由置信度、仓位姿态、现金储备、选中策略、允许策略数量和是否允许新增 paper 仓位，不把启发式置信度描述为盈利概率。
- **开发服务异常恢复** —— `npm run dev` 与 `npm run dev:a-share` 以 `concurrently` 监督前台 API，并对非零退出无限重启；`npm run dev:api:watch` 单独保留代码热重载。这样 API 子进程退出后不会只留下一个仍存活但无法提供 `8787` 的 watcher 父进程。
- **移动导航状态修复** —— 980px 以下未打开的侧栏保持隐藏，菜单按钮打开抽屉、关闭按钮关闭抽屉；390px 页面无横向溢出，不再同时显示旧顶部侧栏和抽屉导航。
- **历史研究单序列缓存接入** —— A 股、港股和国内期货历史端点按市场、代码、来源、复权、截止日期与窗口复用单序列缓存，支持 single-flight 和 stale-while-revalidate；失败的空序列不进入缓存。
- **查询短退避恢复** —— TanStack Query 仅对网络错误和 HTTP 5xx 最多重试两次，HTTP 4xx、认证失败和不可解析响应不重试。
- **港股刷新降级保护** —— 港股观察已有成功报告时，后台刷新失败不会清空表格；页面继续显示缓存报告、明确刷新失败，并标出最后成功更新时间。首次加载失败仍显示阻断错误。
- **期货研判刷新降级保护** —— 期货研判已有成功报告时，后台刷新失败继续显示缓存报告，并明确显示缓存来源状态和最后成功更新时间；首次加载失败仍显示阻断错误。

## 仍为静态或合成的数据

- 浏览器端策略实验室的 `src/lib/backtest.ts` 仍使用固定种子合成价格；策略排行榜也仍从当前快照生成确定性合成历史，二者不能当成真实历史回测。独立的多窗口稳健性报告使用真实前复权日线，但当前样本仅 8 只股票和三个窗口，仍不是生产级全市场样本外结论。
- `MarketChart` 的盘中折线仍由当前指数快照和静态时间点生成，只能视为快照可视化，不是真实逐分钟历史。
- `TradingStrategies`、`PositionPlan` 中的分批建仓、网格和定投计划仍是演示配置，未接账户策略持久化。
- `LearningPipeline` 的流程阶段说明以及通知中心样例仍有静态展示；订单、持仓、账户、审计和自动 paper 执行状态来自后端。
- `src/data/mockData.ts` 仍保存策略目录和离线降级样例。真实板块模块、真实新闻模块和在线账户不再使用其中的板块资金、新闻、持仓或订单样例。
- 财务因子、估值、公告结构化数据、Level-2 资金流、逐笔成交、授权券商历史和真实账户数据尚未接入。

## 可用接口

```text
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/health
GET  /api/capabilities
GET  /metrics                              (Prometheus 指标)
GET  /api/market/snapshot
GET  /api/research/strategy-leaderboard?bars=120
GET  /api/research/daily-candidates?limit=24
GET  /api/research/daily-quality-stocks?limit=30
GET  /api/research/learning-state
GET  /api/research/paper-trading-plan
GET  /api/research/daily-review
GET  /api/integrations/supermind/signal-package
GET  /api/research/real-data-feed
GET  /api/research/market-regime?sectorLimit=10&stockLimit=8&days=180
GET  /api/research/ipo-subscriptions?limit=40
GET  /api/research/turning-points?limit=12&days=360
GET  /api/research/hong-kong-market?limit=10&days=180
GET  /api/research/strategy-robustness?limit=8&days=500
GET  /api/research/cross-market-strategy-context?limit=12&days=180
GET  /api/market/futures/quotes?limit=16
GET  /api/market/futures/history?symbols=IF0,CU0&days=180
GET  /api/trading/auto-paper-execution/status
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
POST /api/trading/auto-paper-execution/run
POST /api/trading/pause
POST /api/trading/resume
DELETE /api/orders/:orderId
WS   /ws
GET  /documentation                       (Swagger UI)
GET  /documentation/json                  (OpenAPI JSON)
```

## 验证结果

```text
2026-07-18 history cache integration and query retry review
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py akshare-bridge\test_research_cache.py -q
84 tests passed; 1 dependency deprecation warning and 1 pytest cache permission warning

npm test
40 server test files passed, 690 server tests passed
6 web test files passed, 27 web tests passed

npm run build
TypeScript checks and Vite production build passed; 2,304 modules transformed

git diff --check passed with line-ending conversion warnings only.

2026-07-18 weekend review, phased order budget, and audit coalescing
D:\conda\python.exe -m pytest akshare-bridge -q
82 bridge and research-cache tests passed, 1 dependency deprecation warning

npm test
40 server test files passed
686 server tests passed
5 web test files passed
24 web tests passed

npm run build
TypeScript checks and Vite production build passed; 2,303 modules transformed

Runtime review: 2026-07-18 was Saturday, so no new local paper order was expected or created. The upgraded report automatically reviewed Friday 2026-07-17: the configured 100-stock snapshot was risk-off with 25 advancers, 74 decliners, and -2.37% average change. Four local paper sells filled between 09:31 and 09:35, with 2,505 yuan gross sell notional and 20 yuan commission.

The mark-to-market reconstruction used current cash, current positions, Friday fills, and previous closes. It reported opening equity 10,129 yuan, closing equity 10,198 yuan, review-day paper PnL +69 yuan (+0.68%), and cumulative paper PnL +198 yuan (+1.98%). Closing cash was 4,416 yuan, market value 5,782 yuan, cash ratio 43.3%, and invested ratio 56.7%. These are local simulation results, not real returns.

The review correctly flagged that all four daily automatic order slots were consumed during the opening phase. The executor now limits cumulative opening/morning/afternoon/closing use to 50%/75%/100%/100% of the daily cap, while hard-stop reductions can bypass only the phase budget. Unchanged timer audits are persisted on state changes or a 15-minute heartbeat; decisions, submissions, rejections, manual runs, and startup runs remain complete.

The existing 2.6 MB JSON state still contains 2,965 historical audit events created before this change; it is not rewritten destructively and will shrink through the configured seven-day retention window. Authenticated browser checks showed the desktop body at 1265/1265 and the 390 x 844 body at 375/375; the review panel was 353/353, all three summary cards fit, and a clean tab recorded no application console errors.

2026-07-17 real A-share robustness, domestic futures, and cross-market strategy context
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
76 bridge tests passed, 1 dependency deprecation warning

npm test
40 server test files passed
678 server tests passed
5 web test files passed
24 web tests passed

npm run build
TypeScript checks and Vite production build passed; 2,303 modules transformed

Build chunks: MarketPage 4.19 KiB, StrategyRobustnessPanel 4.51 KiB, FuturesMarketPanel 5.40 KiB.

Real A-share validation selected 8 liquid stocks, aligned 494 common trading days from requests of up to 500 qfq bars, and ran 10 fixed strategies across 3 non-overlapping windows. Four strategies passed the declared gate. The source was tencent-stock-history qfq; the report remained separate from the synthetic parameter leaderboard.

Real domestic futures validation returned 12 quotes and 12 histories with up to 180 bars, latest date 2026-07-16. Quotes used sina-domestic-futures-realtime-compat after the upstream AkShare Sina table exposed a 50/44-column mismatch; histories used sina-domestic-main-continuous. The current cross-market context was risk-off and preferred KAIROS资金护城河 without generating an order.

Authenticated desktop and 390 x 844 browser checks passed. At mobile width the page body was 375/375, the strategy robustness panel was 353/353, its 622px table scrolled inside a 310px wrapper, and the existing 560px recent-trades table scrolled inside a 325px wrapper. The clean strategy tab recorded no application console errors.

2026-07-16 market tab lazy loading and real index chart binding
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
66 bridge tests passed, 1 dependency deprecation warning

npm test
38 server test files passed
665 server tests passed
5 web test files passed
22 web tests passed

npm run build
TypeScript checks and Vite production build passed; 2,301 modules transformed

MarketPage raw chunk: 38.91 KiB -> 3.82 KiB (about 90% smaller).
Lazy market chunks: A-share 2.70 KiB, Hong Kong 5.17 KiB, turning point 6.01 KiB, events 6.42 KiB, regime 7.08 KiB, stock trend 11.01 KiB.
The 433.50 KiB charts chunk remains isolated and is requested only when the A-share chart panel renders.

The authenticated page exposed the stable local loading state before the first lazy panel resolved. The real index chart rendered x-axis labels 昨收 / 今开 / 最低 / 最新 / 最高 and two non-empty line paths. Desktop 1280px and mobile 390 x 844 passed with no page-level overflow; keyboard tab selection, the lazy Hong Kong table, and browser logs had no error or warning.

2026-07-16 market intelligence, turning-point radar, and Hong Kong read-only research
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
66 bridge tests passed, 1 dependency deprecation warning

npm test
38 server test files passed
665 server tests passed
4 web test files passed
20 web tests passed

npm run build
TypeScript checks and Vite production build passed; 2,299 modules transformed

git diff --check passed with line-ending conversion warnings only. The credential scan excluding .env.local, logs, data, generated output, and known test placeholders found no configured SPT, UID, or login password in source or documentation.

Runtime validation used the listening Vite 4173, Fastify 8787, and AkShare 8800 services. The authenticated app reported paper mode, AkShare real read-only data, and a connected realtime channel.

The real A-share turning scan used tencent-stock-history qfq data, requested 12 symbols and analyzed all 12 with 360 displayed bars per candidate and no degraded warning. No row met the high-probability turning threshold. 寒武纪 had 33 matching samples with 42.4% break / 12.1% up / 30.3% down; 中芯国际 had 61 samples and 29.5% break; 新易盛 had 72 samples and 26.4% break. Rows stayed at 暂未变盘 or 样本不足 instead of forcing a stock recommendation.

The real Hong Kong report used sina-hk-spot + sina-hk-history, returned 10 quotes and 10 histories for the 180-day request, and reported no degraded warning. 泡泡玛特 had 32 same-trend samples and a 46.9% future-five-day up frequency; the other current rows had fewer than 20 samples and correctly kept probability empty.

The market page passed authenticated 1280px desktop and 390 x 844 mobile checks. At 390px there was no page-level horizontal overflow, six task tabs formed two 175px columns, and the 1,180px turning table scrolled inside its 324px wrapper. Arrow keys changed tab focus and selection, ARIA panel linkage followed the active tab, and browser logs contained no error or warning.

2026-07-16 name/code stock trend forecast
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
56 bridge tests passed, 1 dependency deprecation warning

npm test
36 server test files passed
647 server tests passed
4 web test files passed
18 web tests passed

npm run build
TypeScript checks and Vite production build passed

git diff --check passed with line-ending conversion warnings only. The tracked/untracked credential scan excluding `.env.local` found no configured SPT, UID, or login password.

Runtime health returned paper + akshare, authEnabled=true, realTradingEnabled=false. The restarted AkShare bridge held 5528 stock symbols and 562 indices with no stock or index error. Exact code `600519` and exact name `贵州茅台` both resolved to the same 360-bar qfq series from `tencent-stock-history`; partial name `酒` returned eight choices without selecting one, and an unknown name returned not-found without static fallback data.

Real 600519 snapshot: quote 1258.99 (+0.63%), latest history date 2026-07-16, 20-day support 1151.01 and resistance 1267.97. The 3-day outlook was slightly bullish at 64/100 with 44 same-direction samples and 36.4% historical hit rate; 5-day was slightly bullish at 60/100 with 42 samples and 40.5% hit rate; 10-day was sideways at 55/100 with 124 samples and 65.3% range hit rate. The low short-horizon validation is displayed rather than hidden and is not described as future probability.

Empirical distribution on the same real 600519 sample: 3-day up/down/flat frequencies were 29.5%/54.5%/15.9%, with median peak/trough near trading day 2 at +0.1%/-1.3%; 5-day frequencies were 30.9%/52.4%/16.7%, with median peak near day 2 (+0.4%) and trough near day 4 (-1.6%); 10-day frequencies were 46.0%/46.8%/7.3%, with median peak near day 5 (+1.3%) and trough near day 7 (-2.0%). The positive short-term rule score conflicts with the historical downside frequency, so the API adds an explicit conflict risk instead of hiding the disagreement.

The authenticated market page passed 1280px desktop and 390 x 844 mobile checks. Close/MA20/MA60 rendered as three non-empty SVG paths; the mobile panel was 370px wide, chart 334 x 250, all horizon items stayed within 340px, page-level horizontal overflow was false, and the authenticated reload console had no errors.

2026-07-16 broad-market warning and real IPO subscription research
D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q
50 bridge tests passed, 1 dependency deprecation warning

npm test
35 server test files passed
638 server tests passed
4 web test files passed
17 web tests passed

npm run build
TypeScript checks and Vite production build passed

git diff --check passed with line-ending conversion warnings only. The credential scan found no real-length SPT/UID value or configured login password outside ignored .env.local. Runtime health returned paper + akshare, authEnabled=true, realTradingEnabled=false; the AkShare bridge on port 8800 was healthy with no stock or index error.

The authenticated IPO endpoint returned eastmoney-ipo-subscription data with 1 open-today, 4 upcoming, 4 awaiting-listing, and 11 recently-listed rows. 长鑫科技 scored 20/100 and was marked 暂不参与 because issue PE was 308.92 versus industry PE 76.32. 千岸科技 scored 70/100 and was marked 可关注申购, with an explicit Beijing Stock Exchange permission and funding-rule warning. 欣兴工具 correctly carries the ChiNext permission warning; ordinary-board 津富士达 and 嘉立创 no longer incorrectly report STAR Market eligibility. Missing issue-time pricing remains 待定/等待定价 rather than being invented.

The market page passed authenticated desktop and 390 x 844 checks: all three IPO tabs rendered real rows, the page had no horizontal overflow, the 957px research table scrolled inside its 338px mobile container, and no console errors were recorded. No live WxPusher message was sent during verification; broad-market warning behavior was covered by deterministic notifier tests.

2026-07-16 daily review and risk-off execution discipline
npm test
34 server test files passed
631 server tests passed
4 web test files passed
16 web tests passed

npm run build
TypeScript checks and Vite production build passed

git diff --check passed with line-ending conversion warnings only. Credential scan found no real-length SPT/UID value outside ignored .env.local. After an API-only restart, health returned paper + akshare with auth enabled and realTradingEnabled=false. The authenticated daily review classified the configured 100-stock pool as risk-off, reported the same-day repeated 600010 reduction and 80.9% invested ratio, and the upgraded plan held already-reduced 600010/601600 while staging one-lot risk reductions for three unclear holdings. The after-hours executor recorded only its startup skip in runtime status; scheduled off-session suppression is covered by six focused tests.

2026-07-16 intraday strategy playbook and budgeted paper briefings
npm test
33 server test files passed
619 server tests passed
4 web test files passed
16 web tests passed

npm run build
TypeScript checks and Vite production build passed

git diff --check passed. A tracked/untracked credential scan found no real-length SPT/UID value outside ignored .env.local. The existing local paper + AkShare health endpoint returned 200 and the browser loaded the protected login page. No live WxPusher quota was consumed and no authenticated page was inspected; tomorrow still requires restarting the project with the new code and reactivating ClawBot if its 24-hour window has expired.

2026-07-15 adaptive strategy routing and runtime recovery
npm test
30 server test files passed
587 server tests passed
4 web test files passed
15 web tests passed

python -m pytest akshare-bridge/test_bridge.py -q
46 bridge tests passed, 1 dependency deprecation warning

npm run build
TypeScript checks and Vite production build passed

Runtime: paper + akshare, authEnabled=true, realTradingEnabled=false. After terminating only API PID 287472, concurrently logged a non-zero exit and restart, and port 8787 returned under PID 265224 while the web and bridge processes stayed online. API, Vite proxy, and bridge health passed; the authenticated leaderboard returned 12 entries. The adaptive plan returned risk-off at 77% routing confidence, selected KAIROS资金护城河, disabled new positions, and produced two bounded paper sell plans plus one cash observation. Auto execution remained local-paper-broker-only and after-hours, so no external or real order was submitted. Browser checks at 1440 x 900 and 390 x 844 showed the regime panel without horizontal overflow; the mobile drawer opened and closed correctly and the console had no errors.

Day review: the auto executor recorded 80 open-session runs from 09:30 through 10:49 and submitted 0 orders because every generated plan was blocked. The account had 412 cash and five existing positions; none of the initial 12 candidates was affordable as a 100-share lot. The API child then stopped around 10:49 while the old tsx watcher parent remained alive. This explains the no-trade day without inventing missing orders or attributing it to strategy quality alone.

2026-07-14 real sector outlook and market-regime research
python -m pytest akshare-bridge/test_bridge.py -q
46 bridge tests passed

npm test
28 server test files passed
578 server tests passed
3 web test files passed
13 web tests passed

npm run build
TypeScript checks and Vite production build passed

Runtime: paper + akshare. /api/research/market-regime returned live-read-only with 10 sector outlooks and 8 stock regimes, using ths-industry-summary, ths-industry-history, and tencent-stock-history without warnings. /api/research/real-data-feed returned live-read-only with 10 EastMoney news items and 5 Sina global indices without warnings. Browser checks showed the authenticated market page with the 180-day real-history panel and no console errors.

2026-07-14 required login and server session security
npm test
27 server test files passed
564 server tests passed
3 web test files passed
12 web tests passed

npm run build
TypeScript checks and Vite production build passed

Runtime: paper + akshare, authEnabled=true. Anonymous health returned 200; capabilities, account, daily review, metrics, and OpenAPI returned 401. Browser checks passed for invalid login, valid login, authenticated WebSocket, reload persistence, and server-side logout. The 390 x 844 mobile viewport had no horizontal overflow. Docker CLI was unavailable, so container build remains a deployment-host verification step.

npm run check:a-share
Authenticated Fastify API, AkShare Bridge, Vite API Proxy, A-share index quotes, stock quotes, and KAIROS market snapshot all passed; backend paper, provider akshare, 4 live index quotes.

2026-07-14 cumulative cash reservation and daily paper review
npm run test:server -- server/research/paperTradingPlan.test.ts server/research/dailyMarketReview.test.ts server/app.test.ts server/config.test.ts
4 test files passed
103 tests passed

npm test
27 server test files passed
561 server tests passed
2 web test files passed
9 web tests passed

npm run build
TypeScript checks and Vite production build passed

Runtime review: paper equity 10242, daily paper PnL 242 (2.42%), 5 filled buys, 1 historical insufficient-cash rejection, 25 commission, 4.0% cash ratio. Desktop and 390px mobile review layouts had no horizontal overflow.

2026-07-14 defensive paper strategies, durable audit, and seven-day retention
npm run test:server -- server/backtest/strategies.test.ts server/optimizer/optimizer.test.ts server/store/jsonFileTradingStore.test.ts server/app.test.ts server/config.test.ts
5 test files passed
178 tests passed

npm test
25 server test files passed
557 server tests passed
2 web test files passed
9 web tests passed

npm run build
TypeScript checks and Vite production build passed

npm run check:a-share
Fastify API、AkShare Bridge、Vite API Proxy、A-share Index Quotes、A-share Stock Quotes、KAIROS Market Snapshot 全部通过；后端模式 paper，行情源 akshare，有效指数 4 个。

运行态检查：AkShare 缓存 5529 只 A 股和 562 个指数；自动执行器在盘前未提交订单，并将 `outside A-share trading session: pre-market` 持久化到 `data/paper-trading-state.json`。

2026-07-13 local paper auto execution verification
npm run test:server -- server/app.test.ts server/config.test.ts
2 test files passed
97 tests passed

npm test
25 server test files passed
547 server tests passed
2 web test files passed
9 web tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 SuperMind simulation signal bridge verification
npm run test:server -- server/app.test.ts
1 test file passed
21 tests passed

npm test
25 server test files passed
542 server tests passed
2 web test files passed
9 web tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 研究学习状态与运行期样本记忆

npm run test:server -- server/app.test.ts
1 test file passed
16 tests passed

npm run build
TypeScript checks and Vite production build passed

完整 npm test 未在本次验证中重跑。

2026-07-11 真实指数、数据质量、胜率策略榜与同花顺模拟盘聚焦验证

python -m pytest akshare-bridge/test_bridge.py -q
19 tests passed, 1 warning

npm run test:server -- server/market/HttpMarketProvider.test.ts server/market/AkShareProvider.test.ts
2 test files passed
37 tests passed

npm run test:server -- server/market/dataQuality.test.ts server/app.test.ts server/broker/tonghuashun/tonghuashun.test.ts
3 test files passed
86 tests passed

npm run build
TypeScript checks and Vite production build passed

完整 npm test 未在本次验证中重跑。

2026-07-11 前端稳定性、API 代理防护与真实 A 股链路验证

python -m pytest akshare-bridge/test_bridge.py -q
19 tests passed, 1 warning

npm run test:web
2 test files passed
9 tests passed

npm run build
TypeScript checks and Vite production build passed

npm run check:a-share
Fastify API、AkShare Bridge、Vite API Proxy、A-share Index Quotes、A-share Stock Quotes、KAIROS Market Snapshot 全部通过；后端模式 paper，行情源 akshare，有效指数 4 个。

2026-07-11 纸面账户纯现金启动配置验证
npm test
27 test files passed
543 tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 A 股 T+1 与每日纸面操作计划验证
npm run test:server -- server/broker/paperBroker.test.ts server/app.test.ts server/store/jsonFileTradingStore.test.ts
3 test files passed
47 tests passed

npm test
27 test files passed
545 tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 真实新闻与全球市场只读研究流验证
python -m pytest akshare-bridge/test_bridge.py -q
29 tests passed, 1 warning

npm test
27 test files passed
546 tests passed

npm run test:server -- server/app.test.ts
1 test file passed
18 tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 认证感知前端连接与安全边界文档验证
npm test
27 test files passed
550 tests passed

npm run build
TypeScript checks and Vite production build passed

2026-07-11 策略覆盖扩池与纸面计划质量诊断验证
npm run test:server -- server/app.test.ts
1 test file passed
20 tests passed

npm test
25 server test files passed
541 server tests passed
2 web test files passed
9 web tests passed

npm run build
TypeScript checks and Vite production build passed
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
│   ├── index.ts                 # 统一导出 + 14 种策略工厂
│   └── optimizer.test.ts       # 27 tests
├── research/
│   ├── strategyLeaderboard.ts   # 策略研究排行榜（只读研究端点）
│   ├── dailyCandidates.ts       # 今日候选扫描器（只读研究端点）
│   ├── dailyQualityStocks.ts    # 每日优质股筛选器（只读研究端点）
│   ├── realResearchData.ts      # 真实新闻与全球市场只读研究流
│   ├── marketRegimeResearch.ts  # 真实板块展望、滚动验证与个股形态识别
│   └── researchStore.ts         # 运行期研究样本与学习状态（内存）
├── risk/
│   ├── riskEngine.ts            # 增强型风控引擎（熔断+动态限额）
│   └── riskEngine.test.ts      # 26 tests
├── broker/
│   ├── GridTradingRunner.ts     # 实时网格交易运行器
│   └── GridTradingRunner.test.ts # 网格运行器测试
├── trading/
│   └── paperAutoExecutor.ts     # 本地 paper 自动执行器（只提交到 PaperBroker）
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

- 将真实新闻和全球市场研究流抽象为 NewsProvider / MacroMarketProvider 契约，并补充历史影响验证。
- 将策略研究排行榜从快照生成样本升级为授权历史行情缓存，并加入样本外验证。
- 将变盘雷达升级为 point-in-time 股票池、purged walk-forward、置信区间、概率校准和市场状态分层验证。
- 为港股只读研究补充交易日历、数据版本、公司行动和跨市场影响验证；在独立港股 paper 规则完成前继续禁止生成港股订单。
- 增加账户白名单、角色权限和独立审批服务；当前本地登录只保护工作台 API，不授权真实交易。
- 前端集成网格交易运行器控制面板。
- PostgreSQL 替代 JSON 文件持久化。
- 评估券商官方模拟环境或沙箱，继续禁止连接真实资金。

## 当前边界

- 默认行情、资金流、账户与订单数据仍是本地模拟数据；可选 AkShare 个股、主要指数、财经新闻和全球指数是只读外部数据。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 策略研究排行榜当前使用确定性合成历史样本，不是授权历史行情或真实收益记录。
- 今日候选扫描器当前主要基于实时快照特征评分，不是完整历史 K 线确认；`paper-buy` 只表示可进入模拟盘观察，不是实盘下单建议。
- 每日优质股筛选器当前主要基于实时快照质量评分，尚未把真实新闻、全球市场、授权历史 K 线或财务因子纳入评分闭环；`focus` 只表示优先观察或进入 paper 小仓位验证。
- 研究学习状态当前只是运行期内存样本池，不是长期训练库；服务重启会清空，不能用于声称策略已完成自学习或已验证真实胜率。
- A 股强势回踩确认战法是研究候选策略，不是“稳赚”或“实盘收割”承诺；接入授权历史行情、样本外验证和模拟盘观察前，不应作为真实下单依据。
- 单股趋势研判只使用公开前复权日线和启发式技术结构；历史同向命中率不是未来胜率，未纳入公司财务、公告事件、停复牌、涨跌停可成交性或完整逐笔数据，不应作为单独下单依据。
- 变盘雷达只覆盖当前受控观察池，经验频率未完成生存者偏差修正、独立折概率校准和成交成本压力测试；当前结果是研究条件频率，不是生产级预测。
- 港股模块只读取公开快照和前复权日线，不读取港股账户，也未实现港交所交易日历、T+0、每手股数、港币/汇率和港股费用，因此不能生成港股 paper 或真实订单。
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- JSON 交易历史默认只保留最近 7 天，过期清理也会缩短订单幂等查询和审计回看窗口；需要长期研究的汇总结果应另行导出，不应依赖无限增长的运行状态文件。
- 新建纸面账户可通过 `TRADING_STARTING_CASH=10000` 和 `TRADING_SEED_PORTFOLIO=false` 从 10000 元纯现金开始；已有 JSON 状态文件不会被自动覆盖，需要用户明确删除或移走后才会重新初始化。
- A 股 paper 撮合遵守一手 100 股和 T+1 卖出限制；同日买入的 `t1LockedQuantity` 只会在后续交易日释放为可卖数量。
- 本地 paper 自动执行器默认关闭；开启后只在 `MARKET_MODE=paper` 与 `REAL_TRADING_ENABLED=false` 下运行，默认限制在 A 股交易时段，并只向本地 `PaperBroker` 提交模拟订单。
- 当前没有事务型数据库、真实账户连接或真实券商执行。
- 登录保护默认强制开启，必须显式提供账号与有效 `scrypt` 密码散列；不存在默认账号或默认密码。`AUTH_ENABLED=false` 只允许测试环境。当前会话保存在单个 Fastify 进程内，服务重启会要求重新登录，多实例部署前需要共享会话存储。
- `REAL_TRADING_ENABLED=true` 与 `MARKET_MODE=live` 都会拒绝启动。
- AkShare 模式必须使用 `MARKET_MODE=paper`，真实行情不改变订单执行权限。
- 当前没有任何真实订单执行代码。
- 新闻面板在 AkShare 模式下优先读取真实只读研究流；若源不可用会显示降级状态，不再用静态模拟新闻冒充真实来源。活跃板块面板使用公开行业快照及可用的公开主力净流入字段，但不属于授权 Level-2 资金流；主要指数卡片和指数快照图使用只读指数行情。当前仍未接入真实逐笔或完整分时历史曲线。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。

