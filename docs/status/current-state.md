# 当前状态

**核对日期：** 2026-08-12

## 已实现

- **腾讯云单机生产部署** —— `124.221.165.45` 已作为当前生产部署目标；Nginx、Fastify 和 AkShare 容器在服务器内健康通过，公网 80/443 已通，API 与行情桥只在容器网络内通信。生产模式固定为 `paper + akshare`，真实交易关闭，认证保护开启，Paper JSON 历史默认保留 7 天。`kairosq.cn` 的 A 记录已指向该服务器，但腾讯云当前把域名 HTTP 请求重定向到 DNSPod webblock，TLS SNI 连接也被重置；完成 ICP 备案和受信任证书前，浏览器只能看到 IP 自签名证书警告。
- React + TypeScript + Vite 响应式量化研究工作台。
- 总览、策略实验室、市场观察、模拟账户和研究管线五个视图。
- 固定种子的确定性回测、净值曲线、基准曲线、交易记录和风险指标。
- Fastify + TypeScript 本地服务，提供 REST API 与 WebSocket 实时通道。
- 确定性模拟行情，每秒推送指数和可交易股票报价。
- 可切换的内存或本地 JSON 模拟账户、持仓、订单、成交、手续费、滑点和审计事件。
- 模拟市价单、限价单挂单与撤销、客户端订单 ID 幂等、暂停和恢复撮合。
- 单笔金额、单标的仓位、整手数量、账户亏损预算和可用资金检查。
- React 页面通过 API 和 WebSocket 显示实时模拟行情、权益、持仓和订单。
- Zod 环境变量与订单请求校验。
- VS Code 前后端复合断点调试。
- 回测、风险引擎、模拟券商和 Fastify API 的 Vitest 测试。
- **MarketDataProvider 契约** —— 抽象行情数据源，当前可选择 MockMarket 或 AkShare 只读行情桥接。
- **TradingStore 契约** —— 抽象交易数据持久化，支持 InMemoryTradingStore 与 JsonFileTradingStore，为 PostgreSQL 存储预留插槽。
- **BrokerAdapter 契约** —— 当前仅用于模拟网络连接；所有订单仍委托 PaperBroker，不包含真实券商执行。
- PaperBroker 通过契约接口依赖注入，不绑定具体实现。
- 契约一致性测试，确保任意实现类符合契约约定。
- **回测参数优化器** —— 网格搜索 + 遗传算法，支持 15 种策略的参数优化、多目标加权评分、收敛曲线追踪。
- **增强型风控引擎** —— 熔断器（连续亏损/账户回撤触发自动暂停）、动态限额调整（根据回撤缩减仓位权重）、风控状态追踪与手动重置。
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
- **强制服务端会话认证** —— 正常运行默认要求登录，密码配置只保存 `scrypt` 散列；固定密码允许 8 至 256 个字符并可通过服务器标准输入重置，不写入命令参数或环境明文。浏览器使用可撤销的 `HttpOnly`、`SameSite=Strict` Cookie，会话有过期时间与数量上限，生产环境要求 HTTPS `Secure` Cookie。除最小健康检查和认证入口外，业务 API、指标、OpenAPI 与 WebSocket 都受保护。
- **认证感知前端连接** —— 前端只有在服务端会话验证成功后才拉取交易 bootstrap 并建立 WebSocket；令牌不进入 `localStorage` 或 WebSocket URL，任意业务 API 401 或 WebSocket 1008 会立即返回登录页。修改请求额外携带会话级 CSRF，登出会服务端撤销会话。
- **自优化与存储控制状态** —— `/api/research/self-optimization` 声明 paper-only 策略自优化输入、目标和有界本地研究缓存策略，默认只计划保存紧凑日线/特征，不保存无上限垃圾数据。
- **三服务调试** —— VS Code 可同时启动 FastAPI 行情桥接、Fastify 纸面交易后端和 React 前端。
- **策略研究排行榜** —— `/api/research/strategy-leaderboard` 基于当前行情快照生成确定性研究样本，运行内置策略参数搜索，并在前端策略页展示成功率/胜率优先排名；排序同时约束交易次数、正收益和最大回撤，结果明确标注为研究/模拟，不代表真实收益。
- **A 股强势回踩确认战法** —— 新增偏高胜率的研究候选策略：中期趋势向上、温和回踩、放量反包确认后入场，并使用固定止盈止损控制单笔风险；已纳入策略研究排行榜，但当前仍基于快照合成样本，不代表真实收益。
- **今日候选扫描器** —— `/api/research/daily-candidates` 基于当前行情快照输出 A 股强势回踩确认战法的候选清单、模拟动作、建议 paper 仓位和止盈止损；前端默认展示 24 个候选，后端最多支持 80 个，结果只用于研究和模拟盘观察。
- **每日优质股筛选器** —— `/api/research/daily-quality-stocks` 基于当前行情快照按流动性、涨跌幅健康度、波动稳定性、日内强度和换手率生成优质股观察池；换手率已升级为有界的 2%-6% 非线性健康甜蜜区，低换手、过热换手和字段缺失均有独立解释；前端默认展示 30 个标的，后端最多支持 120 个，当前尚未接授权历史 K 线、财务因子或真实新闻。
- **研究学习状态** —— `/api/research/learning-state` 记录运行期内存中的行情快照样本、策略排行榜运行、今日候选扫描和每日优质股运行摘要；研究管线页显示累计样本、研究运行、覆盖标的和下一批数据需求。当前仅为内存观测层，服务重启会清空，尚未升级为授权历史行情缓存或数据库。
- **研究管线实时化** —— 研究管线页已从静态说明升级为读取策略排行榜、今日候选扫描和学习状态，并修复默认导出组件被命名懒加载误用导致的页面渲染异常。
- **前端稳定性防护** —— 开发环境自动注销 PWA Service Worker 并清理缓存；REST 客户端会识别 API 代理误返回 HTML 的情况，WebSocket 默认支持同源代理和显式 `VITE_WS_URL`。
- **连接状态诊断** —— 顶栏将 REST 后端连接、运行模式、行情源和 WebSocket 实时通道分开展示，避免 React 开发模式下短暂的 WebSocket 预关闭被误判为后端未连接或行情源回落到 mock。
- **A 股链路健康检查** —— `npm run check:a-share` 通过临时 Cookie 会话验证 Fastify API、AkShare 桥接、Vite 代理、指数行情、个股行情和受保护的 KAIROS 行情快照是否处于同一套正在运行的服务；密码只从安全提示或当前进程环境变量读取。
- **纸面账户纯现金启动配置** —— `TRADING_STARTING_CASH` 控制新建本地模拟账户初始资金，`TRADING_SEED_PORTFOLIO=false` 可关闭默认演示持仓种子，用于从 10000 元纯现金开始做本地 paper 观察。
- **大盘指数展示修正** —— 主要指数卡片在 AkShare 模式下显示指数成交额，市场页指数图表改为使用当前后端指数快照，不再把静态模拟分时图伪装成实时大盘走势。
- **行情质量与真实指数空状态** —— `/api/market/quality` 按请求股票池计算有效覆盖，使用整批报价低 10% 分位新鲜度，并区分合法创业板/科创板 20%、北交所 30% 涨跌停与越界价格异常；A 股概览每 30 秒显示 `healthy / degraded / unusable` 只读状态，接口使用私有 5 秒短缓存。主要指数缺失时不再使用静态指数数值补位。质量状态不参与策略路由、风险限额或订单。
- **有界 API 性能诊断** —— `/api/system/performance` 按 Fastify 路由模板聚合业务请求，最多保留 64 条路由、每路由 128 个耗时样本，输出滚动 P50/P95、平均/最大耗时、`429/5xx` 失败率、慢请求、在途数和当前行情质量；不记录查询值、正文或凭据，不写磁盘，也不影响策略和订单。模拟账户“运维 > 监控”已升级为 15 秒轮询的诊断台。
- **研究请求去重** —— `src/lib/researchQueries.ts` 统一策略榜、候选扫描、Paper 计划和每日复盘的 Query Key、stale 时间及轮询周期；研究管线不再用 `pipeline` 展示位置拆分相同参数缓存，减少重复 REST 请求和后端计算。
- **全链路请求可靠性** —— Fastify 行情轮询改为单飞串行调度，整轮失败按 10/20/40/60 秒有界退避并保留最后成功快照；AkShare 全市场股票/指数缓存以刷新完成时间计算默认 10 秒 TTL，失败后进入有限冷却并继续返回旧数据。服务端研究模块统一通过 `bridgeRequest` 处理超时、HTTP 详情、网络断开和无效 JSON，不再向界面暴露原始 `fetch failed`；前端研究 GET 消费 TanStack Query 的 `AbortSignal`，切走页签时取消过期浏览器请求。
- **生产行情真实备用源与空刷新保护** —— A 股个股和四个主要指数在东方财富/新浪读取失败后可回退腾讯公开只读快照；生产桥接使用同一份 `MARKET_SYMBOLS` 有界股票池，保留交易所报价时间。股票或指数刷新返回空表、不可解析响应或网络错误时不会清空最后成功缓存；Fastify 也把空批次视为失败并保留最近成功快照，不使用固定价格补位。
- **生产静态资源权限** —— Web 镜像构建阶段统一把 Vite 输出目录设为目录 `0755`、文件 `0644`，避免部署归档继承限制权限后导致 `manifest.json`、`sw.js` 或 PWA 图标被 Nginx 拒绝读取。
- **生产上传归档预检** —— 受限 SSH 上传的发布包先解压到提交专属临时目录，并校验 Dockerfile、Compose、`package.json` 和部署入口完整性；只有验证成功后才备份和替换 `/opt/kairos` 源码，错误格式或缺文件归档不会再清空当前源码。
- **A 股 T+1 纸面规则** —— 持仓快照新增 `availableQuantity` 与 `t1LockedQuantity`；当天买入数量在本地 paper 账户中会被锁定，当天卖出会被风控拒绝。
- **每日纸面操作计划** —— `/api/research/paper-trading-plan` 基于策略排行榜、今日候选、每日优质股、账户资金和 A 股交易规则生成只读操作过程；计划会从更大候选池里优先选择 10000 元 paper 账户买得起一手的标的，同时继续展示 T+1、现金和仓位拦截原因。
- **纸面计划质量诊断** —— `/api/research/paper-trading-plan` 的 `qualitySummary` 返回候选池数量、可买候选数量、持仓冲突数量、动作分布、拦截原因、拟买入/卖出金额、现金使用比例和策略覆盖；研究管线页面展示命中的策略族、未匹配候选和主要限制，用于判断系统是在主动生成可执行 paper 计划，还是因为资金、T+1、历史结构或仓位约束保持观望。
- **本地 paper 自动执行器** —— `PAPER_AUTO_EXECUTION_ENABLED=true` 时，Fastify 会在 A 股交易时段按间隔读取纸面计划，把 `paper-buy-plan` / `paper-sell-plan` 提交到本地 `PaperBroker`；状态接口为 `/api/trading/auto-paper-execution/status`，手动触发接口为 `/api/trading/auto-paper-execution/run`。`PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS` 默认把每日 2 笔已成交 Paper 订单作为活跃度目标，状态会区分进行中、已完成、数据/计划阻塞和收盘未达成；该目标不强制补单，也不改变每日 4 笔上限、单轮 1 笔上限或任何数据与风控检查。定时调度从上一轮完成后才开始计算下一间隔，研究耗时超过配置间隔时不会并发空跑。该执行器只作用于本地模拟账户，继续受 100 股一手、T+1、现金、仓位、熔断和幂等键限制，不连接真实券商。
- **Paper 关键历史优先级** —— 当前计划先完成有界的 A 股核心研究，再启动新闻和全球市场辅助研究；核心池限制为 6 个分散行业和 6 只优先股票，持仓优先，其后交错纳入策略候选与质量候选。此改动减少 AkShare 历史队列冷启动竞争，不缓存包含账户状态的完整计划，也不把降级数据提升为可交易证据。
- **WxPusher 模拟计划提醒** —— 可选 `WXPUSHER_ENABLED=true` 使用服务端 SPT，在可执行 paper 计划提交到本地 `PaperBroker` 前发送一次模拟研究提醒；同一交易日相同操作签名会去重，成功和失败均写入不含凭据的审计事件。提醒不连接同花顺或任何真实券商，也不代表真实交易建议。
- **自动执行完整留痕** —— 本地 paper 自动运行按状态变化和有界心跳追加 `paper-auto-execution.run` 审计，记录交易时段、计划质量、观察/生效市场状态、路由稳定方式、上一条确认时间、数据源状态、候选数量、订单状态和跳过原因；即使没有订单，也能在重启后通过 JSON 审计复盘，复盘不依赖 WxPusher 是否启用。
- **七天交易历史留存** —— JSON 仓储默认按 `TRADING_HISTORY_RETENTION_DAYS=7` 清理已结束订单和审计事件，同时永久保留账户现金、当前持仓、暂停状态、序列号和未完成订单，防止本地状态文件无限增长。
- **KAIROS 防守型策略组** —— 低波趋势、安静回踩、资金盾牌与风险收缩修复均为确定性研究策略，内置优化策略总数为 15；风险收缩修复只有在中期下跌后放量收复短均线时产生小目标仓位信号，在 `risk-off-recovery` 路由下仍默认禁止新增 Paper 仓位。结果仍是回测/本地 paper 研究，不是实际收益。
- **累计资金预留与保守执行节奏** —— 同一批 paper 买单会按顺序扣减预计成交额和手续费，默认保留权益的 10% 现金，并将自动执行收紧为每轮最多 1 笔、每天最多 4 笔；开盘/上午/下午/尾盘累计最多使用全天额度的 50%/75%/100%/100%，避免开盘数分钟内耗尽全天额度。`回撤控制` 硬止损可绕过阶段预算，但不能绕过全天上限、T+1、幂等或风险引擎。提交前仍按最新报价、滑点和佣金复核，资金不足时只记录跳过原因，不创建订单。
- **逐笔交易理由审计** —— 新自动订单会写入 `paper-auto-execution.decision`，保留策略名称、买卖理由、规则检查、预计金额和最终状态；修复前缺失的历史理由明确标注缺失，不做事后推测。
- **每日盘面与交易复盘** —— `/api/research/daily-review` 聚合观察池涨跌家数、主要指数、账户权益、持仓、订单、手续费和逐笔理由，并用 `entryReview` 区分已经入场、运行覆盖缺口、资金约束、策略禁止、无合格候选和数据不可用。没有盘中自动执行证据且没有订单时返回 `runtime-gap`，不得把服务未运行写成“策略无信号”。行情快照日期与复盘日不一致时标记为 `stale`，隐藏旧宽度和指数并保持当日 Paper 盯市结果不可用。周末及工作日开盘前自动回看最近工作日；当前尚未接交易所节假日日历。
- **复盘审计优先级修复** —— 每日复盘优先选择最近一条盘中且已形成计划的自动执行审计；盘后重启产生的 `post-market + not-run` 不再覆盖当天最后一个 `open + watch-only` 决策，旧版没有 `session` 的有效审计仍可兼容。
- **账户收益口径纠正** —— `AccountSnapshot.dailyPnl*` 是历史字段名，当前存储实际返回账户重置以来的累计 Paper 结果；总览、账户、风险页和 WxPusher 已统一标成“累计/账户重置以来”。真正的交易日盯市结果只读取每日复盘，不再把累计结果写成今日收益。
- **SuperMind 模拟盘信号桥** —— `/api/integrations/supermind/signal-package` 将本地 paper 操作计划转换为可人工复核的 SuperMind 信号 CSV 和云端策略模板；该接口不登录同花顺、不保存密码/Cookie/Token，也不会自动提交订单。
- **有界多源真实新闻与全球市场流** —— AkShare `/api/research/news` 聚合财新市场、央视宏观和最多 8 只 A 股的东方财富个股新闻，最多返回 80 条，使用稳定 SHA-256 ID 按链接/规范标题去重并缓存非空响应 15 分钟。Fastify `/api/research/real-data-feed` 优先覆盖当前持仓、再按成交额补齐标的并做第二层兼容去重；前端按全部/宏观/市场/个股分类、每页 10 条展示来源覆盖、标的覆盖和去重数量。部分源失败保留其他真实新闻和警告，不使用静态新闻，也不直接修改策略或订单。
- **真实板块与历史日线桥接** —— AkShare 桥接新增真实行业板块、行业日线和个股前复权日线接口；行业快照优先东方财富并回退到同花顺行业一览，行业历史优先东方财富并回退到同花顺行业指数，个股历史依次尝试东方财富、腾讯和新浪。请求限制为最多 20 个板块、12 只股票和 60 至 500 个交易日，返回实际来源、抓取时间、复权语义与部分失败警告。
- **板块 3/5 日展望与滚动验证** —— `/api/research/market-regime` 使用真实板块日线、当前板块涨跌/广度/资金流计算启发式增长评分，并逐日滚动比较之后 3/5 个交易日结果，返回样本数、方向命中率和平均前瞻收益。板块快照读取 80 个行业后等距抽取强、中、弱样本，并在有界样本中保留少量科技行业，避免强势科技从高位回落后直接掉出盘中检测名单。评分不是校准概率，也不代表确定收益。
- **洗盘候选与趋势恶化识别** —— 同一研究接口使用 180 日个股前复权日线，基于 20/60 日收益、均线斜率、回撤深度和量能变化区分“缩量洗盘候选、趋势恶化、健康趋势、信号不清、数据不足”；洗盘只作为待确认解释，不做必然拉升断言。
- **KAIROS 形态策略与回测日期修复** —— “洗盘恢复”“趋势健康”和“风险收缩修复”均已纳入确定性研究，内置优化策略为 15 种，并进入合成样本排行榜候选。回测仓储使用当前历史 bar 的市场日期执行 A 股 T+1，不会把所有历史 bar 错当成电脑当天而永久拦截卖出。
- **真实板块研究前端** —— 市场页新增“板块展望 / 形态识别”模块；旧 `FlowPanel` 不再读取静态 `sectorFlows`，上游不可用时显示降级原因。桌面与手机宽表格将横向滚动限制在模块内部。
- **市场状态自适应策略路由** —— `AdaptiveStrategyRouter` 使用真实行业 20/60 日收益、均线斜率、波动率、板块宽度、当日平均涨幅和个股形态宽度，确定性输出七类市场状态、置信度、允许/禁用策略、仓位姿态、现金储备和新增仓位缩放。新增 `risk-off-recovery` 用于区分中期弱势与单日广度修复，默认仍禁止新增仓位。它只在 AkShare 只读行情模式下参与本地 paper 计划；Mock 模式继续保留原有确定性演示行为。
- **策略路由 1.4 部分数据可用性** —— 七类市场状态分别输出优先策略、适用条件、回避条件、复核触发器以及开盘/上午/下午/尾盘最大 paper 仓位。真实研究只要有至少 2 个满足长度要求的板块序列和 1 个满足长度要求的股票序列，就可继续使用已完成证据并把非致命警告保留到 `riskFlags`；覆盖不足时仍回退 `unclear`。同一交易日已确认 `risk-off` 或 `risk-off-recovery` 后，短暂降级继续保持防守标签、新增仓位缩放为 0，数据恢复后直接采用新路由。
- **分时资金节奏与执行前预检** —— 本地 paper 自动执行器在 09:30、10:15、13:00 和 14:15 四个阶段重新评估，先完成每日/阶段/单轮笔数、幂等、行情、现金储备和买入后总仓位检查，再形成精确的本轮模拟动作；普通降风险卖出不受买入仓位上限限制，但仍受阶段订单预算约束。
- **十条预算化 WxPusher 简报** —— 每天最多 10 次提供商请求；09:35、10:30、13:30、14:50 四条固定简报承担开盘定调、上午确认、午后风控和尾盘复核，其余最多六条只预留给重要事件。标题和正文显示“今日第 N/10 条”、固定简报序号、本条职责和下一时点；内容按结论、数字、动作、持仓、策略盘面、前三板块、两条有效新闻、外围影响、模拟执行和风险数据分层，尾盘条额外汇总当日成交、拒单、手续费、Paper 盈亏和明日复核条件。
- **重要事件合并去重** —— 当前配置股票池进入 `risk-off`、核心板块研究降级、本地 paper 出现拒单、交易暂停、科技板块从观察高点回撤至少 1.5 个百分点或非科技强势板块严重回撤时可使用事件预留；同类事件同一交易日只提醒一次，多类事件同轮合并。回撤消息显示板块名称、观察高点、当前涨幅和回撤幅度，并说明该信号不等于趋势反转。辅助新闻/外盘降级只进入固定简报数据提示，不会停止核心板块脉冲积累。所有尝试共享十条预算且审计不保存凭据。
- **真实新股申购研究** —— AkShare 桥接新增东方财富新股申购表只读端点，Fastify `/api/research/ipo-subscriptions` 按北京时间筛选前后 30 天的今日/即将申购、待上市和近期上市记录；只用发行价与发行/行业市盈率形成 0-100 启发式规则分，未定价时等待定价，上市后涨幅不参与历史建议。市场页提供三个标签和来源/风险展示，不读取账户资格或自动申购。
- **按名称/代码的个股趋势研判** —— AkShare 桥复用全 A 股内存行情缓存解析代码、完整名称和模糊名称；Fastify `/api/research/stock-trend` 读取单股默认 360 日前复权日线，基于均线、5/20/60 日动量、RSI、波动、ATR 和量能输出 3/5/10 个交易日规则分，并严格滚动验证过去同方向信号。市场页显示真实 Close/MA20/MA60 图、经验涨跌/震荡概率、阶段高低点中位交易日和幅度、支撑压力、依据与风险；规则分和经验频率都不是校准后的未来概率，也不会触发订单。
- **A 股五日变盘雷达** —— `/api/research/turning-points` 使用决策时点冻结的 20 日区间和 ATR 阈值定义之后 5 个交易日的向上、向下或不变盘，并按历史相似压缩状态统计条件频率；至少 20 个样本才返回概率，样本不足时明确留空。准备度综合历史频率、压缩、边界、量能和样本置信度，仅用于排序，当前只扫描最多 12 只受控观察池且不会直接生成 paper 或真实订单。
- **港股真实只读研究** —— AkShare 桥新增 `/api/market/hk/quotes` 与 `/api/market/hk/history`，Fastify `/api/research/hong-kong-market` 输出真实港股快照、前复权日线、5/20/60 日趋势、波动、回撤、量能和同趋势历史验证。快照优先新浪并回退东方财富，历史优先东方财富并回退新浪；港股不读取账户，不继承 A 股 T+1、100 股整手或费用规则，也不进入当前 A 股 paper。
- **真实 A 股多窗口稳健性验证** —— `/api/research/strategy-robustness` 从真实可交易快照按流动性选取最多 12 只 A 股，读取每只最多 500 根前复权日线，以预先固定参数在三个互不重叠窗口独立回测 14 个代表策略。报告交易数、盈利窗口、中位/最差收益、平均/最差回撤、平均胜率、平均夏普和平均盈亏比，并生成 0-100 证据分与窗口/交易样本/尾部收益/回撤脆弱标签；证据分衡量验证充分度，不是盈利概率。不在验证样本上重新调参，并与合成参数排行榜分开展示。
- **国内期货只读研究桥** —— AkShare 桥接和 Fastify 提供 16 个白名单主连代码的快照与有界历史接口，历史单次查询上限与受控观察池一致为 16，覆盖股指、贵金属、有色、黑色、能源化工和农产品。历史序列明确标记 `continuous-main`；Fastify 会透传有界的桥接错误详情，上游失败返回空结果和警告，不返回静态价格，也不读取期货账户或生成期货订单。
- **跨市场策略上下文** —— `/api/research/cross-market-strategy-context` 组合全球指数、股指期货、工业品和贵金属的真实只读数据，输出 `risk-on / neutral / risk-off / mixed`、优先与降权策略族、仓位姿态、证据和降级信息。该结果只解释当前适用策略，不直接修改 A 股 paper 计划或提交订单。
- **外部市场对 A 股影响研究** —— AkShare 桥新增受控全球指数快照/历史、A 股指数历史和 BTC/ETH 快照端点；Fastify `/api/research/external-market-impact?days=500` 按美股隔夜、亚洲市场和数字资产分组，并只使用严格早于 A 股目标交易日的外部收盘验证沪深 300 条件统计。少于 60 个样本不显示命中率，BTC/ETH 不能独立产生方向，所有结果均为只读观察。
- **外盘 shadow 与紧凑特征** —— 外盘历史至少达到 250 个样本、三个窗口和 3 个百分点方向命中改善时才生成最多 5% 的 shadow 修正；正式策略置信度、`allowNewPositions` 和仓位上限不变。可选采样器默认关闭且只允许 `paper + akshare`，09:20/15:10 更新每日同一行，默认最多 750 行，不保存原始响应、tick 或分钟线。
- **市场研究十页签** —— 市场页按 A 股概览、变盘雷达、个股研判、板块形态、港股观察、期货研判、全球影响、数字资产、事件资讯和玄学观察拆分；页签支持方向键和 Home/End，390px 下两列排列，宽表横向滚动限制在模块内部。
- **市场页按需加载与真实指数图表** —— 十个市场研究内容已拆为独立 `React.lazy` 异步块，并在悬停、聚焦或触屏按下页签时预取；全球影响和玄学观察页也保持独立异步块。指数图表使用当前真实指数快照的昨收、今开、最低、最新和最高点，不再显示静态模拟分时数组。
- **玄学观察娱乐研究层** —— 市场页可按观察对象、日期和易经卦象/五行节律/数字起卦生成固定、可复现的文化观察笔记；三种方法使用不同解释镜头，并把真实快照的上涨宽度、平均涨跌、振幅、覆盖率和新鲜度作为独立盘面镜像，显示一致/冲突及收盘复盘问题。娱乐观察指数明确不是胜率或预测概率，全部结果仍不会进入策略路由、Paper 计划、自动执行器或 WxPusher 消息。
- **单票玄学观察** —— 玄学页可在当前真实股票快照中选择单票，以代码和名称固定文化结果，并把该票真实现价、涨跌、振幅和报价新鲜度放在独立现实镜像中；相同日期、股票、方法和轮次结果可复现。单票象意仍不表示涨跌概率，也不进入策略、通知、持仓、风控或订单路径。
- **持仓优先且双扫描器均衡的历史形态研究** —— 生成市场状态前会把当前 paper 持仓放在个股历史研究队列前部，再交错加入今日候选和每日优质股；去重后仍限制最多 12 只，既避免候选池挤掉已有持仓，也避免单一扫描器占满研究名额。
- **趋势恶化减仓与现金观察** —— `risk-off` 下，高置信度“趋势恶化”且 T+1 可卖的持仓会生成有上限的半仓减仓计划；原有 3% 亏损退出仍是更严格的全量止损。健康趋势和洗盘候选明确保持观察；从计划开始就没有任何一手可负担候选时，只生成一条现金观察，不再重复列出十条注定资金不足的买入。
- **风险收缩日内减仓纪律** —— 普通市场状态减仓和风险仓位再平衡按持久化订单限制为同一标的每个交易日最多一轮，避免多次“减半”突破原风险预算；3% 硬止损仍可覆盖该限制。`risk-off` 且仓位高于现金目标时，计划优先对趋势恶化、信号不清或数据不足且 T+1 可卖的持仓执行最多四分之一仓位的一手级分阶段减仓，不机械卖出健康趋势或洗盘候选。
- **自动执行审计降噪** —— `PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY=true` 时，定时器只在 A 股交易时段运行；盘前、午休、盘后和周末不再每分钟写入重复跳过记录。交易时段内相同的无订单 timer 结果只在状态变化或 15 分钟心跳时持久化；订单提交、拒绝、manual、startup 和决策审计仍逐笔保留。
- **策略状态前端解释** —— 研究管线页显示当前市场状态、路由置信度、仓位姿态、现金储备、选中策略、允许策略数量和是否允许新增 paper 仓位，不把启发式置信度描述为盈利概率。
- **策略实验室阶段式工作流** —— 策略页按“配置策略、合成回测、独立真实验证、Paper 观察”四阶段按需挂载内容；修改已运行配置会明确标记旧结果过期，真实历史固定策略组不会冒充当前浏览器参数结果。
- **总览首屏按视口延迟** —— 新增 `ViewportDeferred`，总览下方的回测图表、板块展望和真实新闻接近视口时才挂载；占位保留稳定高度，快速跳过模块时也会通过滚动兜底挂载；这会延迟 Recharts 图表块和新闻请求，不改变数据或交易语义。
- **总览每日任务中心** —— 总览复用当日 Paper 计划、每日市场复盘和本地自动执行器状态，按盘前、盘中、午间、盘后和非交易日展示任务阶段，并汇总计划质量、市场状态、资金仓位、订单结果、异常原因和下一步动作；任一接口失败时保留其余可用事实，真实交易继续关闭。
- **Paper 观察列表分页** —— 每日优质股继续有界请求 30 条、今日候选继续有界请求 24 条，两张表在浏览器端每页只渲染 8 条；页码会在数据缩短后自动夹紧，当前仅减少 DOM 和滚动噪音，不改变研究评分、排序或后端查询语义。
- **系统日志服务端分页** —— `/api/logs` 默认每页 50 条、单页上限 200 条，返回原始总数、过滤总数、当前页数量、页码和前后页状态；日志页支持前后页、模块防抖搜索和正确范围展示，进入历史页会暂停自动刷新，导出明确限定为当前页 JSON。
- **开发服务异常恢复** —— `npm run dev` 与 `npm run dev:a-share` 以 `concurrently` 监督前台 API，并对非零退出无限重启；`npm run dev:api:watch` 单独保留代码热重载。这样 API 子进程退出后不会只留下一个仍存活但无法提供 `8787` 的 watcher 父进程。
- **移动导航状态修复** —— 980px 以下未打开的侧栏保持隐藏，菜单按钮打开抽屉、关闭按钮关闭抽屉；390px 页面无横向溢出，不再同时显示旧顶部侧栏和抽屉导航。
- **历史研究单序列缓存接入** —— A 股、港股和国内期货历史端点按市场、代码、来源、复权、截止日期与窗口复用单序列缓存，支持 single-flight 和 stale-while-revalidate；失败的空序列不进入缓存。
- **研究缓存容量硬上限** —— AkShare 普通研究响应使用默认 64-key 的 TTL/LRU，历史单序列使用默认 128-key 的 TTL/LRU；读写路径主动清理过期项，进行中的历史请求不会被容量淘汰，桥接 `/health` 返回当前条目、上限、淘汰和过期清理统计。
- **开发日志磁盘预算** —— `npm run dev` 与 `npm run dev:a-share` 启动前只清理仓库内 `logs/*.log`；默认保留 7 天、单文件 20 MB、目录总量 100 MB，最近 5 分钟仍在写入的文件跳过。该清理器不扫描交易 `data/` 或 `node_modules/`。
- **查询短退避恢复** —— TanStack Query 仅对网络错误和 HTTP 5xx 最多重试两次，HTTP 4xx、认证失败和不可解析响应不重试。
- **港股刷新降级保护** —— 港股观察已有成功报告时，后台刷新失败不会清空表格；页面继续显示缓存报告、明确刷新失败，并标出最后成功更新时间。首次加载失败仍显示阻断错误。
- **统一研究查询状态起点** —— 新增可复用的 ResearchQueryState，统一首次加载、无缓存阻断失败和有缓存刷新失败三种展示；港股观察与期货研判已接入，其他研究模块仍待逐步迁移。
- **期货研判刷新降级保护** —— 期货研判已有成功报告时，后台刷新失败继续显示缓存报告，并明确显示缓存来源状态和最后成功更新时间；首次加载失败仍显示阻断错误。
- **策略稳健性刷新降级保护** —— A 股策略多窗口稳健性已有成功报告时，后台刷新失败继续显示缓存报告，并明确显示最后成功更新时间；首次加载失败仍显示阻断错误。
- **变盘雷达刷新降级保护** —— A 股五日变盘雷达已有成功报告时，后台刷新失败继续显示缓存候选和最后成功更新时间；首次加载失败仍显示阻断错误。
- **板块形态刷新降级保护** —— 板块展望与形态识别已有成功报告时，后台刷新失败继续显示缓存研究结果和最后成功更新时间；首次加载失败仍显示阻断错误。
- **新股研究刷新降级保护** —— 新股申购研究已接入统一 `ResearchQueryState`；已有成功报告时，后台刷新失败继续显示缓存列表和最后成功更新时间，首次加载失败仍显示阻断错误。
- **个股趋势研判刷新降级保护** —— 按名称或代码查询的个股趋势研判已有成功报告时，后台刷新失败继续显示缓存图表、周期研判和最后成功更新时间；首次查询失败仍显示阻断错误。
- **个股研判统一查询状态** —— 个股趋势面板已接入统一 `ResearchQueryState`，复用首次加载、无缓存阻断失败和缓存刷新失败语义，并继续透传具体查询错误。
- **真实事件流刷新降级保护** —— 真实新闻与外围市场已有成功报告时，后台刷新失败继续显示缓存新闻、外围影响和最后成功更新时间；首次加载失败仍显示阻断错误。
- **真实事件流统一查询状态** —— 真实新闻与外围市场面板已接入统一 `ResearchQueryState`，复用首次加载、无缓存阻断失败和缓存刷新失败语义，同时保留上游数据质量警告。
- **A 股概览板块展望统一查询状态** —— A 股概览中的板块 5 日展望已接入统一 `ResearchQueryState`；首次加载和无缓存失败统一展示，后台刷新失败时继续保留上次成功的真实历史评分与更新时间。
- **今日候选统一查询状态** —— 今日候选扫描已接入统一 `ResearchQueryState`；首次加载和无缓存失败统一展示，后台刷新失败时继续保留上次成功的候选清单与更新时间。
- **每日优质股统一查询状态** —— 每日优质股观察池已接入统一 `ResearchQueryState`；首次加载和无缓存失败统一展示，后台刷新失败时继续保留上次成功的评分清单与更新时间。
- **策略排行榜统一查询状态** —— 策略排行榜已接入统一 `ResearchQueryState`；首次加载和无缓存失败统一展示，后台刷新失败时继续保留上次成功的排行榜与更新时间。
- **研究记忆统一查询状态** —— 研究管线的样本积累状态已接入统一 `ResearchQueryState`；首次加载和无缓存失败会明确展示，后台刷新失败时保留上次成功的研究记忆与更新时间。
- **订单名称语义补全** —— 新建本地 paper 订单在创建时保存行情名称；旧版 JSON 订单继续兼容，并可由当前行情或持仓名称补全。独立订单历史、下单页挂单队列与最近订单、旧账户页、名称/代码搜索和浏览器 CSV 导出统一展示名称与代码，服务端 CSV 导出也包含名称列。
- **顶部快速页面跳转** —— 顶部搜索框支持总览、市场、策略、模拟账户、研究管线和设置，可按页面名称或“行情、回测、下单、订单、配置”等工作流关键词过滤；回车进入首个匹配页面，Esc 关闭结果。
- **研究历史缓存可观测性** —— 独立历史缓存可返回 fresh 命中、stale 命中和阻塞 miss 累计计数快照，为后续桥接指标与缓存命中 P95 验收提供基础。
- **历史研究有界调度与超时收敛** —— A 股、板块、港股、期货、A 股指数和全球指数日线共用最多 24 个接纳任务、2 个活跃任务的桥接调度器；单次 20 个行业板块或 16 个期货主连默认会被完整接纳，不再因正常观察池规模直接提示队列繁忙。批次默认 6 秒先返回已完成真实序列，其余任务后台预热，超过接纳上限或上游超时时才给出明确 `warning`。Fastify 历史读取统一限制在 8 至 30 秒，不再把基础超时放大到 60 至 360 秒；A 股历史不再调用无明确超时参数的新浪第三回退。
- **工作台事实一致性与响应式收口** —— 总览、侧栏、顶栏和研究环境统一读取实时后端连接、AkShare/Mock 行情源与本地 paper 执行状态，不再同时显示“已连接”和“交易后端不可用”或把 AkShare 写成模拟行情。1440×900 与 390×844 验证无页面级横向溢出，手机账户分组导航不再出现滚动箭头。
- **Paper 账户生命周期控制** —— 受保护的 `POST /api/account/reset` 可按 1,000 至 100,000,000 元重新建立本地 paper 账户，并原子清空旧持仓、订单、交易审计和风险状态；设置页要求确认短语与复选确认。`PUT /api/account/strategy-profile` 可在不清空账户时切换现金防守、稳健、均衡和进取四档。浏览器设置页不再保存或展示 API 密钥。
- **策略档位进入计划与复盘** —— 四档策略分别限制现金底线、候选阈值、单轮新仓数量和仓位缩放；档位只会进一步收紧或有界调整 paper 节奏，不能覆盖市场 `risk-off`、T+1、100 股整手、现金、仓位、熔断和真实交易关闭等硬约束。每日复盘返回当前档位、纪律检查和下一步建议。
- **WxPusher 真实模拟操作摘要** —— 四条固定简报明确分开“当日已成交”“本时段计划”和“未成交/拒绝”，实际成交包含股票名称/代码、买卖方向、数量、成交价、金额、手续费、策略和审计理由；历史缺失理由明确标注缺失，不做事后推测。
- **独立数字资产观察** —— 市场页新增“数字资产”页签，通过轻量 `/api/research/crypto-market` 读取 BTC/ETH 24 小时公开快照，只作为全球风险偏好补充。请求最多等待 5 秒，失败时不使用静态价格；普通外部 JSON 请求使用独立执行器，不阻塞串行 AkShare 行情任务，也不提供数字资产账户或订单。
- **统一图表主题与响应式尺寸** —— Recharts 统一网格、坐标轴、Tooltip、涨跌颜色和移动端高度；主要指数在有真实快照时展示日内高低/昨收/今开/最新关键位置，不把静态折线冒充实时分时。桌面和 390px 浏览器验证无页面级横向溢出。
- **一键启动首轮恢复** —— VS Code 后台任务使用无 ANSI 输出和宽松的 `127.0.0.1:4173` 就绪匹配；API 即使早于 AkShare 首批行情启动，自动 paper 执行器也会记录一次 `not-run` 观察并等待后续轮次，不再因空行情异常退出。
- **隔夜持续性与费用纪律** —— AkShare Paper 新增仓位优先把持仓和交错后的高排名候选纳入最多 12 只真实历史日线池。健康趋势可进入下一步；洗盘候选只有在置信度、至少 20 个验证样本和 5 日历史命中门槛同时通过时才放行。唯一的信号不清例外是已路由到震荡市场的 RSI/布林带候选：必须至少 120 根历史、置信度不低于 0.55，且 20 日收益、MA20 偏离和斜率都在受控范围。趋势恶化、数据不足、历史未覆盖及其他信号不清仍停止买入；预计往返最低佣金超过计划金额 1% 或当日已自动卖出同一标的也不会创建 Paper 买单。
- **行情适配的候选策略组合** —— 本地 Paper 候选会根据当前市场允许策略和真实股票历史形态，在低波趋势、趋势健康、动量确认、均线交叉、MACD 确认、海龟突破、安静回踩、洗盘恢复、A 股强势回踩、RSI 区间回归与布林带下沿回归之间选择。趋势类限制当前涨幅和振幅，均值回归类只在震荡状态、日内低位和非趋势恶化形态下启用；`risk-off`、`risk-off-recovery` 和 `unclear` 仍不新增仓位。没有同时满足历史证据和当前路由的候选明确记录为 `blocked`，不为制造交易强行放行。
- **Fastify 只读研究请求缓存** —— `bridgeRequest` 对相同 URL、凭据哈希作用域和请求实现进行在途去重及短时复用，最多保留 64 项；失败请求立即移除，过期或超限项有界淘汰，缓存键不保留原始 Token。该缓存只用于新闻、板块/股票历史、全球市场、期货和数字资产等只读桥接读取，不缓存账户、持仓、订单或交易审计。
- **新闻轻量刷新** —— 新闻面板单独请求最多 40 条新闻和 3 个股票标的，不再为刷新新闻重复拉取全球市场；成功数据缓存 10 分钟、每 15 分钟后台刷新，刷新期间保留旧内容。完整真实研究流仍可按需读取全球市场影响。
- **二级研究缓存覆盖** —— 跨市场、港股、个股趋势、策略稳健性、变盘雷达和新股申购读取均已接入同一有界桥接缓存；当前行情/快照使用 1 至 2 分钟，历史序列使用 10 分钟，新股元数据使用 30 分钟。相同历史窗口复用，不同股票池或交易日窗口严格分键。

