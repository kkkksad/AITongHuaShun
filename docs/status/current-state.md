# 当前状态

**核对日期：** 2026-07-14

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
- **回测参数优化器** —— 网格搜索 + 遗传算法，支持 9 种策略的参数优化、多目标加权评分、收敛曲线追踪。
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
- **可选本地登录保护** —— `AUTH_ENABLED=true` 时主 Fastify 服务注册 `/api/auth/*`，并用短期 HMAC 令牌保护 API；默认 `AUTH_ENABLED=false`，本地开发仍为未保护模式且没有默认凭据。
- **认证感知前端连接** —— 前端先确认登录配置和用户状态，只有认证关闭或已登录后才拉取交易 bootstrap 并建立 WebSocket，避免登录页误报后端离线或产生未授权请求。
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
- **A 股链路健康检查** —— `npm run check:a-share` 可验证 Fastify API、AkShare 桥接、Vite 代理、指数行情、个股行情和 KAIROS 行情快照是否处于同一套正在运行的服务。
- **纸面账户纯现金启动配置** —— `TRADING_STARTING_CASH` 控制新建本地模拟账户初始资金，`TRADING_SEED_PORTFOLIO=false` 可关闭默认演示持仓种子，用于从 10000 元纯现金开始做本地 paper 观察。
- **大盘指数展示修正** —— 主要指数卡片在 AkShare 模式下显示指数成交额，市场页指数图表改为使用当前后端指数快照，不再把静态模拟分时图伪装成实时大盘走势。
- **A 股 T+1 纸面规则** —— 持仓快照新增 `availableQuantity` 与 `t1LockedQuantity`；当天买入数量在本地 paper 账户中会被锁定，当天卖出会被风控拒绝。
- **每日纸面操作计划** —— `/api/research/paper-trading-plan` 基于策略排行榜、今日候选、每日优质股、账户资金和 A 股交易规则生成只读操作过程；计划会从更大候选池里优先选择 10000 元 paper 账户买得起一手的标的，同时继续展示 T+1、现金和仓位拦截原因。
- **纸面计划质量诊断** —— `/api/research/paper-trading-plan` 新增 `qualitySummary`，返回候选池数量、可买候选数量、持仓冲突数量、动作分布、拦截原因、拟买入/卖出金额和现金使用比例；研究管线页面展示该诊断，用于判断系统是在主动生成可执行 paper 计划，还是因为资金、T+1 或持仓约束保持观望。
- **本地 paper 自动执行器** —— `PAPER_AUTO_EXECUTION_ENABLED=true` 时，Fastify 会在 A 股交易时段按间隔读取纸面计划，把 `paper-buy-plan` / `paper-sell-plan` 提交到本地 `PaperBroker`；状态接口为 `/api/trading/auto-paper-execution/status`，手动触发接口为 `/api/trading/auto-paper-execution/run`。该执行器只作用于本地模拟账户，继续受 100 股一手、T+1、现金、仓位、熔断和幂等键限制，不连接真实券商。
- **自动执行完整留痕** —— 每次本地 paper 自动运行都会追加 `paper-auto-execution.run` 审计，记录交易时段、计划质量、订单状态和跳过原因；即使没有订单或处于盘外，也能在重启后通过 JSON 审计复盘。
- **七天交易历史留存** —— JSON 仓储默认按 `TRADING_HISTORY_RETENTION_DAYS=7` 清理已结束订单和审计事件，同时永久保留账户现金、当前持仓、暂停状态、序列号和未完成订单，防止本地状态文件无限增长。
- **KAIROS 防守型策略组** —— 新增低波趋势、安静回踩和资金盾牌三种确定性研究策略，内置优化策略总数增至 12；排行榜与纸面计划更重视最大回撤、Sortino、Sharpe、盈利因子和候选防守分，低分候选会保持观望。结果仍是回测/本地 paper 研究，不是实际收益。
- **累计资金预留与保守执行节奏** —— 同一批 paper 买单会按顺序扣减预计成交额和手续费，默认保留权益的 10% 现金，并将自动执行收紧为每轮最多 1 笔、每天最多 4 笔；当日笔数从持久化订单统计，服务重启不会重置日限额。提交前再按最新报价、滑点和佣金复核，资金不足时只记录跳过原因，不创建订单。
- **逐笔交易理由审计** —— 新自动订单会写入 `paper-auto-execution.decision`，保留策略名称、买卖理由、规则检查、预计金额和最终状态；修复前缺失的历史理由明确标注缺失，不做事后推测。
- **每日盘面与交易复盘** —— `/api/research/daily-review` 聚合观察池涨跌家数、主要指数、账户权益、持仓、订单、手续费和逐笔理由，并在研究管线页展示策略优点、问题和下一步改进。
- **SuperMind 模拟盘信号桥** —— `/api/integrations/supermind/signal-package` 将本地 paper 操作计划转换为可人工复核的 SuperMind 信号 CSV 和云端策略模板；该接口不登录同花顺、不保存密码/Cookie/Token，也不会自动提交订单。
- **真实新闻与全球市场只读研究流** —— AkShare 桥接新增 `/api/research/news` 与 `/api/market/global`；Fastify 新增 `/api/research/real-data-feed` 聚合真实新闻、全球主要指数和 A 股影响摘要。前端新闻面板优先展示该真实只读研究流，源不可用时明确显示降级，不再用静态模拟新闻替代真实来源。

