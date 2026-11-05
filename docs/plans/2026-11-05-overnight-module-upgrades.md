# 夜间逐模块升级执行计划

> **For agentic workers:** 按 writing-plans 编写，使用本聊天子代理逐项实现、主代理复核。每个模块验证、提交、部署后才发布下一模块。

**Goal:** 在北京时间 2026-11-06 08:00 前逐模块改善资金比例解释、策略研究正确性、加载速度和键盘体验，每次代码提交对应一次服务器部署。

**Architecture:** 在独立工作树整合最新本地功能分支与远端 main 的生产分支规范。沿用现有 PaperBroker、风险引擎、查询缓存和懒加载机制，不新增真实执行权限。

**Tech Stack:** React 19、TypeScript、Vite、TanStack Query、Fastify、Vitest、Python/FastAPI、Docker Compose。

## 已确认约束与起点

- 截止为北京时间 2026-11-06 08:00，即 UTC 2026-11-06 00:00；到期停止新增修改，完成在途部署验证或回滚。
- 工作树：`C:/Users/kjq/.codex/worktrees/overnight-optimization/AI量化`；分支 `codex/overnight-optimization-2026-11-05`。
- 起点 `dfad497d38787a1d0e017681c572e6b666f0d8b6`，整合 `origin/main` 的 `5ec9d3b` 分支规范，不丢弃六检查点通知等后续功能。
- 原目录 main 陈旧且有用户未跟踪文件，保持原样。
- 服务器 `/opt/kairos` 是归档部署，没有 `.git`，不能根据 `git branch` 推断线上分支。部署前三个关键源码 SHA256 与 dfad497 一致；精确发布标识需本轮补记。
- 初始线上三个容器 healthy；health 明确 `paper + akshare`、`realTradingEnabled=false`、`authEnabled=true`。
- 用户新增明确授权：**直接取消固定比例现金预留，仅保留必要费用**。这是本次 Paper 配置变更；保留手续费、滑点、整手、实际可用现金、单笔/单股硬限额、T+1、阶段与每日订单笔数额度、熔断、幂等与既有手动策略。审计发现分时总仓位比例也会机械闲置10%至70%现金，本轮一并取消该比例，总仓位仍受实际现金与各单股硬上限限制。
- 线程续跑自动化 `kairos` 每 30 分钟检查，截止时间内继续未完成任务；依赖电脑和 Codex 可用。

## 发布协议（每轮）

1. 先记录预期行为、涉及文件和可验证结果，补必要的回归测试。
2. 定向测试通过后跑前后端全套 Vitest、TypeScript 与 Vite 生产构建；Python 发生修改时加桥接测试。
3. 主代理检查 diff、`git diff --check`，只提交该模块及相应文档。
4. 推送工作分支；用 `git archive HEAD` 生成二进制归档，通过既有受限 `deploy-upload <40位SHA>` SSH 入口部署。不得使用 PowerShell 文本管道传二进制。
5. 记录上一发布标识、部署输出；检查三容器 healthy、`/healthz`、`/api/health`、匿名账户/能力/自动执行接口 401 和源码哈希。保留原账户、订单、凭据。
6. 发布失败先回滚/修复，不堆叠下一轮。下一轮文档记录上一轮线上结果，避免为记一行状态再次发布。

## 模块 1：入口代码按需加载（进行中）

**Files:** `src/App.tsx`、`docs/status/current-state.md`、本计划。

- [x] 记录未改动构建入口包实际字节数：App 74,399 字节，gzip 23,957 字节；基础 index 199,170 字节。
- [x] 删除 `TradingStrategies`、`SystemMonitor` 同步 import，使用现有具备分块失败恢复的工具：

```tsx
const TradingStrategies = lazyNamed(() => import("./components/TradingStrategies"), "TradingStrategies");
const SystemMonitor = lazyNamed(() => import("./components/SystemMonitor"), "SystemMonitor");
```

- [x] 账户 `strategies` 与 `monitor` 内容分别包裹 `<Suspense fallback={<LazyFallback />}>`。
- [x] 精确暂存树隔离快照验证：65 个服务端文件/947 项、34 个前端文件/132 项测试全部通过；TypeScript 与 Vite 构建通过。App 58,814 字节（减少20.9%），gzip 19,435 字节（减少18.9%）；SystemMonitor 6,977 字节、TradingStrategies 8,667 字节独立加载。该结果仅为构建体积，不宣称线上耗时同比改善。
- [x] 模块1提交 `a65bb8441bb8b5a4b604a25d91c3a9382cb21234` 已通过受限归档部署；UTC 17:23 验证三个容器 healthy、健康接口200、账户/能力/自动执行状态匿名401、公网相同结果。Paper账户仍20,000现金、0持仓、0订单、growth档、auto策略，未重置账户。服务器 `runtime/production-release.json` 记录分支和SHA。
- [x] GitHub连接已恢复：UTC18:39成功推送模块1至7A全部提交到远端同名分支；后续每模块继续同步，服务器仍走受限归档发布。