## 仍为静态或合成的数据

- 浏览器端策略实验室的 `src/lib/backtest.ts` 仍使用固定种子合成价格；策略排行榜也仍从当前快照生成确定性合成历史，二者不能当成真实历史回测。独立的多窗口稳健性报告使用真实前复权日线，但当前样本仅 8 只股票和三个窗口，仍不是生产级全市场样本外结论。
- `MarketChart` 的盘中折线仍由当前指数快照和静态时间点生成，只能视为快照可视化，不是真实逐分钟历史。
- `TradingStrategies`、`PositionPlan` 中的分批建仓、网格和定投计划仍是演示配置，未接账户策略持久化。
- `LearningPipeline` 的流程阶段说明以及通知中心样例仍有静态展示；订单、持仓、账户、审计和自动 paper 执行状态来自后端。
- `src/data/mockData.ts` 仍保存策略目录和离线降级样例。真实板块模块、真实新闻模块和在线账户不再使用其中的板块资金、新闻、持仓或订单样例。
- 财务因子、估值、公告结构化数据、Level-2 资金流、逐笔成交、授权券商历史和真实账户数据尚未接入。
- `RiskEngine.maxDailyLoss` 当前仍读取历史命名的账户累计 `dailyPnlPercent`，并不等于具备持久化交易日基线的严格日内亏损控制；因为系统仍是本地 paper，该限制保持保守观察。任何真实执行设计前必须先完成按交易日持久化的独立风控口径。