## 可用接口

```text
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
│   ├── index.ts                 # 统一导出 + 9种策略工厂
│   └── optimizer.test.ts       # 22 tests
├── research/
│   ├── strategyLeaderboard.ts   # 策略研究排行榜（只读研究端点）
│   ├── dailyCandidates.ts       # 今日候选扫描器（只读研究端点）
│   ├── dailyQualityStocks.ts    # 每日优质股筛选器（只读研究端点）
│   ├── realResearchData.ts      # 真实新闻与全球市场只读研究流
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
- 默认使用内存状态；可选 JSON 文件只适合本地单进程恢复，不是生产数据库。
- JSON 交易历史默认只保留最近 7 天，过期清理也会缩短订单幂等查询和审计回看窗口；需要长期研究的汇总结果应另行导出，不应依赖无限增长的运行状态文件。
- 新建纸面账户可通过 `TRADING_STARTING_CASH=10000` 和 `TRADING_SEED_PORTFOLIO=false` 从 10000 元纯现金开始；已有 JSON 状态文件不会被自动覆盖，需要用户明确删除或移走后才会重新初始化。
- A 股 paper 撮合遵守一手 100 股和 T+1 卖出限制；同日买入的 `t1LockedQuantity` 只会在后续交易日释放为可卖数量。
- 本地 paper 自动执行器默认关闭；开启后只在 `MARKET_MODE=paper` 与 `REAL_TRADING_ENABLED=false` 下运行，默认限制在 A 股交易时段，并只向本地 `PaperBroker` 提交模拟订单。
- 当前没有事务型数据库、真实账户连接或真实券商执行。
- 登录保护默认关闭；开启 `AUTH_ENABLED=true` 时必须显式提供账号、至少 12 位密码和至少 32 位 `JWT_SECRET`，不存在默认账号、默认密码或默认 JWT 密钥。
- `REAL_TRADING_ENABLED=true` 与 `MARKET_MODE=live` 都会拒绝启动。
- AkShare 模式必须使用 `MARKET_MODE=paper`，真实行情不改变订单执行权限。
- 当前没有任何真实订单执行代码。
- 新闻面板在 AkShare 模式下优先读取真实只读研究流；若源不可用会显示降级状态，不再用静态模拟新闻冒充真实来源。资金流仍使用前端静态模拟数据；主要指数卡片和指数快照图在 AkShare 模式下使用只读指数行情。当前仍未接入真实逐笔或完整分时历史曲线。

本页只记录可从仓库核实的当前事实。目标设计写入 `architecture/`，产品意图写入 `product/`，实施步骤写入 `plans/`。