## 模块 2：取消固定现金预留（优先）

**Files:** `server/config.ts`、`server/trading/paperStrategyProfile.ts`、`server/trading/intradayExecutionPolicy.ts`、`server/research/adaptiveStrategyRouter.ts`、`server/research/dailyMarketReview.ts`、`server/research/paperTradingPlan.ts`、`server/trading/paperAutoExecutor.ts`、各对应测试、`src/components/Settings.tsx`、`src/components/LearningPipeline.tsx`、`.env.example`、`deploy/production.env.example`、受影响专题文档。

- [x] 复现叠加：有效预留原为 `max(配置10%, 档位20%至80%, 路由10%至70%)`；线上原配置10%、growth档至少20%、单股硬限额25%，账户20,000现金、无持仓，执行策略auto。
- [x] 将固定预留来源统一取消：默认配置为0、档位和路由固定floor为0；计划和执行器仅消费显式服务器配置，旧路由/旧计划不能恢复隐性预留。兼容capitalPacing和maxInvestedRatio为1；阶段累计订单笔数预算50%/75%/100%/100%继续有效。
- [x] 删除复盘的固定现金比例恢复要求；界面明确无固定比例预留，仍按费用和实际风险额度计算可买金额，不承诺满仓或强制成交。
- [x] 精确暂存快照：66个服务端文件/963项、34个前端文件/134项全部通过，TypeScript与Vite构建通过。新真实执行器回归超过旧85%限制、仍扣滑点/手续费，费用不足不建单，单股超额仍拒。首次检查发现测试可选字段访问类型错误和两个确定性研究计划超过默认5秒，分别修正断言可选访问与该单项集成测试20秒预算后重跑通过，未放宽业务超时。
- [x] 仅修改服务器 `PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO=0`，已在后端容器验证为0；其他凭据未输出或变动。旧配置与Paper状态在服务器runtime/config-backups受限备份。
- [x] 模块2 `0e4d184f0bed1a4b5affd92380101e6365b5823b` 已部署；UTC18:06验证三容器healthy、健康200、匿名账户/能力/自动状态401、paper+akshare/auth开启/真实执行关闭。Paper仍20,000现金、0持仓0订单、growth与auto未变；单股硬限额0.25、单笔上限100000未变。回滚基线为a65bb84，旧现金配置可从服务器受限备份恢复。

## 模块 3：回测胜率统计正确性

**Files:** `server/backtest/backtestEngine.ts`、`server/backtest/backtestEngine.test.ts`、`shared/backtest.ts`、状态页和本计划。

- [x] 新增8项盈利买卖、盈亏混合、未平仓、费用、部分平仓与重复运行回归，5项先失败证明分母错误。原实现单笔盈利闭合显示50%。
- [x] 保留现有FIFO闭合配对口径，只修分母：

```ts
winRate: tradePnls.length > 0 ? winCount / tradePnls.length : 0,
```

- [x] 共享类型注释说明 `totalTrades` 为成交笔数、胜率只统计闭合FIFO配对；已记录[指标决策0011](../decisions/0011-closed-fifo-backtest-win-rate.md)。定向引擎/优化器/稳健性64项通过，不调整门槛掩盖新统计。
- [x] 模块3精确暂存快照全套66文件/971项服务端、34文件/134项前端通过，TypeScript与Vite构建通过；定向引擎/优化器/稳健性64项通过。
- [x] 模块3提交c5b53de0056d9247d295a3c6a8ea9be6a00e7a90，受限部署成功；发布脚本在三容器健康后返回0，独立检查与公网复核见下一轮记录。

## 模块 4：快速导航键盘体验

**Files:** `src/lib/quickNavigation.ts`、`src/lib/quickNavigation.test.ts`、`src/components/AppShell.tsx`、`src/components/AppShell.interaction.test.tsx`、相关 CSS、状态页和本计划。

- [x] 方向键循环移动、Enter打开高亮项、Esc关闭、查询变化重置；关闭后Enter不跳转、方向键可重开，中文组合输入与229键码不误跳转。
- [x] combobox/listbox补选中状态、稳定option id和aria-activedescendant；当前位置用aria-current，鼠标和键盘共享高亮。下拉限制高度并滚动至高亮；定向2文件17项先红后绿，前端类型检查通过。
- [x] 模块4精确暂存快照全套66服务端文件/971项、34前端文件/140项通过；TypeScript与Vite构建通过。
- [x] 模块4提交5ce8a3a4f6f3e4aaf9b4a64e647371e5dcebb919并部署，UTC18:12独立验证三容器healthy、健康200、匿名保护401、Paper模式及原账户不变。