## 可用接口

```text
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/health
GET  /api/capabilities
GET  /metrics                              (Prometheus 指标)
GET  /api/market/snapshot
GET  /api/market/quality
GET  /api/system/performance
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
GET  /api/research/strategy-robustness?limit=12&days=500
GET  /api/research/cross-market-strategy-context?limit=12&days=180
GET  /api/research/external-market-impact?days=500
GET  /api/research/crypto-market
GET  /api/market/futures/quotes?limit=16
GET  /api/market/futures/history?symbols=IF0,CU0&days=180
GET  /api/trading/auto-paper-execution/status
GET  /api/account
POST /api/account/reset
PUT  /api/account/strategy-profile
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
2026-08-09 production market recovery and single-stock esoteric observation
Server Vitest: 57 files, 828 tests passed
Web Vitest: 30 files, 105 tests passed
Python pytest: 114 tests passed; 1 FastAPI/httpx deprecation warning and 1 local pytest-cache permission warning
TypeScript project-reference checks passed; Vite production build passed with 2,321 modules transformed
Real-source check: Tencent fallback returned 4 controlled indices and the configured stock snapshot with exchange timestamps; no proxy was used
Browser: 1440x1000 and 390x844 passed; four major indices rendered, single-stock selection displayed price/change/amplitude/freshness, page overflow remained 0, and console errors were empty
Safety: Paper-only and real trading disabled; esoteric output remains outside strategy, notification, position, risk and execution paths
Production: commit 615934c46d1129cb5f305db82aacb983879de482 deployed through the restricted SSH entrypoint; all three containers healthy
Production endpoints: /healthz, /api/health, /manifest.json, /sw.js and /icon-192.svg returned HTTP 200
Production bridge: cachedIndices=4, stock cache non-empty, proxy disabled, no latest refresh errors; logs confirmed tencent-index=4 and tencent-spot=67 after upstream failures
Authenticated production snapshot: paper mode, 67 stocks + 4 indices, all 71 quotes had positive real prices
Remaining infrastructure gap: kairosq.cn resolves to 124.221.165.45 but is redirected to Tencent DNSPod webblock and cannot complete TLS SNI; ICP filing and a trusted certificate are still required for browser-safe domain access

2026-08-08 全局研究证据与总览首屏性能优化
Server Vitest: 55 files, 825 tests passed
Web Vitest: 30 files, 103 tests passed
Python pytest: 109 tests passed; 1 FastAPI/httpx deprecation warning and 1 local pytest-cache permission warning
TypeScript project-reference checks passed; Vite production build passed with 2,321 modules transformed
Browser: desktop and 390x844 responsive checks passed; initial overview kept all three deferred modules unmounted, fast scroll mounted all three, page overflow remained 0, chart SVG rendered after mount
Safety: Paper-only, real trading disabled, risk gates unchanged; esoteric output remains outside routing, notification and execution inputs
Production: restricted deployment entrypoint completed; AkShare, Fastify and Nginx containers healthy; HTTP redirects to HTTPS; /healthz, HTTPS root and /api/health returned 200; mode paper + akshare, auth enabled, real trading disabled
Remote: GitHub push remained blocked by local GitHub HTTPS reachability and unavailable write-authorized SSH key; production was updated directly through the same restricted server deployment entrypoint used by GitHub Actions

2026-08-08 esoteric observation and adaptive strategy coverage upgrade
Server Vitest: 54 files, 822 tests passed
Web Vitest: 29 files, 100 tests passed
Python pytest: 109 tests passed; 1 FastAPI/httpx deprecation warning and 1 local pytest-cache permission warning
TypeScript project-reference checks passed; Vite production build passed with 2,320 modules transformed
Focused regression: 8 files, 105 tests passed
Safety: paper-only routing remained enabled in tests; risk-off, risk-off-recovery and unclear still forbid new positions; no esoteric output enters routing, notification or execution inputs

2026-08-08 adaptive candidate routing and bounded research requests
Server Vitest: 54 files, 816 tests passed
Web Vitest: 29 files, 97 tests passed
TypeScript project-reference checks passed; Vite production build passed with 2,320 modules transformed
git diff --check passed with line-ending conversion warnings only
Runtime: ports 4173/8787/8800 were already listening; the bridge health endpoint returned 200 with bounded caches and current stock/index cache counts. This session did not restart the services.
Remaining live dependency: the authenticated `paper + akshare` check must still verify source freshness and current index/stock timestamps; upstream failures remain explicit and must not be replaced with static values.

2026-07-21 bounded history research timeout reliability
Python pytest: 109 tests passed; 1 FastAPI/httpx dependency deprecation warning
Server Vitest: 53 files, 797 tests passed
Web Vitest: 27 files, 90 tests passed
TypeScript checks passed; Vite production build passed with 2,318 modules transformed
Runtime: 4173/8787/8800 healthy; paper + akshare; auth enabled; real trading disabled; 5,528 A-share quotes and 562 indices loaded
Scheduler: max active 1, max pending 8; final active 0, pending 0, history in-flight 0; 28 accepted and completed during live validation
A-share history: first 12-symbol request returned 5 completed series in 6.2s with bounded warnings; progressive warm-up returned 12/12 without warning
Futures history: first two 16-symbol requests returned bounded partial responses; final cached request returned 16/16 in 234ms without warning or HTTP 400

2026-07-21 daily review, sector pulse and runtime reliability upgrade
Python pytest: 94 tests passed; 1 FastAPI/httpx dependency deprecation warning
Server Vitest: 52 files, 796 tests passed
Web Vitest: 27 files, 90 tests passed
TypeScript checks and Vite production build passed; 2,318 modules transformed
Runtime: 4173/8787/8800 healthy; paper + akshare; auth enabled; real trading disabled
Daily review: risk-blocked / risk-off / watch-only; 0 buys, 2 sells, cash 5935, equity 10262, review-day PnL -129, cumulative PnL +262
Browser: 1280x720 and 390x844 had no horizontal overflow; entry diagnosis was visible; no console warnings or errors
Degradation: BTC/ETH remained explicitly unavailable after the 5-second bridge limit; no static price was substituted and A-share execution stayed independent

2026-07-21 Paper account control and research experience upgrade
Python pytest: 94 tests passed; 1 FastAPI/httpx dependency deprecation warning
Server Vitest: 51 files, 779 tests passed
Web Vitest: 27 files, 89 tests passed
TypeScript checks and Vite production build passed; 2,318 modules transformed
Runtime: API remained healthy while AkShare loaded its first 5,440 stocks and 562 indices; Vite /api proxy returned JSON
Browser: 1280x720 and 390x844 had no horizontal overflow; strategy charts rendered at non-zero responsive sizes; no console errors
Entry discipline: historical persistence, missing history, fee-heavy small orders, same-day re-entry and healthy-trend pass paths covered

2026-07-19 full-chain fetch reliability hardening
Python pytest: 103 tests passed; 1 FastAPI/httpx dependency deprecation warning
Server Vitest: 48 files, 758 tests passed
Web Vitest: 25 files, 83 tests passed
TypeScript checks and Vite production build passed; 2,316 modules transformed in 4.40s

Authenticated paper + akshare runtime loaded 5,527 A-share quotes and 562 indices. Starting Fastify before the bridge produced one readable degradation line per failed round with 10/20/40-second backoff, zero raw `fetch failed` messages, then recovered without a process restart. During the observation window Fastify made 63 quote and 63 index reads while the bridge performed only 9 stock and 17 index upstream refreshes; refresh completion was followed by the configured cache TTL instead of immediately expiring.

Browser checks completed A-share overview in 20.4s, turning points in 12.2s, sector research from shared cache in 2.1s, Hong Kong research in 58.9s, futures in 4.1s, global impact in 4.1s, and news in 6.1s. No module exposed `fetch failed` or remained loading. Global impact correctly stayed degraded because the upstream batch returned 9/10 global indices, lacked HSI history, and returned 1/2 crypto snapshots; available real data remained visible and no static values replaced the gaps.

2026-07-19 bounded API observability and query reuse upgrade
Server Vitest: 47 files, 750 tests passed
Web Vitest: 25 files, 82 tests passed
TypeScript checks and Vite production build passed; 2,316 modules transformed

Authenticated paper + akshare runtime exposed the protected performance endpoint without external fetching. The clean monitor page reported healthy API and healthy market quality, excluded auth and observer endpoints from business routes, and retained only route templates, status, and bounded timing summaries.

Browser checks: desktop body 1265/1265 with four 231.7px summary columns and no header overlap; 390px viewport body 375/375 with a 354.7px monitor, one-column summaries, and the 760px route table contained by a 355px internal scroller. Manual refresh worked, and a fresh final tab had no console warnings or errors.

2026-07-19 market data quality and market-page trust upgrade
Server Vitest: 46 files, 740 tests passed
Web Vitest: 23 files, 74 tests passed
TypeScript checks and Vite production build passed; 2,315 modules transformed
git diff --check passed with line-ending conversion warnings only

Authenticated runtime used paper + akshare on ports 4173, 8787, and 8800. The quality endpoint reported healthy with overall 100/100, batch freshness 100/100, requested coverage 100/100, and zero key issues. It read the current Fastify market snapshot and did not trigger a bridge fetch.

Authenticated browser checks showed the desktop body at 1265/1265 and the 390px viewport body at 375/375. The mobile quality strip was 355px wide, used a two-column metric grid, had no text overlap, and its refresh command worked. The console had no warnings or errors; a 360px CSS boundary provides a single-column metric grid.

2026-07-19 bounded multi-source news upgrade
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q
89 tests passed; 1 FastAPI/httpx dependency deprecation warning

Server Vitest: 46 files, 736 tests passed
Web Vitest: 21 files, 66 tests passed
TypeScript checks and Vite production build passed; 2,314 modules transformed
NewsPanel chunk: 5.47 KiB
git diff --check passed with line-ending conversion warnings only

Fresh bridge result for 8 A-share symbols: 80 returned from 193 raw and 180 available items, with 13 duplicates removed; categories were 34 company, 33 market, and 13 macro across 16 sources, with no news warning. Fastify dynamically selected 300308, 300502, 688256, 688008, 300750, 000725, 688981, and 000938; it returned 80 items from 193 raw and 181 available items, removed 12 duplicates, covered 13 sources, and reported no news warning. The overall real-data source status remained degraded only because the separate global-index source returned 9 of 10 requested indices.

Authenticated browser checks showed the desktop body at 1265/1265 and the 390px viewport body at 375/375. The mobile news panel was 353/353, category controls and coverage strip were both 324/324, macro filtering showed 13 items over pages of 10 and 3, original-source links were visible, and the console had no warnings or errors.

2026-07-18 external-market impact research (runtime checked 2026-07-19 00:26 Asia/Shanghai)
D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q
84 tests passed; 1 FastAPI/httpx dependency deprecation warning

Server Vitest: 45 files, 734 tests passed
Web Vitest: 21 files, 64 tests passed
TypeScript checks and Vite production build passed; 2,314 modules transformed
MarketPage chunk: 4.54 KiB; ExternalMarketImpactPanel chunk: 6.98 KiB
git diff --check passed with line-ending conversion warnings only

Fresh services listened on 4173, 8787, and 8800. The bridge returned 9 controlled global snapshots, 5 global history series with 500 bars each, one 500-bar SH000300 series, and one BTCUSD snapshot. HSI history and ETHUSD were unavailable and remained explicit warnings. Fastify returned live-read-only / observation-only with 197 strictly aligned samples, 3 windows, 57.87% directional hit rate, restrictive bias, and allowPositionIncrease=false; the 250-sample shadow gate was not met.

Authenticated browser checks showed the desktop body at 1265/1265 and the 390px viewport body at 375/375. The external panel was 353/353 on mobile, its 940px table remained inside a 325px internal scroller, all eight tabs fit without page-level overflow, and the console had no warnings or errors.

2026-07-18 WxPusher ten-message budget and four scheduled briefings
paperPlanNotifier.test.ts: 18 tests passed
config.test.ts: 82 tests passed
Server Vitest: 42 files, 711 tests passed
Web Vitest: 21 files, 63 tests passed
TypeScript checks and Vite production build passed; 2,313 modules transformed

The local ignored .env.local now uses WXPUSHER_DAILY_MESSAGE_LIMIT=10. No real WxPusher test message was sent, so verification did not consume the provider allowance.

2026-07-18 cache and runtime storage guardrails
D:\conda\python.exe -m pytest akshare-bridge/test_research_cache.py akshare-bridge/test_bridge.py -q
88 tests passed; 1 FastAPI/httpx dependency deprecation warning

Server Vitest
42 server test files passed, 703 server tests passed

Web Vitest
21 web test files passed, 63 web tests passed

TypeScript checks and Vite production build passed; 2,313 modules transformed
git diff --check passed with line-ending conversion warnings only

Runtime log cleanup scanned 12 files and reduced logs from 41.1 MB to 2.84 MB by deleting one inactive 38.2 MB development output file. It did not scan or modify data/paper-trading-state.json. Ports 4173, 8787, and 8800 each had one listener after verification.

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

2026-07-20 本地 Paper 操作与次日复核：

1. 09:30 卖出中国铝业 100 股、09:31 卖出交通银行 100 股，分别来自高置信度趋势恶化减仓和 `risk-off` 现金目标再平衡；10:28 买入包钢股份 100 股、13:03 买入中国东航 100 股，两笔买入理由只有日内流动性、强度、换手和波动，没有历史形态准入。
2. 当天四笔全部模拟成交、拒绝 0 笔；09:30 重要 `risk-off` 提醒、10:30 上午确认、13:30 午后风控和 14:23 数据降级提醒均被 WxPusher 接受。通知接受不代表真实下单或用户批准。
3. 2026-07-21 包钢股份和中国东航均因历史形态高置信度趋势恶化卖出。按已保存成交价和两边最低手续费计算，包钢股份往返净约 -9 元、中国东航净约 -4 元；结果显示低金额短持有被最低佣金明显侵蚀，但仍只是本地 Paper 结果。
4. 复盘后的战法升级为“隔夜持续性与费用纪律”：历史未确认不买，预计往返最低佣金超过计划金额 1% 不买，当天卖出的标的不回补。该规则优先减少反复交易，不保证避免亏损。

2026-07-21 10:28（Asia/Shanghai）本地 paper 运行复盘：

1. 自动执行器为 `local-paper-broker-only`，当天提交并成交 2 笔、拒绝 0 笔、买入 0 笔；09:58 卖出包钢股份 100 股，成交价 2.16 元、手续费 5 元；09:59 卖出中国东航 100 股，成交价 3.57 元、手续费 5 元。
2. 两笔卖出均由持久化 `paper-auto-execution.decision` 审计还原：真实历史形态为高置信度趋势恶化，当前 `risk-off` 下执行减半仓位；T+1 检查通过。该记录是本地模拟成交，不是真实券商成交。
3. 复盘接口按开盘权益重建的当日 Paper 结果为 -49 元（-0.47%）；同期累计 Paper 结果为 +342 元（+3.42%）。累计结果不得描述为当日收益，也不代表真实收益。
4. 当前均衡档位账户持有工商银行 200 股、中国石油 200 股、交通银行 100 股，现金 5,935 元；最新计划为 `watch-only`，保留工商银行和交通银行，现金观察理由为 `risk-off` 禁止新增仓位，没有强制买入。
5. 当时配置的 100 只观察池中上涨 59、下跌 39、平盘 2，平均涨跌 +0.30%；该宽度不是完整交易所全市场统计。策略复盘未发现新的纪律违规，但单日样本不能证明策略有效，至少继续积累一周再比较胜率、回撤和盈亏比。

2026-07-27 无操作复盘与防守路由稳定：

1. 2026-07-22 服务覆盖盘中，53 次有效计划均为 `watch-only`；路由在真实 `risk-off` 与研究降级 `unclear` 间切换，新增仓位始终关闭，已有工商银行和交通银行历史形态未触发减仓，因此该日无成交属于主动防守。
2. 2026-07-23 仅有 08:45 盘前启动审计，2026-07-24 没有订单或自动执行审计；两日均缺少可核验的盘中运行覆盖，不能描述为策略无信号。2026-07-25、26 为周末休市。
3. 当前本地 Paper 账户仍为现金 5,935 元，持有工商银行 200 股、中国石油 200 股、交通银行 100 股；最后成交是 2026-07-21 两笔减仓。这些均不是实际券商持仓或真实收益。
4. 外部网页行情访问受当前安全策略限制，本地三服务也未运行，因此 2026-07-23、24 的完整收盘行情保持不可用，没有补写未经核验的涨跌、板块或指数数据。
5. 策略路由升级到 1.3.0：短暂数据降级不再显示成新的市场反转，也不会用陈旧历史继续普通减仓；每日复盘新增 `runtime-gap` 和快照日期校验。

验证结果：服务端 Vitest 53 个文件、804 个测试通过；前端 Vitest 27 个文件、90 个测试通过；Python 109 个测试通过（保留 1 条既有 FastAPI/httpx 弃用警告）；`tsc -b` 与 Vite 生产构建通过。

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

## 2026-08-12 验证

- Server Vitest：57 个文件、831 项测试通过。
- Web Vitest：30 个文件、105 项测试通过。
- AkShare bridge pytest：101 项测试通过；仅有依赖弃用与本机 pytest 缓存目录权限警告。
- `tsc -b` 与 Vite 生产构建通过，构建转换 2,321 个模块。
- `git diff --check` 通过；凭据扫描只命中测试占位 SPT，没有真实 Token、UID 或明文密码进入差异。
- 提交 `533c57d284b309b8126d3bac78132319d7eee284` 已通过受限归档入口部署到 `124.221.165.45`；Nginx、Fastify 与 AkShare 三个容器均为 healthy，公网 `/healthz` 与 `/api/health` 返回 200，受保护的自动执行状态和 Paper 计划匿名访问返回 401。
- 生产运行时确认 `paper + akshare`、`REAL_TRADING_ENABLED=false`、自动 Paper 开启、单轮 1 笔、每日上限 4 笔、每日成交目标 2 笔。桥接代理禁用，股票缓存 5,542、指数缓存 562，重启后历史队列空闲且无拒绝。
- 持久化 Paper 账户保留原有 100,000 元现金、0 持仓和 0 订单，没有因部署重置。部署前最后盘中运行使用 `live-read-only` 核心来源但计划质量为 `blocked`，因此没有伪造成交；新调度从下一交易时段开始接受验证。

## 2026-08-17 零成交复盘与策略活跃升级

- 生产持久化状态显示 2026-08-10 至 2026-08-17 共记录 822 轮 `paper-auto-execution.run`；账户保持 100,000 元现金、0 持仓、0 订单。有效盘中轮次多数为 `range-high-volatility + live-read-only`，候选池 12 只、可负担候选通常 5 至 6 只，但计划全部为 `blocked`。
- 根因不是行情停服或资金不足，而是高波震荡路由长期只允许资金防守、缩量回踩和严格下沿回归，当前候选没有形成策略交集；旧审计又把 6,496 条阻塞统一写成 `operation is not an executable paper auto action`，掩盖了具体计划原因。
- 新增 `KAIROS区间轮动`：只在震荡路由、至少 120 根真实历史、置信度不低于 0.55、均线斜率和价格偏离受控、流动性充足且未追高时进入后续计划检查。
- 新增显式 `PAPER_AUTO_EXECUTION_ACTIVITY_MODE`。默认 `observe` 保持诊断语义；生产 Compose 使用 `qualified-probe`，仅在 13:00 后且每日 2 笔目标仍有缺口时增加 `KAIROS合格样本验证`。数量使用满足 1% 往返最低手续费纪律的最小整手，并继续经过真实历史、费用、现金、仓位、T+1、阶段仓位、熔断、日上限和幂等检查。
- 计划服务从最近 7 天已成交自动决策审计汇总策略使用次数，只在距最高策略分不超过 10 分的合格信号中优先选择较少使用者；本轮计划内仍按策略分、防守分、候选优先级和可负担性排序。阻塞审计保留原始原因，新成交审计记录 `strategyKey`。
- 本地验证：Server Vitest 57 个文件、837 项通过；Web Vitest 30 个文件、106 项通过，新增任务中心聚焦测试后对应文件为 5 项通过；AkShare bridge 114 项通过；`tsc -b` 和 Vite 生产构建通过，转换 2,321 个模块。Python 只有依赖弃用和本机 pytest 缓存目录权限警告。
- 提交 `df9d8b78e744dad600673518a8c5635be73816b3` 已通过受限归档入口部署到 `124.221.165.45`。AkShare、Fastify 和 Nginx 三个容器均为 healthy，`/healthz` 与 `/api/health` 返回 200，匿名自动执行状态请求返回 401。
- 生产运行时确认 `paper + akshare`、`REAL_TRADING_ENABLED=false`、自动 Paper 开启、`PAPER_AUTO_EXECUTION_ACTIVITY_MODE=qualified-probe`、目标 2、每日上限 4、单轮上限 1。WxPusher 服务端配置存在，但验收没有读取或输出凭据。
- 部署前后持久化账户均保持 100,000 元现金、0 持仓、0 订单和订单序号 0，没有重置或伪造成交。部署发生在收盘后，实际成交策略键、具体阻塞原因和 WxPusher 盘中汇总仍需在下一交易时段观察。

## 2026-08-17 Paper 验证档频次升级

- 新增显式 `validation-probe` 模式：开盘阶段继续让普通策略优先，10:15 上午确认阶段起若目标仍有缺口，则启用与现有合格样本相同的真实历史、流动性、追价、费用和风控门槛。
- 生产验证目标调整为每日 6 笔，硬上限 10 笔、单轮上限 1 笔；阶段预算按开盘 50%、上午 75%、下午 100% 的既有比例约束，不会一次性批量下单。
- 活跃目标开启时，关键个股历史覆盖从 6 只提高到现有受控上限 12 只，增加不同标的和策略进入验证的机会；普通观察模式仍保持 6 只，避免持续放大历史队列负载。
- 该升级只提高本地 Paper 样本尝试频次。A 股 T+1、已有持仓不重复加仓、现金缓冲和候选历史门槛意味着实际成交可以低于 6 笔；不得通过当天买卖、无条件加仓或降低风控制造交易次数。
- 本地验证：Server Vitest 57 个文件、839 项通过；Web Vitest 30 个文件、107 项通过；AkShare bridge 114 项通过；`tsc -b`、Vite 生产构建、`git diff --check` 和凭据扫描通过，构建转换 2,321 个模块。
- 提交 `5ee398af13bccf6a029668a6b937a35c6167c3a0` 已推送到 `codex/hourly-project-optimization`，并通过受限归档入口部署到 `124.221.165.45`。首次启动暴露了服务器旧日上限 4 与新目标默认值 6 的迁移顺序冲突；使用 `qualified-probe/2/10/1` 兼容值恢复服务并完成代码部署后，再切换为最终验证参数，未读取或输出其他生产凭据。
- 生产验收确认 AkShare、Fastify 和 Nginx 三个容器均为 healthy；公网 `/healthz` 与 `/api/health` 返回 200，匿名自动执行状态请求返回 401。容器实际配置为 `paper + akshare`、`REAL_TRADING_ENABLED=false`、自动 Paper 开启、`validation-probe`、目标 6、每日硬上限 10、单轮上限 1；WxPusher 已配置，环境文件权限为 600。
- 部署后的持久化 Paper 账户仍为 100,000 元现金、0 冻结现金、0 持仓、0 订单和订单序号 0，交易未暂停。部署和最终参数切换均发生在收盘后，下一交易日仍需以实际审计记录确认成交数量、策略轮换和具体阻塞原因。

## 当前边界

- 默认行情、资金流、账户与订单数据仍是本地模拟数据；可选 AkShare 个股、主要指数、财经新闻和全球指数是只读外部数据。
- 回测和模拟成交不代表真实策略收益，也不构成投资建议。
- 策略研究排行榜当前使用确定性合成历史样本，不是授权历史行情或真实收益记录。
- 今日候选扫描器当前主要基于实时快照特征评分，不是完整历史 K 线确认；`paper-buy` 只表示可进入模拟盘观察，不是实盘下单建议。
- 每日优质股筛选器当前主要基于实时快照质量评分，尚未把真实新闻、全球市场、授权历史 K 线或财务因子纳入评分闭环；`focus` 只表示优先观察或进入 paper 小仓位验证。
- 每日任务中心只是三个既有只读/Paper 接口的展示聚合，不是新的策略决策器；“允许 Paper 观察”“暂停新增”和订单统计都只描述本地模拟账户状态。
- 研究学习状态当前只是运行期内存样本池，不是长期训练库；服务重启会清空，不能用于声称策略已完成自学习或已验证真实胜率。
- A 股强势回踩确认战法是研究候选策略，不是“稳赚”或“实盘收割”承诺；接入授权历史行情、样本外验证和模拟盘观察前，不应作为真实下单依据。
- 单股趋势研判只使用公开前复权日线和启发式技术结构；历史同向命中率不是未来胜率，未纳入公司财务、公告事件、停复牌、涨跌停可成交性或完整逐笔数据，不应作为单独下单依据。
- 变盘雷达只覆盖当前受控观察池，经验频率未完成生存者偏差修正、独立折概率校准和成交成本压力测试；当前结果是研究条件频率，不是生产级预测。
- 港股模块只读取公开快照和前复权日线，不读取港股账户，也未实现港交所交易日历、T+0、每手股数、港币/汇率和港股费用，因此不能生成港股 paper 或真实订单。
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- 系统日志分页减少网络响应和前端 DOM，启动前日志预算避免开发输出无限增长；但活动重定向日志在持续写入时可以暂时超过预算，任意模块/级别筛选仍需扫描指定日期日志文件，文件索引、异步读取和 PostgreSQL/日志平台接入仍属于后续存储优化。
- JSON 交易历史默认只保留最近 7 天，过期清理也会缩短订单幂等查询和审计回看窗口；需要长期研究的汇总结果应另行导出，不应依赖无限增长的运行状态文件。
- 新建纸面账户可通过 `TRADING_STARTING_CASH=10000` 和 `TRADING_SEED_PORTFOLIO=false` 初始化，也可在设置页输入金额和确认短语后受保护地重置；重置会删除旧 paper 持仓、订单与交易审计，但不删除研究缓存、日志或认证配置。
- A 股 paper 撮合遵守一手 100 股和 T+1 卖出限制；同日买入的 `t1LockedQuantity` 只会在后续交易日释放为可卖数量。
- 本地 paper 自动执行器默认关闭；开启后只在 `MARKET_MODE=paper` 与 `REAL_TRADING_ENABLED=false` 下运行，默认限制在 A 股交易时段，并只向本地 `PaperBroker` 提交模拟订单。
- 当前没有事务型数据库、真实账户连接或真实券商执行。
- 登录保护默认强制开启，必须显式提供账号与有效 `scrypt` 密码散列；不存在默认账号或默认密码。`AUTH_ENABLED=false` 只允许测试环境。当前会话保存在单个 Fastify 进程内，服务重启会要求重新登录，多实例部署前需要共享会话存储。
- `REAL_TRADING_ENABLED=true` 与 `MARKET_MODE=live` 都会拒绝启动。
- AkShare 模式必须使用 `MARKET_MODE=paper`，真实行情不改变订单执行权限。
- 行情质量 `healthy / degraded / unusable` 只描述当前内存快照的可读性，不代表策略胜率、可成交性或订单许可，也不会直接改变自适应路由、paper 仓位或风险限额。
- 当前没有任何真实订单执行代码。
- 新闻面板在 AkShare 模式下优先读取真实只读研究流；若源不可用会显示降级状态，不再用静态模拟新闻冒充真实来源。活跃板块面板使用公开行业快照及可用的公开主力净流入字段，但不属于授权 Level-2 资金流；主要指数卡片和指数快照图使用只读指数行情。当前仍未接入真实逐笔或完整分时历史曲线。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。


- 2026-08-22 Paper 活跃度升级：新增 `kairosValidationBasket` 受控验证路由。它只在 `validation-probe`、非 `risk-off`/`unclear`、主策略无信号、真实历史至少 120 根、候选评分/流动性/价格波动通过时出现；仍使用费用效率最小整手，并继续经过现金、仓位、T+1、阶段预算、每日 10 笔上限、熔断和幂等检查。该路由只增加可验证 Paper 样本机会，不承诺每天成交、胜率或收益。核心回归测试与 TypeScript 类型检查已通过。