## 模块5：参数搜索不阻塞API事件循环

**Files:** `server/optimizer/gridSearch.ts`、新`gridSearch.scheduling.test.ts`、`server/app.test.ts`、`server/trading/paperAutoExecutor.cashPolicy.test.ts`、架构/状态页和本计划。

- [x] 只读探针证实暖模块仍同步阻塞：本地120 bars、16策略、5,717 trial耗时5,848ms，10ms心跳最大间隔5,849ms；AkShare生产路径使用同一代码，但该本地测量不是生产上限。
- [x] 每约8ms使用node setImmediate让出真正宏任务，成功与失败组合均切片，保持组合顺序、种子、trial、评分和最佳结果。
- [x] 新增3项真实计时器/完整结果等价回归，2项先红后绿；定向67项通过。相同本地探针：10ms心跳最大gap由5849ms降至24ms，380次心跳；总计算从5848ms增至6338ms（约8.4%），改善响应性，不宣称计算提速或生产延迟同比结果。单trial和笛卡尔积仍同步。
- [x] 真正让出后暴露既有测试同步阻塞掩盖的5秒超时：完整研究API用例明确20秒预算，其他API保持默认；资金回归使用轻量真实计划fixture，避免无关全参数搜索，3例从约18至21秒降至23ms并保留真实executor/broker验证。
- [x] 模块5精确暂存快照67服务端文件/974项、34前端文件/140项全部通过，TypeScript与Vite构建通过。
- [x] 模块5提交0e069491940cfeb34db67ef0f44f4eb941b3b4b4，受限部署返回0；独立健康和账户检查记录于本轮流水。

## 模块6：策略对比结果变化时保持Hooks顺序

**Files:** `src/components/StrategyCompare.tsx`、新`StrategyCompare.test.tsx`、状态页和本计划。

- [x] 代码核实不足2条结果时在两个useMemo之前return，结果从1条到2条或反向变化会改变Hooks数量。
- [x] 真实React root同实例重渲染4项先复现Rendered more/fewer hooks，再把空状态判断移到全部Hooks之后，排名与图表算法不变。
- [x] 6项DOM回归通过：0/1初次、1→2、2→1、0→2→0以及选择夏普后2→1→2保留指标和排序；前端类型检查通过。
- [x] 模块6精确暂存快照67服务端文件/974项、35前端文件/146项、TypeScript和Vite构建通过。
- [x] 模块6提交3f0fdebf143937b335a603169b0a9079c9b0a783并部署；UTC18:30:38独立验证三容器healthy、健康200、匿名账户/能力/自动状态401，Paper+AkShare、认证开启、真实执行关闭，原账户与策略选择不变。

## 模块7A：稳定行情版本时间与跨日旧计划拦截

**Files:** `server/market/mockMarket.ts`、`server/market/HttpMarketProvider.ts`、各对应测试、`server/contracts/MarketDataProvider.ts`、`shared/trading.ts`、`server/trading/paperAutoExecutor.ts`与真实执行回归、决策/架构/状态/本计划。

- [x] 独立复核确认两个Provider每次读取都把marketTime重设为now，同一sequence相隔1ms也生成不同缓存key，还会把旧日行情标成新日。
- [x] marketTime仅在Mock构造/tick或HTTP实际接纳非空结果并更新sequence时变动；读取、重播、失败、空结果不前移，quotes.updatedAt仍为来源时间，质量新鲜度继续按实际时钟计算。
- [x] 保持Broker/T+1/成交与审计的独立clock；自动执行比较plan.tradingDate与本轮交易日期，旧日/未来日计划仅观察、不提交、不使用错误日期额度或幂等键、不发通知。语义记录于决策0012与架构。
- [x] Mock新增3项、HTTP新增7项、错日计划2项先红后绿；匹配日正例成交及T+1正确。Provider/executor/cashPolicy/broker/dataQuality定向7文件160项与服务端类型检查通过。
- [x] 模块7A精确暂存树隔离验证：69服务端文件/987项、35前端文件/146项全部通过，TypeScript与Vite生产构建通过。独立复核3文件46项通过，未混入7B缓存改动。
- [x] 模块7A提交3a51c840440b3c3cd7c8fcf5e76160ff71b12599并部署，UTC18:46独立验证425个上传归档文件SHA256全部一致、三容器healthy、健康200、匿名保护401，原账户和策略选择不变。归档按换行属性导出，校验实际上传字节。

## 模块7B：排行榜与Paper研究共享同快照计算

**Files:** 新`server/research/strategyLeaderboardService.ts`及测试，`server/app.ts`、`server/research/paperTradingPlanService.ts`、相关集成测试、架构/状态/本计划。

- [x] 确认排行榜API直接运行全参数搜索，Paper研究内部另运行相同计算；重复打开模块会重复消耗CPU。
- [x] WeakMap按TradingSystem隔离，结果完成后30秒TTL，失败移除，最多保留8项。沿用最早插入淘汰（含在途项），这是保留条目上限，不是并发计算上限；仅未被淘汰的同key保证在途复用。
- [x] key包含provider、bars、seed、requestedSymbols及完整快照JSON的SHA256，保留报价顺序与所有字段；API/Paper统一调用，只缓存排行榜、不缓存账户或最终计划，原generatedAt/snapshotTime保留。
- [x] 定向3文件31项及服务端类型检查通过，含真实Mock/HTTP时钟前进137ms同版本复用、tick/poll失效、输入/系统隔离、完成后TTL、失败重试、容量与账户变化后重建计划。
- [x] 本地120bars/8报价/16策略：首次6147.91ms、同版本再次0.057ms且报告相同；只说明本地重复计算节省，不代表生产耗时或新版本计算提速。
- [x] 模块7B精确暂存树隔离验证：70服务端文件/1005项、35前端文件/146项全部通过，TypeScript与Vite构建通过；未混入模块8/9。
- [x] 模块7B提交2d466c749f1d04daa08aa320799839bd443f6c23已推送并部署；UTC18:54独立校验427个上传文件、三容器healthy、健康200、匿名保护401，Paper账户与策略保持原值。

## 模块8：交易比例来源与零额度解释

**Files:** 共享sizing类型、Paper计划/降级/通知、浏览器契约、Settings/LearningPipeline及测试、文档。

- [x] 真实复现growth=1/路由0.5/单笔4000得到2000却误称档位缩放；现金0/档位0/路由0误报无约束。
- [x] 共享sizing类型新增可选档位基础比例和限制说明，保留旧枚举及所有金额/手数/风控计算；旧报告缩放码用中性说明，通知保留HTML转义。
- [x] 设置/研究分别解释档位、路由和最终比例，手动路由不参与；100%仅缩放既定单笔/单股额度。
- [x] 定向服务端6文件90项、前端4文件20项和双类型检查通过，覆盖全部归因、零额度、旧报告与200股1560元+5元费用例。
- [x] 模块8精确暂存树验证：72服务端文件/1025项、36前端文件/152项、TypeScript与Vite构建全部通过，未混入模块9运行段。独立只读复核服务端49项/前端6项通过，金额公式未改。
- [ ] 提交部署及独立归档/健康检查。

## 模块9：异步等待后的执行时间复查

**Files:** PaperAutoExecutor运行段、新executionTime测试、边界/状态/本计划。

- [x] 内存复现研究跨午休、通知跨收盘仍成交，跨日使用旧幂等日期；Broker实时暂停保护仍有效。
- [ ] 研究返回后用实际时钟核对日期/时段，阶段策略使用完成时刻；通知后逐笔提交前再检查，时间越界停止余单并保留已有成交和原因。
- [ ] tradeWindowOnly=false保留同日时段外语义但不跨日复用；报价年龄阈值另行论证，本模块不改暂停/费用/额度/T+1政策。
- [ ] 先红后绿覆盖异步边界与兼容选项，完整验证后独立发布。

## 模块10：域名证书与续期部署准备

**Files:** Nginx挑战路由、Compose挂载、独立ACME容器脚本及验证、部署文档。

- [x] 只读确认DNS/80/443/CA目录可达，但证书自签且仅IP SAN，挑战落SPA、无续期，PUBLIC_HOST/WEB_ORIGIN仍IP。
- [ ] 准备webroot、Docker证书脚本、原子安装/验证/重载和续期方案，保留现有证书直到新证书验证通过。
- [ ] 脚本不默认接受Let's Encrypt订阅协议；完成可审查配置后单独取得条款授权，未授权不注册CA账户、签发或安装续期任务。
- [ ] 完整验证后独立部署准备；域名环境值按现有站点目标修正，证书签发依赖最终协议确认。

## 后续候选（先证实，再建独立小计划）

- 依据服务端有界性能诊断挑选真实慢点，优先查询复用、取消无效请求和诚实降级；不无限抓取或盲目新增缓存。
- 资金比例页面逐层解释单笔、单股、阶段预算、费用及最终手数，先验证现有 sizingDiagnostics 是否足够，避免重复造字段。

## 验证与部署流水

模块1精确暂存快照通过全套检查并完成线上发布验证；模块2、3并行开发，只以各自暂存树的隔离快照验证实际提交内容。
