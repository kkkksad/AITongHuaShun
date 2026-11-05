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
4. 优先推送工作分支；GitHub网络持续不可达时，可对已完成独立复核/精确全检查的本地提交按同SHA归档部署，并明确记录未推送状态、恢复后补推，不堆积未部署代码提交。用 `git archive HEAD` 生成二进制归档，通过既有受限 `deploy-upload <40位SHA>` SSH 入口部署。不得使用 PowerShell 文本管道传二进制。
5. 记录上一发布标识、部署输出；检查三容器 healthy、`/healthz`、`/api/health`、匿名账户/能力/自动执行接口 401 和源码哈希。保留原账户、订单、凭据。
6. 发布失败先回滚/修复，不堆叠下一轮。下一轮文档记录上一轮线上结果，避免为记一行状态再次发布。

## 模块 1：入口代码按需加载（已发布）

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
- [x] 模块8提交7ebb2cf059794417f4a9f3abed325ed3f911f359已推送并部署；UTC19:05独立校验431个上传文件、三容器healthy、健康200、匿名保护401，原Paper账户不变。隔离内存模拟实例的实际浏览器验证1440×900与390×844比例说明，无横向溢出与控制台错误；临时进程已停止，未登录生产账户。

## 模块9：异步等待后的执行时间复查

**Files:** PaperAutoExecutor运行段、新executionTime测试、边界/状态/本计划。

- [x] 内存复现研究跨午休、通知跨收盘仍成交，跨日使用旧幂等日期；Broker实时暂停保护仍有效。
- [x] 研究返回后用实际时钟核对日期/时段，阶段策略使用完成时刻；通知后逐笔提交前再检查，越界停止余单并保留已有成交、审计和原因。
- [x] tradeWindowOnly=false保留同日时段外语义但不跨日复用；未新增报价年龄阈值，暂停/费用/额度/T+1不变。
- [x] 新增11项回归（起初10项中8红），相关4文件36项及类型检查通过；独立复核同36项通过，无阻断。
- [x] 模块9精确暂存树验证：73服务端文件/1036项、36前端文件/152项、TypeScript与Vite构建通过。
- [x] 模块9提交47f6a57afbf4a750b11aa3cf32571c2d88af750b已部署；UTC19:13校验432个归档文件、三容器healthy、健康200及匿名保护401，原账户不变。首次推送网络重置，随后随模块12B成功补推。

## 模块10：域名证书与续期部署准备

**Files:** Nginx挑战路由、Compose挂载、独立ACME容器脚本及验证、部署文档。

- [x] 只读确认DNS/80/443/CA目录可达，但证书自签且仅IP SAN，挑战落SPA、无续期，PUBLIC_HOST/WEB_ORIGIN仍IP。
- [x] 准备webroot、普通ubuntu运行的Docker证书脚本、双域验证、单指针原子安装/回滚和未启用的systemd续期样例；不默认接受协议，保留现有证书直到新证书验证通过。
- [x] Linux离线24项定义：23项通过，root条件项跳过后单独以真实sudo验证拒绝；Bash、Node、systemd和Compose校验通过，隔离无网络Nginx验证token200/不存在404。独立复核无阻断。
- [x] 精确暂存树隔离验证：75服务端文件/1054项、37前端文件/155项、TypeScript与Vite生产构建全部通过；未混入模块13/14。
- [ ] 脚本不默认接受Let's Encrypt订阅协议；完成可审查配置后单独取得条款授权，未授权不注册CA账户、签发或安装续期任务。
- [x] 完整验证后独立部署准备；域名环境值按现有站点目标修正，证书签发依赖最终协议确认。
- [x] 准备版本d9c98cfbd4e66d676b103b914bfc438ddc84c887已推送并部署；UTC19:46校验441个归档文件、三容器healthy、健康200/匿名401、原Paper账户保留。预建ACME目录属ubuntu；PUBLIC_HOST改为kairosq.cn并受限备份原环境/状态，WEB_ORIGIN正确派生。根域/www实际HTTP token200且内容相同、缺失404，探针已删除。仍保留自签证书，未注册/签发/安装续期；具体协议授权问题已提交用户，继续独立工作。

## 后续候选（先证实，再建独立小计划）

## 模块11A：不可买一手的真实金额原因

**Files:** Paper计划金额fallback、新affordability回归、必要消费者标签、产品/状态/计划。

- [x] 实际页面并以内存复现：现金20,000、单股上限5,000、一手5,210+费用5时误称现金不足；真实原因是单股金额上限不足一手。现金784、一手780+费用5才是真正费用后现金不足。
- [x] 只修解释和阻塞归因：账户现金足够最低一手时，金额上限/策略缩放/整手/费用效率使用`plan-sizing-constrained`中性原因；只有现金连最低一手加手续费都不足才保留`cash-constrained`。买单集合、数量、额度、资格与费用公式保持原值。
- [x] 新增13项金额回归，覆盖真实余额、单笔/单股/档位/路由/显式预留、费用效率、空池、策略未匹配、正常自动/手动和原有买单对象；通知31项中新增准确标签。服务端类型与差异检查通过，独立对比14组买单集合和完整买单对象100%一致。
- [x] 精确暂存全套验证、提交部署与独立检查。
- [x] 模块11A精确暂存树74服务端文件/1050项、36前端文件/152项、TypeScript与Vite构建通过；提交90ce31699a0f4488b2e5c53eb6e9e1eba3189c97归档部署返回0，随12B补推；后一发布已独立验证完整归档和账户保留。
- [x] 模拟snapshot-candidate覆盖误称问题已作为独立模块12B验证并部署。

## 模块12B：区分快照候选与策略路由覆盖

**Files:** Paper计划/浏览器契约共享coverage类型、研究管线与回归。

- [x] 复现：无自适应路由的Mock自动计划允许`snapshot-candidate`，但覆盖区却显示0命中、4未匹配；不改变旧计数字段，新增可选`coverageMode`。
- [x] 构造规则：候选池为空为`none`，固定策略为`manual-strategy`，自适应路由为`adaptive-routing`，自动且无路由的快照候选为`snapshot-fallback`。研究管线对快照模式显示“快照候选筛选（未启用市场策略路由）”，隐藏误导性的未匹配语句；旧报告按已有字段兼容推断。
- [x] 新增服务端4项、前端3项覆盖回归；相关服务端57项、前端25项及双类型检查通过，计数、筛选、资格和买单公式保持原值。
- [x] 模块12B精确暂存树75服务端文件/1054项、37前端文件/155项、TypeScript与Vite构建通过；独立复核11A/12B服务端59项、前端9项通过。
- [x] 模块12B提交6d6ea20856e4c368ec0e432f2b7df8248bb999ba已推送并部署；UTC19:30独立校验436个归档文件、三容器healthy、健康200、匿名保护401，原账户20,000现金0持仓0订单、growth/auto不变。

## 模块13：回测账户快照重复开销

- [x] 本地CPU采样（8报价/120bar/16策略）首次研究6498ms，主要热点为Store交易日格式化约1680ms、账户1173ms、持仓365ms；Windows模块existsSync约1074ms不是生产热点结论。
- [x] 实施空持仓立即返回[]、单Store只在注入now精确毫秒相同才复用格式化交易日；每次非空仍读取now，前进/回拨时间均失效。所有现金、持仓、报价Map与账户值仍重新计算，Broker填单/审计时钟不变。
- [x] 新增3项回归覆盖同毫秒现金/档位/暂停/重置、北京时间午夜T+1解锁与回拨重锁、同时间新报价重新估值；相关store/broker/backtest71项与TypeScript通过，独立复核55项通过。
- [x] 本地100000次账户调用：空仓139.43→49.53ms、种子仓162.40→109.84ms，完整账户相同。固定8报价/120bar/16策略研究交替顺序：旧6518.21→新3886.25ms，新3570.36对旧6159.51ms；完整报告仅排除generatedAt/dataQuality.timestamp后深度相同。该结果是本地计算收益，不代表生产延迟同比改善。
- [x] 精确暂存树76服务端文件/1057项、37前端文件/155项、TypeScript与Vite生产构建通过；第二独立复核55项通过，10种旧新Store账户/持仓/订单/审计逐字段相同，涵盖同Date对象午夜/回拨、冻结现金、清仓和重置。
- [x] 模块13提交288b796795fb5aca8ebc90d4f3d007b490ef510b已推送并部署；UTC19:50独立校验442个归档文件、三容器healthy、健康200/匿名401，Paper账户20,000现金0持仓0订单、growth/auto保留。

- 依据服务端有界性能诊断挑选真实慢点，优先查询复用、取消无效请求和诚实降级；不无限抓取或盲目新增缓存。
- 资金比例页面逐层解释单笔、单股、阶段预算、费用及最终手数，先验证现有 sizingDiagnostics 是否足够，避免重复造字段。

## 验证与部署流水

模块1精确暂存快照通过全套检查并完成线上发布验证；模块2、3并行开发，只以各自暂存树的隔离快照验证实际提交内容。

## 模块14：导航完成后的定位与焦点

**Files:** `src/App.tsx`、`src/components/AppShell.tsx`、`src/components/Settings.tsx`、`src/components/LearningPipeline.tsx`、新`src/hooks/useNavigationFocus.ts`与导航回归。

- [x] 复现同一深链重复点击不重新定位、全局搜索选中后焦点仍在输入框；以`location.key`识别每次导航，等待懒加载目标挂载后滚动/聚焦，一次完成即断开观察。
- [x] 初次深链保留只滚动语义，后续导航可聚焦`tabIndex=-1`目标；过时导航取消，搜索高亮、Escape与刷新不抢焦点。新增7项回归，定向7文件41项、前端类型与diff检查通过。
- [x] 主代理源码复核与隔离真实浏览器1280×720验证：首次懒加载和重复同URL均focus到settings-execution、搜索关闭，返回初始页focus MAIN；无横向溢出/控制台error。仅测试专用内存mock账户、auto/WxPusher关闭；临时页面与服务已停止，未登录生产。
- [x] 精确暂存树76服务端文件/1057项、38前端文件/162项、TypeScript与Vite生产构建全部通过，未混入模块15/16。
- [x] 模块14提交b3f6d79868c8b01ffbc006c59ceb8955c76ed958已推送并部署；UTC19:58独立校验444个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块15：回测已成交状态、成交顺序与报告隔离

**Files:** `server/backtest/backtestEngine.ts`与对应真实引擎回归，架构/状态/本计划。

- [x] 纯内存探针证明：挂单先成交但onBar账户仍是成交前；同bar后续市价单先写trades，令FIFO顺序反转；重复run复用曲线/成交数组，首轮报告被次轮清空重写。
- [x] 新增8项真实引擎回归，最初7项5红2绿；追加配置共享问题先红1项。覆盖挂单买/卖后context、pending→market FIFO、多挂单实际最新优先顺序、同bar共享context、不同结果重复run、数组/元素和7项config修改隔离。
- [x] 每bar先获取pending引用序列、`markToMarket(snapshot)`，按Broker实际遍历顺序记成交，再`getAccount/getPositions`构造context；即时成交使用同一个去重记录函数。报告curve/trades逐元素拷贝、config浅拷贝，不共享引擎可变状态。
- [x] 定向6文件125项、TypeScript及diff检查通过；首7项版本独立复核6文件127项通过，最终config拷贝另行复核。当前内置策略不主动生成限价信号，此时序修复主要影响公共引擎的自定义限价策略；报告隔离影响同引擎重复运行调用方，不声称全部既有榜单都曾出错。
- [x] 最终config浅拷贝由独立代理复核8/8通过，涵盖改旧报告全部配置后新报告完整经济结果一致。
- [x] 精确暂存树77服务端文件/1065项、38前端文件/162项、TypeScript与Vite构建全部通过，未混入模块16/17。
- [x] 模块15提交e277b93258bd53d79a14829cafff470b57c5646a已部署；UTC20:01独立校验445个归档文件、三容器healthy、健康200/匿名401，原Paper账户与策略保留。首次GitHub连接超时，随后补推成功。

## 模块16：海龟策略历史通道突破恢复

**Files:** 现有`TurtleStrategy.ts`及策略/真实引擎回归，策略专题/状态/本计划。

- [x] 正价数学复现：当前bar的`price*1.01`进入上轨后，当前price永远不可能突破；`[100,100,100,110]`虽突破过去3日上轨101却无信号，真实引擎也零成交。下轨存在同类问题。
- [x] 新10项回归覆盖完整N条历史、N+1突破、M日历史退出、均线暖身/过滤、exitPeriod大于entry、前缀未来数据隔离、reset及真实引擎模拟成交。最初新增9项与旧交易断言共10红，再加一项均线阻挡后全部绿。
- [x] 三个通道均排除当前bar，entry需完整过去N条、exit需完整M条；沿用price±1%估算、包含当前价格的MA、>=/<=比较、权重及所有风控。旧趋势fixture原单日不超过0.8%不足跨估算高点，明确改成可突破的趋势并断言buy，不放宽策略。
- [x] 定向策略/优化器/稳健性90项与类型检查通过，独立复核84项通过；新海龟在模块15修改前后引擎的完整6bar报告相同，bar3买100/bar5卖100且至少各5元费用，证明不依赖模块15。
- [x] 精确暂存树78服务端文件/1075项、38前端文件/162项、TypeScript与Vite生产构建全部通过，未混入模块17。
- [x] 模块16提交077d6dddb7f6d9ced07c1fbdcc04d93db49af50c已推送并部署；UTC20:05独立校验446个归档文件、三容器healthy、健康200/匿名401、原Paper账户和策略保留。

## 模块17：日志筛选请求顺序保护

**Files:** `src/components/LogViewer.tsx`与真实React交互回归，状态/产品/本计划。

- [x] ignored诊断中复现：全级别请求A未完成切换ERROR发B，B先成功后A迟到成功会显示INFO行；A迟到失败会给ERROR结果挂上过时错误。现有静态分页测试漏掉请求竞争。
- [x] 新增17项真实React回归，首轮12项10红，追加scope隔离5项先红后绿；相关5文件29项与前端类型检查通过。覆盖迟到成功/错误/finally、日期列表、分页/模块、scope变更、同scope失败重试、慢请求与卸载。
- [x] 请求AbortController身份+未中止双门保护，effect cleanup失效旧请求；日期列表独立cleanup。结果带date/level/module/page scope，仅匹配时渲染，切换时立即隐藏旧行/计数/展开且禁导出；同scope保留旧结果和诚实错误。自动10秒tick在请求尚未完成时跳过，避免慢请求饥饿。
- [x] 独立复核4文件26项通过，无阻断；API signal透传、过时catch/finally、当前scope导出与定时清理均确认。
- [x] 精确暂存树79服务端文件/1081项、39前端文件/179项、TypeScript与Vite生产构建全部通过，未混入模块19。
- [x] 模块17提交aa519b21d5db75a886d6f52149aab9160a6980e5已推送并部署；UTC20:16独立校验448个归档文件、三容器healthy、健康200/匿名401，原Paper账户与策略保留。
- [x] 定向日志/研究刷新回归、独立复核和精确暂存全套验证已完成，提交与部署结果见上。

## 模块18：遗传优化遵循配置目标

**Files:** `server/optimizer/geneticAlgorithm.ts`与新目标回归，架构/状态/本计划。

- [x] 真实内存探针复现：价格10/11/12、lots2/3、目标totalReturn权重1的应有分0.04/0.06却都为10（硬编码Sharpe）；换权重-1后best/score/收敛曲线完全相同，目标未参与选择。固定种子本身仍确定。
- [x] 新增6项真实引擎回归，最初5红1绿，再全部通过；验证正/负目标、组合权重、原Sharpe费用/滑点兼容、缓存后的best/avg和固定seed重复。GA当前没有onProgress接口，不新增该能力；score/best/已有收敛曲线统一使用配置目标。
- [x] 将config.objectives传入每个个体的共享computeScore，沿用归一化/缓存/种子/变异/预算；实现仅3行增加/2行替换。定向优化器/策略6文件96项、TypeScript和diff检查通过，主代理源码与测试复核无阻断。
- [x] 独立复核34项通过，另以2基因/12人口/5代真实引擎比较旧新Sharpe经济报告：16个unique trial的参数/指标/分数/id/best/收敛全等；公开runOptimization(genetic)负totalReturn逐trial评分及best=max符合配置。
- [x] 精确暂存树79服务端文件/1081项、38前端文件/162项、TypeScript与Vite生产构建全部通过，未混入模块17/19。
- [x] 模块18提交abc69dc1c63e2b77df05bf41218097f59968d307已推送并部署；UTC20:14独立校验447个归档文件、三容器healthy、健康200/匿名401，原Paper账户与策略保留。
- [x] 独立复核、定向优化/策略测试与精确暂存全套验证、独立提交部署已完成。当前研究排行榜使用gridSearch，此修复覆盖公开genetic/runOptimization路径，不声称已有榜单因此错误或保证获得更佳收益。

## 模块19：定投止盈使用实际持仓

**Files:** `server/backtest/strategies/DCAStrategy.ts`与新真实引擎回归，架构/状态/本计划。

- [x] 两位代理只读真实引擎复现：DCA每bar1000元、10/10/10/12、初始10000、15%单股上限，实际只买100股而虚拟账累加300，止盈卖300被拒；同日止盈T+1拒绝后虚拟账清空，次日不再退出。探针风控参数不修改生产配置。
- [x] 新增13项真实DCA回归，先10红3绿后全部绿：拒买只卖实际量、T+1等待/次日退出、拒卖重试、滑点均价、真实部分解锁、legacy缺可卖字段/整手/上限、symbol隔离、尝试间隔和reset。定向7文件141项、服务端类型与diff检查通过。
- [x] 删除三个虚拟持仓字段，止盈读取目标context.positions实际quantity/averagePrice；可卖量取min并100整手对齐。达到止盈但可卖0观察，下bar读取实际账，不清虚拟账或把意图当成交。
- [x] lastInvestBar仍为买入尝试周期；阈值沿用差额/成本口径，真实模拟均价含滑点不含佣金。20元报价20.01成交、5元费用案例验证，不能称为费用后收益阈值。
- [x] 独立复核确认含滑点不含佣金、T+1/部分解锁/拒卖重试与原尝试节奏，93项定向通过；精确暂存树80服务端文件/1094项、39前端文件/179项、TypeScript与Vite生产构建全部通过，未混入模块20/21。
- [x] 独立提交部署；仅修DCA事实来源，不扩大成所有策略状态重构，不改变生产策略选择或风险额度。
- [x] 模块19提交fccfdf5d39dc100dc49e091d14e7061bedd228d1已推送并部署；UTC20:25独立校验449个归档文件、三容器healthy、健康200/匿名401，原Paper账户20,000现金0持仓0订单、growth/auto保留。

## 模块20：实时订单列表页码恢复

**Files:** `src/components/OrderHistory.tsx`与真实React分页回归，状态/本计划。

- [x] ignored真实React探针复现：16笔pending在第2页时，唯一行更新为filled，剩15笔pending但page未收缩；显示无匹配订单且分页条因仅1页消失，用户无法返回现有记录。
- [x] 新增7项真实React回归，最初5红2绿后全部绿；覆盖实时状态减少、passive effect前的首帧有效页、空后增长、有效页保留、过滤排序、当前撤单及完整筛选导出。定向3文件13项、前端类型与diff检查通过。
- [x] 渲染时统一使用currentPage=min(page,totalPages-1)切片/标签/按钮；effect同步原state避免清空后增长回弹。独立代理复核3文件13项通过，无交易请求或生产状态变更。
- [x] 精确暂存树80服务端文件/1094项、40前端文件/186项、TypeScript与Vite生产构建全部通过，未混入模块21。
- [x] 单独提交部署并独立核验，结果见下。
- [x] 模块20提交98ef6a921cc98a1200364ee6906b9557e0506138已推送并部署；UTC20:29独立校验450个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块21：监控路由标签有界与实例隔离

**Files:** `server/app.ts`、`server/metrics.ts`、必要监控helper及回归，架构/状态/本计划。

- [x] 内存app.inject证明未知404路径fallback到原始request.url：Prometheus保留含测试query的完整URL、不同query产生不同永久标签；轻量telemetry虽去query仍保留未知原始路径。第二新app的metrics包含第一app标记，因registry全局共享。
- [x] 首6项真实app集成全部先红后绿，新增3项collector回归；70个未知path/query共用固定标签且不淘汰业务telemetry，401保护、参数模板、method有限集合/OTHER、转义与秒累计保持。
- [x] app生命周期使用独立metrics实例，HTTP、WS、订单、账户与风控更新统一同一实例；保留指标名和旧模块函数的独立默认实例。未知路由统一由安全模板helper输出，不复制原始URL。定向34项与TypeScript通过；独立复核初核39项通过，另外真实429/秒计时和legacy隔离探针通过。
- [x] 独立复核39项、额外真实429/耗时/WS认证拒绝探针通过。精确暂存树82服务端文件/1103项、40前端文件/186项、TypeScript与Vite生产构建全部通过，未混入模块22/24。
- [x] 单独提交部署；不新增直方图/外部监控账号、不修改认证与真实交易权限，不把未知请求query输出到诊断。
- [x] 模块21提交674bfa6cf2bc3624ae766a49954a13ca88003f94已推送并部署；UTC20:33独立校验452个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块22：内存账户限价卖单只预占持仓

**Files:** `server/store/inMemoryTradingStore.ts`与新`server/broker/paperBroker.limitReservations.test.ts`生命周期回归，架构/状态/本计划。生产JSON实现已区分买卖，本模块不更改其经济规则。

- [x] 真实Broker双实现探针：原有BUY100×40占用4000时，新增SELL100×1642令InMemory可用现金643860→479660，JSON仍643860；重复SELL两边均由reservedSellQuantity拒绝，不能称为超卖。旧JSON载入会重算pending BUY冻结，未重现此错。
- [x] 新增双Store真实Broker22项回归，先2红20绿后全部绿；覆盖BUY4000并存、SELL各终态、合法BUY10000可用资金、重复SELL持仓预占拒绝、BUY本金释放及JSON旧缓存缺失/夸大重建。定向6文件118项、TypeScript与diff检查通过。
- [x] 仅在InMemory四处限价现金冻结/释放条件增加side=buy；遵循现有JSON实现，不修改费用模型或风控额度。无生产重置、真实下单或账户策略变更。
- [x] 独立源码复核及5文件92项通过；精确暂存树83服务端文件/1125项、40前端文件/186项、TypeScript与Vite生产构建全部通过，未混入模块24。
- [x] 单独提交部署。另证实的限价买单佣金缺口独立分析，不以本模块宣称费用已完善。
- [x] 模块22提交5a3d81559f6dd7d566929b83b698c8c7bc6c08d2已推送并部署；UTC20:39独立校验453个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块24：实时通道重连订单快照

**Files:** `shared/trading.ts`、`server/app.ts`、`src/hooks/useTradingBackend.ts`与新真实app/React回归，架构/产品/状态/本计划。须在模块21提交后修改重叠app文件。

- [x] 独立只读React+QueryClient探针：重连按真实握手发送market/account/positions后，资金和持仓更新、连接显示正常，订单仍是断线前pending；没有REST补读，bootstrap也不轮询。
- [x] 新增10项真实app/React回归，先8红2绿后全绿；服务端每次握手发送与bootstrap显式REST请求`?limit=50`一致的最新订单。覆盖断线成交/撤销/新增/清空、旧socket/卸载/禁用不覆盖及后续增量更新。裸REST默认100，不混淆默认值。
- [x] 在TradingEvent新增`orders.snapshot`，认证成功的握手同步发送`broker.getOrders(50)`，hook仅替换orders字段，保留当前连接身份保护；不新增REST并发覆盖，不改账户或下单规则。定向server10项、web34项及双TypeScript/diff检查通过，root完整源码与10项测试复核无阻断。
- [x] 独立React诊断另证实首次cache未建立时快照会被丢弃，迟到bootstrap仍可能显示旧订单；模块24只修已有bootstrap后的重连补齐，不假称解决全部初始化/刷新竞态，后续独立模块处理。
- [x] 独立精确快照44项通过；额外认证真实握手验证匿名/错误origin零消息、合法cookie+origin才收到5类快照。精确暂存树84服务端文件/1129项、41前端文件/192项、TypeScript与Vite生产构建全部通过，未混入模块23。
- [x] 单独提交部署并独立核验，结果见下。
- [x] 模块24提交75263f2d82b3de771be4e9959c32aeb080934922已推送并部署；UTC20:46独立校验455个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块23：买单完整成本与成交资金兜底

**Files:** 新`server/broker/executionCosts.ts`与回归，`server/broker/paperBroker.ts`、`server/risk/riskEngine.ts`、两Store、`server/backtest/backtestEngine.ts`及必要真实Broker/引擎/持久化回归，架构/边界/决策/状态/本计划。依赖模块22先提交，避免重叠仓储混入。

- [x] 真实Broker复现两Store现金1000挂10×100后成交佣金5透支至-5；市价10×100、50bps滑点和5佣金透支约-10；现金2005两个限价单合计费用后-5。限价10.005会在现有两位小数撮合后变10.01，预算须复用实际舍入而非只加佣金。
- [x] 初48项真实Broker/Risk/回测回归34红14绿，最终新增63项全绿；覆盖刚够本金/完整成本、多挂单/价格改善/释放、比例佣金、cap舍入、旧JSON/改费率、成交前资金变化、终态重复调用及低价SELL净费用。定向13文件257项、TypeScript/diff通过。
- [x] 纯成本helper沿用滑点→限价钳制→两位成交价→两位佣金；挂单预算取原cap本金与舍入成本较大值。Store保持本金冻结与JSON v1；Broker扣待买补差，对历史超承诺可用现金显示0但不改变总现金，Risk可选requiredCash默认兼容。
- [x] 每次实际撮合扣其他待买完整预算复核现金，不足审计拒绝；两Store持仓/现金变更前再兜底且终态不重放，保护原本金。机器误差容差上限1e-7，超大1e15差1、真实缺0.01/0.0001与正常exact-fit均验证。原风控优先级、硬限/T+1/幂等和费率保持。
- [x] 回测四处账户统一Broker；从模块22提取旧引擎/Broker/Risk/Store做6bar两标的6笔正常买卖，新旧完整BacktestReport逐字段相同（含所有订单/成交/曲线/指标/配置/最终持仓，最终100015/佣金30）。无pending快速返回，不重写旧成交或生产账户。
- [x] 最终独立源码复核与13文件231项通过；精确暂存树88服务端文件/1192项、41前端文件/192项、TypeScript与Vite生产构建全部通过，未混入模块26/27。
- [x] 独立提交部署并核验，结果见下。
- [x] 模块23提交d1b34ce6aad09fe7b2f575811b89f6515f0d8bf8已部署；UTC20:56独立校验461个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。GitHub两次连接重置/超时，待补推，不将部署成功误称推送成功。
- [x] UTC21:00补推d1b34ce成功，远端分支与该发布一致。

## 模块27：账户累计净已实现盈亏

**Files:** 两Store的`getAccount`与新双实现回归，架构/决策/状态/本计划；待模块23完成重叠仓储变更后实施。

- [x] 独立内存诊断：10000起始，买200@10费5→旧账户已实现0；卖100@12费5→195；再卖100@12费5清仓→0，实际总现金10385；重新买入又从0开始。旧字段求当前持仓已实现之和，清仓delete丢失累计，Dashboard和通知直接消费该值。
- [x] 新24项真实双Store回归先18红6绿后全绿，覆盖开仓买费、部分/全平、亏损、多票重开、挂/撤/行情变化、种子/reset、JSON重载与真实8天清理后利润保留；账户净已实现使用总现金+剩余成本-startingEquity。
- [x] 两Store只改账户派生公式，不新增字段/回写历史，持仓级原语义保留；账户立即计入已付买卖佣金。相关15文件250项、TypeScript/diff通过。当前仅成交/reset改变资金，无充值提现；未来新增现金流必须调整恒等式。
- [x] 独立复核6文件124项通过；同一个Store对照旧getAccount方法，部分195→190、全平0→385，除realizedPnl外完整Account和cash/positions/orders/audit deepEqual，JSON字节不变。排行榜/优化不读该字段，周复盘FIFO独立不改。
- [x] 精确暂存树89服务端文件/1216项、41前端文件/192项、TypeScript与Vite生产构建全部通过，未混入模块26。
- [x] 独立提交部署；不改变现金、权益、成交数量、价格、成本模型或策略排序输入。
- [x] 模块27提交158c31b846346a9c35a6f9d649a6a6c02642f71a已推送并部署；UTC21:03独立校验463个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块26：初始化读取与实时事件一致性

**Files:** `src/hooks/useTradingBackend.ts`、新纯同步层helper与单元/真实React回归；必要时在`src/lib/tradingApi.ts`新增仅复用现有受保护`/api/orders?limit=50`读取函数。架构/状态/本计划。模块24已提交后实施；模块25依赖本模块的生命周期失效点。

- [x] 独立React探针证实首读期间四类快照及订单增量被丢弃，已有cache的refresh也会被迟到GET全部回退；首读失败重试丢先前推送，disabled时旧读取仍可回写。
- [x] 首19项Hook回归11红8绿后全绿；最终Hook27/纯helper8/API22直接57项、关联14项、双类型与diff检查通过。覆盖四字段首读、订单事件交替、refresh/失败重试、后续REST前进、1000行情不饥饿及各生命周期。
- [x] 新有界同步helper按读窗口合并、首读失败保留、成功消费，market同步health.mode；系统notice独立。完整订单最多50，兼容map与最多100次ID操作journal保留FIFO upsert顺序，溢出单次受保护只读补单，失败/再溢出明确不完整。
- [x] 禁用/卸载/reset失效epoch、取消旧读取；reset同步失效旧socket，不等effect cleanup，迟到GET/推送不能写新账户。刷新取消不误称离线，无持续bootstrap轮询或交易请求。
- [x] 独立复核59项通过，另发现的“refresh取消catchup后失败还显示进行中”和“reset至effect cleanup窗口旧帧”均先红后修并复验。root完整helper/hook/API复核无阻断。
- [x] 精确暂存树89服务端文件/1216项、42前端文件/222项、TypeScript与Vite生产构建全部通过，未混入模块28。
- [x] 独立提交部署；仅保证已接收事件的客户端时序，不声称服务端多个端点/WS绝对全序或原子快照。
- [x] 模块26提交77a5f1d957ed8f8c32b7e2f2489e32be28416c18已推送并部署；UTC21:09独立校验466个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块25：重置账户清除账户依赖研究

**Files:** `src/lib/researchQueries.ts`、`src/hooks/useTradingBackend.ts`与查询/真实React回归，状态/产品/本计划；模块26提交后修改hook，保持模块独立。

- [x] 独立React/QueryClient探针：reset成功更新账户后，资金计划和日/周复盘仍正常success显示旧账户。invalidate保留旧data，remove令活动observer仍显示旧结果；cancel+resetQueries能中止旧signal、立即pending无旧data，并重新读，placeholder不复活旧值。
- [x] 新增9项真实Hook和2项predicate回归；Hook最初8红后全绿，覆盖活动计划/placeholder、日/周全部period与inactive、无视取消的旧GET迟到、新报告失败无旧数据、inactive重挂、失败reset及纯市场/选择缓存保持。
- [x] researchQueries统一三个账户研究前缀；reset成功先await cancelQueries，再resetQueries清除活动和非活动数据，活动observer后台重读，不等待重型新报告完成。模块26的epoch与socket门保持。
- [x] 独立复核6文件79项通过，无阻断；未实际重置生产。
- [x] 精确暂存树91服务端文件/1253项、42前端文件/233项、TypeScript与Vite生产构建全部通过，未混入模块30/31。
- [x] 模块25提交feb00d8d9be13a82a1f532348ad13c6b57baae18已推送并部署；UTC21:23独立校验468个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块28：RSI信号使用实际持仓

**Files:** `server/backtest/strategies/RSIStrategy.ts`与新真实引擎/策略回归，必要既有真实fixture、策略专题/状态/本计划。

- [x] 独立真实引擎复现：RSI2、30/70，现金1005、12→11→10.01买单费用后被拒，后续10本可完整支付但虚拟inPosition已true不再买；同日买后超买卖出T+1被拒，次日仍超买却遗忘实际500股。
- [x] 新18项真实RSI/引擎回归先12红6绿后全绿；覆盖费用拒买→可负担重试、额度拒买/拒卖重试、T+1次日退出、实际持仓不重复买、部分可卖/legacy/symbol与reset确定性。阈值、period+1暖身、买入权重和首tradable控制保持。
- [x] 删除意图inPosition，逐bar读取目标context.positions；卖出min(quantity,available??quantity)对齐100股，锁定等待。未改共享fixture、费用/额度/T+1和生产策略选择。定向136项、服务端类型/diff通过，root源码与测试复核无阻断。
- [x] 独立复核11文件167项通过，确认真实资金拒单、T+1和可卖量语义。
- [x] 精确暂存树90服务端文件/1234项、42前端文件/222项、TypeScript与Vite生产构建全部通过，未混入模块25/29。
- [x] 模块28提交de7af6e396452c1220948f6483b9427270aae6c1已推送并部署；UTC21:13独立校验467个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。合成结果/排名可能因修复改变，不声称真实收益提升。

## 模块29：布林带信号使用实际持仓

**Files:** `server/backtest/strategies/BollingerBandsStrategy.ts`与新真实引擎/策略回归，策略专题/状态/本计划；独立于RSI提交。

- [x] 独立真实引擎复现：period3/1σ，12→11→10买入，同日12返回卖意图但T+1拒绝，次日13仍在退出区却因虚拟状态清空而继续持有500股。
- [x] 新19项先13红6绿后全绿，覆盖费用拒买→可负担买入、T+1次日500股退出、额度拒买/拒卖重试、实际持仓/可卖整手/legacy/symbol/reset、暖机/上下轨与中轨等号及std参数。定向7文件155项、服务端类型/diff通过，共享fixture未改。
- [x] 仅以同symbol实际context.positions决定买入/退出，卖出可卖整手；保留布林指标、首tradable、买入权重、原>=/<=和OR语义。root独立完整读取两文件及19项断言，无阻断。
- [x] 精确暂存树91服务端文件/1253项、42前端文件/222项、TypeScript与Vite生产构建全部通过，未混入模块25/30。
- [x] 模块29提交4415a9c7f4317ecc255a6e705a5db5ebe2e9547a已推送并部署；UTC21:19独立校验468个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块30：动量策略完整历史窗口

**Files:** `server/backtest/strategies/MomentumStrategy.ts`与新历史边界/真实引擎回归，策略专题/状态/本计划。

- [x] 真实引擎复现entry3价格20/10/11/12/13在12提前买（过去3高20未突破），exit3价格8/9/10/11/12/10.5在10.5提前卖（过去3低10未跌破）；当前窗口含自身实际只比较过去N-1。
- [x] 新15项先11红4绿后全绿：完整过去N/M条、N+1暖身、最旧边界进出、M>N、等号、前缀未来数据隔离/reset及真实引擎费用滑点成交。定向12文件185项通过，未把不同日期的成交测试夸称同日T+1拒单证据。
- [x] 通道排除当前bar并仅切有界窗口，保留>=/<=、原intent状态、买入权重/卖出全仓及成本/风控；实际持仓维度另行证实，未混入参数调优。
- [x] 独立复核9文件144项、服务端TypeScript/diff通过；root完整源码/15项回归读取无阻断。
- [x] 精确暂存树92服务端文件/1268项、42前端文件/233项、TypeScript与Vite生产构建全部通过，未混入模块31。
- [x] 模块30提交d62b1ad23b035e50792cc0fbf8ee5edc091ec5a9已推送并部署；UTC21:26独立校验469个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块31：手动下单参考本金与费用说明

**Files:** `src/components/PaperAccount.tsx`与必要真实React回归，产品/状态/本计划。

- [x] 独立只读SSR与真实Broker复现：100股×10元、现金1000/1004.99、最低佣金5时表单显示1000且可提交，Broker正确拒绝费用不足；自定义最低17/37bps同样证明界面不是完整成本。实际没有可买/满仓快捷键。
- [x] 真实app注入自定义费率后确认bootstrap/capabilities/risk API均未提供执行费用；研究榜成本是独立模型，不得用于伪造执行估算。
- [x] 金额固定两位，改称“参考本金”，紧邻按市价/限价说明不含费用/滑点、无固定比例预留但需必要费用、服务端最终核验；未硬编码费率或扩展API/假可买量。
- [x] 8项真实React先3红5绿后全绿，覆盖市/限价、数量/标的切换、卖出零现金及临界本金请求，保持全部参数和本金公式。作者相关58项、独立5文件74项及前端TypeScript/diff通过。
- [x] 精确暂存树92服务端文件/1268项、43前端文件/241项、TypeScript与Vite生产构建全部通过，未混入模块32/33。
- [x] 模块31提交3d647ab54425ce9c22a7443cbfefcdd28ad63ebf已推送并部署；UTC21:31独立校验470个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块32：动量策略实际持仓状态

**Files:** 模块30发布后的`MomentumStrategy.ts`、窗口测试真实持仓fixture及独立真实引擎持仓回归，架构/状态/本计划。

- [x] 独立真实引擎复现：entry2/exit2/weight1，现金2005，9→10→10.01→10.03，首次200股加佣金被拒后下一bar可负担100股却无信号；进程内仅校准实际持仓的诊断对照可成交。
- [x] entry2/exit1/weight.5，8/9/10/9同日、8次日：500股买入后同日退出T+1拒绝，次日实际可卖500仍满足退出却遗忘；实际持仓诊断对照次日退出。未修改生产或模块30冻结源码。
- [x] 新18项先14红4绿后全绿，5项真实Engine验证费用拒买后100股重试、风险拒买、T+1次日500股退出、拒卖重试与重复报告，其余13项为明确context边界。作者相关14文件222项通过。
- [x] 删除flag，读取同symbol实际quantity，卖min(actual,available??actual)100整手；保留30窗口/暖机/阈值/首tradable/买权重。原15窗口断言全部保留，fixture明确100股已结算控制持仓；原两个引擎现金6092/9782与费用数量断言不变。
- [x] 独立复核10文件162项、TypeScript/diff通过，root完整三文件复核无阻断。
- [x] 精确暂存树93服务端文件/1286项、43前端文件/241项、TypeScript与Vite生产构建全部通过，未混入模块33/34。
- [x] 模块32提交d55f440d8edeb5066fe4bbe07bd7621ad30ef64f已推送并部署；UTC21:42独立校验471个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。首次GitHub连接失败，重试推送成功后才部署。

## 模块33：回测完成不抢后续导航

**Files:** `src/App.tsx`与新真实App/Router交互回归，产品/状态/本计划。

- [x] 真实App/StrategyLab/Workflow探针复现：点击运行后420ms内切到真实验证或市场，旧setTimeout会强制拉回回测；两项先红。原runBacktest是同步纯计算，此等待没有实际计算/网络任务。
- [x] 删除人为等待与仅供假等待的isRunning state，点击直接提交策略/参数副本、完成并导航，StrategyLab接口保留false。算法/种子/默认参数和模拟声明均未改。
- [x] 新8项真实App/Router先7红1绿后全绿，首次/重复与新提交、后续阶段/市场/后退/卸载、参数副本/过期提示覆盖；作者36项、独立6文件34项与前端TypeScript/diff通过，root完整实现/测试复核无阻断。
- [x] 精确暂存树93服务端文件/1286项、44前端文件/249项、TypeScript与Vite生产构建全部通过，未混入模块34/35。
- [x] 模块33提交ede61c5c0ab363d46ea8d73d474319f25dfc601a已推送并部署；UTC21:51独立校验472个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。首次GitHub连接失败，重试成功后部署。

## 模块35：静态资源传输压缩

**Files:** `deploy/nginx.conf`、必要独立隔离Nginx回归及部署/状态/本计划。

- [x] UTC21:35:55独立公网公开静态GET：现charts JS在identity/gzip请求均200/443899字节、CSS均169865字节，皆无Content-Encoding/Vary，解码hash一致。官方Nginx gzip默认off；当前配置未开启。TLS仍自签，本探针不算可信链验证。
- [x] 仅/assets新增gzip/Vary/level5/min1024/文本MIME五行，独立逐字验证移除五行与HEAD一致；候选SHA256=23a5f318effbda59b7ef86bd34df940acee703a3701d8f2caf0adde7c9143b23，root复核配置无阻断。
- [x] 服务器现有Nginx1.27.5镜像独立128MiB/loopback容器，整份候选配置+临时测试证书与自身stub，nginx-t、gzip/identity/q=0、解码SHA/Vary/30d immutable全部过。实际JS443899→118328B(-73.34%)、CSS169865→28384B(-83.29%)；SVGfixture95411→9796B。小文本21B、根HTML84041B、真实index1234B、APIstub75042B与WS426未压，缺asset404。
- [x] 临时三个container与专属目录全部按名称/label验证清理，生产web ID/启动时间/restart0前后相同，无reload或真实账户/API/通知请求。无需实现镜像单测。
- [x] 精确暂存树95服务端文件1352项、44前端文件249项、TypeScript与Vite生产构建全部通过，未混入模块36/37。
- [x] 模块35提交dd8f8e0b7c2cd501ec9f95cb065309c1f7634220已推送并部署；UTC22:00独立校验475个归档文件/三healthy/健康200/匿名401/原账户。公网匿名实际entry199172→64234B(-67.75%)、charts443899→118328B(-73.34%)、CSS169865→28384B(-83.29%)；gzip/identity/q=0、Vary/缓存与解码hash全过。根HTML1234B、匿名401响应70B/健康3B未压，缺asset404；TLS仍自签，此字节测量不算可信链验证。

## 模块36：窄屏下单表单不被表格撑宽

**Files:** `src/styles/index.css`的账户列最小宽度/响应式规则；产品/状态/本计划。

- [x] 真实浏览器隔离内存账户479px检查复现：account-panel宽444、client442但scroll590，table和order-ticket均560宽，表单right554超过viewport479；根页未横向溢出但panel overflow hidden裁切本金和费用说明，不能仅以root scrollWidth判断正常。
- [x] 仅新增.account-columns > *的min-width:0，不改断点、表格最小宽度/列或订单规则。
- [x] HEAD33加候选CSS独立生产构建通过；真实479px浏览器panel scroll442=client442、form宽382/right423，不再裁切；table容器382/内容560且真实滚动至178，根页scrollX0。市价/限价12.34×200=2468.00、键盘焦点和费用说明完整；1440px桌面双列685.3/353.7与表单right1368正常。无console error，临时viewport已reset，未下单或重置账户。
- [x] 独立CSS/DOM与全部相关断点复核通过，class仅本组件使用，表格独立滚动和桌面两列保持；未加实现镜像测试。
- [x] 精确暂存树95服务端文件1352项、44前端文件249项、TypeScript与Vite生产构建全部通过，未混入模块37/39。
- [x] 模块36提交15b4b683c08d3fc002d88074ed721990381b8cb6已推送并部署；UTC22:06独立校验475个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块37：暂停期间停止已有挂单撮合

**Files:** `server/broker/paperBroker.ts`、新真实双Store暂停回归与`server/app.ts`既有暂停说明，产品/架构/状态/本计划。待模块34重叠Broker发布后实施。

- [x] 独立真实双Store复现4项暂停目标先红：BUY暂停时仍买100股、现金8995→8090；SELL仍卖100股、现金7995→9290。当前新单在暂停时被拒、主动撤单正常，已有77项相关回归全绿但无挂单暂停覆盖。
- [x] 每loop查pause并break，private fill匹配专用defer标记在canonical/现金/仓位回调后、改账或拒单前再查；暂停返回原未决单且不发伪order事件，直提路径原生命周期保持。估值/account事件继续，保留预约与撤单，resume下一tick才按原规则撮合，OpenAPI更正排队说明。
- [x] 新37项真实双Store先23红14绿后全绿，含BUY/SELL、事件/预约、撤单/恢复、新单拒绝、各回调中途pause、JSON重开；作者429相关、独立249项与额外双Store6边界探针及TypeScript/diff通过。root完整实现/测试复核无阻断。
- [x] 精确暂存树96服务端文件1389项、44前端文件249项、TypeScript与Vite生产构建全部通过，未混入模块39；不操作生产暂停状态。
- [x] 模块37提交d1d84219d3e79cc8a4d2724bad0db254e5e16561已推送并部署；UTC22:12独立校验476个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。

## 模块38：不可交易报价不触发挂单成交

**Files:** 模块37发布后的`PaperBroker.markToMarket`及独立双Store回归，边界/架构/状态/本计划。

- [x] 同一独立探针另4项先红：tradable=false但穿价的报价，仍能使两Store买卖挂单成交；新提交本来会拒绝该报价，不能混为所有检查皆缺失。
- [x] 仅原guard追加quote.tradable === false，跳过明确不可交易报价并保留挂单/预约与估值，true后继续撮合；缺字段legacy仍兼容，缺报价/非正有限价格原保护保持。
- [x] 新28项真实双Store先16红12绿后全绿；覆盖BUY/SELL、费用/股数预约、无伪事件/审计、主动撤单、他股继续、缺报价/坏价、undefined兼容与JSON重开。作者414相关/TypeScript/diff通过，root完整实现/测试读取无阻断。
- [x] 独立404项、额外6项false先遍历/legacy他股/暂停与JSON字节探针、TypeScript/diff通过。精确暂存树98服务端文件1429项、44前端文件249项、TypeScript/Vite全过，未混入40/41/42。
- [x] 模块38提交97f4b6ac48493ccb1edfd2fa5ef00096d212b7aa已推送并部署，UTC22:25独立校验478个归档文件、三healthy/健康200/匿名401/原账户；不扩行情权限或改变费用、T+1、现金/仓位上限。

## 模块39：RSI单标的历史绑定

**Files:** `server/backtest/strategies/RSIStrategy.ts`与独立多标的历史回归，架构/状态/本计划。

- [x] 独立真实Engine证实：RSI2/30/70/.5，A价格100→101→102、B8→9→10各自上涨且单股/稳定顺序均0单；bar1报价交换或A变不可交易会拼成A100/B9/B10，RSI约1.087并实际买B500@10费5。持仓lookup本来同symbol正确，缺陷在指标历史拼接。
- [x] 现Mock/HTTP提供者Map多为稳定顺序、合成榜/稳健性固定序列，未证明当前线上排名受影响；手动历史/外部快照变序与tradable变化确可触发，不能夸称所有结果错误。
- [x] 首次可交易标的绑定到reset，之后按symbol查找，缺失/不可交易返回空并不追加他股历史，reset清绑定/历史。保留单标的模型与现稳定序列经济语义，不扩成多股Map或增加参数/工厂/生产策略变更。
- [x] 新12项先9红3绿后全绿，覆盖换序、缺失/不可交易→恢复、空暖机/首次选择、他股持仓不误卖、reset重选及引擎重复确定性；作者256项、独立231项及服务端类型/diff通过。稳定双股旧新完整报告deepEqual，均3单/3成交、佣金15、期末现金5980/权益10980。root完整实现/测试复核无阻断。
- [x] 精确暂存树97服务端文件1401项、44前端文件249项、TypeScript与Vite生产构建全部通过，未混入模块38/40/41。
- [x] 模块39提交8095f1aee48aabab5bed5cc89861c80e435f9ae3已部署并于UTC22:22独立校验477个归档文件、三healthy/健康200/匿名401/原账户。GitHub先持续连接失败，按已验证本地SHA部署；连接恢复后已成功补推。

## 模块34：同股待买暴露与成交仓位复核

**Files:** `server/broker/paperBroker.ts`、`server/risk/riskEngine.ts`及必要真实双Store回归，架构/安全/决策/状态/本计划。

- [x] 独立真实双Store复现：现金10000/上限25%，行情11时同股两笔200股@10各20%均挂单，跌至10后全部成交，费用后权重40.0400%；待买加市价亦达30.3367%。不同标的应分别预算。既有相关132项全绿但未覆盖叠单。
- [x] 另一持仓下跌可使原24.012%合法挂单成交到25.5591%；仅提交聚合不够。单笔本金恰25%支付5元费用后实际25.0125%，严格成交时上限还须考虑费用后权益。
- [x] 提交同symbol pending BUY名义暴露，默认可选Risk输入兼容；不抵扣pending SELL，不持久化新字段，撤/拒/成交自然释放。先红新增双Store62/Risk4项共66项31红35绿，最终全绿。
- [x] BUY撮合先完整现金后费用后仓位，使用调用方snapshot、每笔最新实际账，实际+本单不重复pending。canonical终态先返回，保持SELL/优先级/成本/幂等。浮点二进制噪声金额比较修复满额1010案例，真实分位超额仍拒；详见决策0017。
- [x] 作者相关21文件439项、独立13文件286项及额外3边界探针通过，TypeScript/diff通过；旧Broker/Risk与当前真实引擎同7单/7成交/9权益点完整报告deepEqual，末权益100200/佣金35。root实现和核心测试复核无阻断。
- [x] 首次精确快照全量服务端1351绿/1红：既有零预留回归用800股在80%硬限恰卡手续费前边界，新费用后检查正确拒绝。仅该场景测试上限设81%以隔离总仓位85%政策，保持800股、零预留/90%总仓位与最终现金981断言；生产额度与其他单股拒绝测试不改。前端44文件249项、TypeScript/Vite通过，修正后复验见下。
- [x] 修正fixture后的精确暂存树95服务端文件/1352项与全TypeScript通过；运行源码与前次前端44文件249项/Vite已过版本相同，仅测试与文档变化。独立69项确认fixture仍抓旧总仓位预留且不放宽生产限制，未混入模块35/36。
- [x] 模块34提交35f18abe71d384748bc913f2128af3fa522e6566已推送并部署；UTC21:57独立校验475个归档文件、三容器healthy、健康200/匿名401，原Paper账户及策略保留。上限只约束买入时刻，之后市场波动仍会改变权重。

## 模块40：布林带单标的历史绑定

**Files:** `server/backtest/strategies/BollingerBandsStrategy.ts`与独立真实Engine多标的回归，架构/状态/本计划。

- [x] 独立真实Engine4项证实：period6、2σ，两股各自上涨/下跌均无额外单，最后bar换首或首股不可交易会拼接价格、误买B500@10或误卖已有B100@100。原实际持仓lookup正确，问题在单prices跨symbol。
- [x] 新13项真实Engine先10红3绿后全绿，仅首次tradable绑定到reset，缺失/不可交易等待，不追加别股历史；保留period/std、阈值等号/退出OR、权重/实际可卖整手。
- [x] 覆盖误买/误卖、同股真实进出、缺失恢复、首次暖机、其他持仓、平仓后重入/reset；作者244项/类型/diff，独立123项及root完整diff/测试复核通过。3组含成本旧新完整报告相同（period3/6/默认20，12/3/10实际成交）。
- [x] 精确暂存树99服务端文件1442项、44前端文件249项、TypeScript/Vite全过，未混入41/42/43/44。
- [x] 模块40提交db755b14cdd3ecf48e5845bec69af5b144157a32已推送并部署，UTC22:29独立校验479个归档文件、三healthy/健康200/匿名401/原Paper账户。

## 模块41：自动执行与Broker费用舍入一致

**Files:** `server/trading/paperAutoExecutor.ts`的preflightOperations与真实runOnce回归，架构/安全/状态/本计划。

- [x] 独立真实Executor+Broker证实：默认166.72报价100股滑点后166.80、Broker佣金5.00而预算5.004，恰够16685却误跳；两笔166.76报价佣金应5.01却少预算，第二笔可真差0.01后才被Broker拒。既有110项无覆盖。
- [x] 新12项真实runOnce先7红5绿后全绿，覆盖精确够钱、多单累计、真正不足先跳、合法fractional最低佣金与二进制噪声。仅预算复用executionCosts的notional/cashDebit与hasSufficientCash，扣减相同cashDebit；保留消息/阶段/幂等/笔数/SELL/原projectedMarketValue名义口径。
- [x] 作者229项/类型/diff，独立347项及额外7个非零reserve/真实小数缺口/各cap优先/真实SELL预算隔离探针通过；root完整实现和12新测试复核无阻断。
- [x] 精确暂存树100服务端文件1454项、44前端文件249项、TypeScript/Vite全过，未混入42/43/44/45/46。
- [x] 模块41提交5cb6a53847a0ae324f084933bde4d1b750b966bc已推送并部署，UTC22:33独立校验480个归档文件、三healthy/健康200/匿名401/原账户；未变费率、生产配置、策略选择或账户。

## 模块42：动量单标的历史绑定

**Files:** `server/backtest/strategies/MomentumStrategy.ts`与真实Engine多标的回归，架构/状态/本计划。

- [x] 独立只读真实Engine：entry2/exit1，A1/.9/.8、B12/11/10各自下跌，stable/A-only/B-only均0单；最后bar换B优先或A不可交易，混合A1/A.9/B10触发误买B500@10费5。默认20/10的21bar同样复现；当前固定顺序提供者/榜单未证明受到影响。
- [x] 新17项真实Engine先15红2绿后全绿，首个tradable绑定到reset，后续只按同symbol收历史，缺失/不可交易等待；保留模块30完整N/M历史窗、N+1/M+1暖机、阈值等号和模块32实际持仓/可卖整手。
- [x] 覆盖默认/小窗误买误卖控制、真实种仓/同股进出/T+1、等待恢复、暖机、reset。作者261项/类型/diff及3组完整报告一致；独立198项与另3组含成本完整报告一致，并逐字验证prices.push后原窗口/持仓实现保持。root完整实现/测试复核无阻断。
- [x] 精确暂存树101服务端文件1471项、44前端文件249项、TypeScript/Vite全过，未混入43/44/45/46/48。
- [x] 模块42提交d60b0453e8f5e68eed19e678bd6766ba52dcdc12已推送并部署，UTC22:35独立校验481个归档文件、三healthy/健康200/匿名401/原Paper账户。

## 运维：有界清理可再生构建缓存

- [x] UTC22:13无部署构建期间，仅Docker build cache清理（until=1h、keep-storage=8GB），释放14.72GB，根盘可用7.0G→21G/使用82%→46%。三个生产容器ID/healthy前后相同，未清镜像/volume/账户/配置/证书。原始结果保存在忽略runtime/module-37-build-cache-maintenance.log。

## 模块43：均线交叉单标的状态绑定

**Files:** `server/backtest/strategies/MovingAverageCrossStrategy.ts`与新真实Engine专项回归，架构/状态/本计划。

- [x] 独立真实Engine：MA1/2时A1/.9/.8与B12/11/10均下跌，末bar换首或A=false误买B500@10费5；stable及单股0单。默认5/20的21bar亦复现。
- [x] 新12项真实Engine先9红3绿后全绿，仅首次tradable绑定至reset，缺失false等待，不混他股历史；保留交叉条件/暖机/权重和原intent状态。实际持仓独立缺陷不混入本模块。
- [x] 作者298项/类型/diff及稳定4成交完整报告相同；独立88项与3组含成本完整报告（17/27/4成交）一致，原交叉/暖机/intent逐行保持。root完整diff/12新测试复核无阻断。
- [x] 精确暂存树102服务端文件1483项、44前端文件249项、TypeScript/Vite全过，未混入44/45/46/47/48。
- [x] 模块43提交cbf555859bb2e2cb26b11d858c32ace906700069已推送并部署，UTC22:38独立校验482个归档文件、三healthy/健康200/匿名401/原Paper账户。

## 模块44：海龟单标的状态绑定

**Files:** `server/backtest/strategies/TurtleStrategy.ts`与新真实Engine专项回归，架构/状态/本计划。

- [x] 独立真实Engine：Turtle2/1/0时A1/.9/.8与B12/11/10均下跌，末bar换首或A=false误买B500@10费5；stable及单股0单。默认20/10/50的50bar亦复现。
- [x] 新14项真实Engine先12红2绿后全绿，仅首次tradable绑定至reset，缺失false等待，不混他股价格/估算高低；保留已修完整N/M过去窗口、均线过滤、±1%估算/权重和原intent状态。实际持仓独立缺陷另列。
- [x] 作者287项/类型/diff及3组含成本旧新报告一致；独立172项、另3组完整报告与prices之后逐字保持校验通过。默认/小窗、同股进出/filter退出、历史最旧边界、缺失恢复/reset覆盖；root最小实现复核无阻断。
- [x] 精确暂存树103服务端文件1497项、44前端文件249项、TypeScript/Vite全过，未混入45/46/47/48/49。
- [x] 模块44提交71333fc431fe6bebd89de39abc86bd17eaca98ff已推送并部署，UTC22:41独立校验483个归档文件、三healthy/健康200/匿名401/原Paper账户。

## 模块45：MACD单标的状态绑定

**Files:** `server/backtest/strategies/MACDStrategy.ts`及新真实Engine专项回归，架构/状态/本计划。

- [x] 独立真实Engine：MACD1/2/2，A1/.9/.8/.7/.6与B14/13/12/11/10均下跌，末换首误买B500@10费5；stable及单股0单。
- [x] 新15项真实Engine先12红3绿后全绿，仅首次tradable绑定到reset，缺失false等待；保留EMA/信号线/暖机/交叉/权重/原intent，默认及小周期误买、错误他股退出均覆盖。
- [x] 作者288项/类型/diff及3组含成本旧新报告一致；独立316项、复跑3组报告、另3组真实gap/他股极值有效bar信号/成交经济字段对照通过，root最小实现复核无阻断。
- [x] 精确暂存树104服务端文件1512项、44前端文件249项、TypeScript/Vite全过，未混入46/47/48/49/50。
- [ ] 单独提交部署与独立核验。

## 模块46：网格基准单标的绑定

**Files:** `server/backtest/strategies/GridTradingStrategy.ts`及新真实Engine专项回归，架构/状态/本计划。

- [x] 独立真实Engine：默认Grid，A恒100/B恒10，onStart以A100定base后次barB优先或A=false，误生成5笔B100@10/佣金25；stable及单股0单。
- [ ] 先核对onStart/reset生命周期，先红后绿让base与首标的同步绑定；后续只同股，缺失false等待，reset清全部原状态与绑定。不扩成多股网格或改网格级差/数量/限额。
- [ ] 独立复核、稳定完整报告、精确全检查与单独提交部署。

## 模块47：海龟实际持仓信号

**Files:** 模块44发布后的`TurtleStrategy.ts`、真实Engine持仓专项及仅必要旧通道fixture更新，架构/状态/本计划。

- [x] 独立真实Engine：Turtle2/1/filter0/weight1、cash2005、9/9.9/10.01/10.2，首次买200+费被拒却flag=true，下一仍突破可买100而无信号；内存仅实际持仓校准对照真实成交100@10.2/费5/现金980。
- [ ] 等44发布后先红后绿，读取绑定股实际quantity，退出用min(actual,available??actual)100整手；去掉intent/未使用entryPrice。保留完整过去N/M窗口、filter两退出分支、±1%估算/比较/权重；持续突破/退出条件在拒单后仍可检查，T+1锁定等待。
- [ ] 验证费用/风险拒买后重试、T+1次日退出/拒卖后实际仓、部分可卖/他股隔离、reset与正常稳定旧新报告。旧窗口断言保留，若需持仓只显式控制真实context或Broker种仓，不放松原经济断言。独立复核、精确全检查、单独发布。

## 模块48：均线交叉实际持仓信号

**Files:** 模块43发布后的`MovingAverageCrossStrategy.ts`、真实Engine持仓专项及原symbol回归必要信号形状更新，架构/状态/本计划。

- [x] 独立真实Engine：MA1/2/.5，同日10/9/10/9/10，买500后死叉卖被T+1拒、intent=false，下一金叉实际仍持500却再买400，末900/现金990；仅实际持仓校准对照持500/现金4995。
- [ ] 等43发布后先红后绿，绑定股实际quantity替代intent gate，退出用实际可卖100整手。保留strict金叉prevFast<=prevSlow且fast>slow、死叉prevFast>=prevSlow且fast<slow及slow+1暖机；不在无新交叉时补卖或持续重买，不套持续突破重试语义。
- [ ] 验证T+1后不叠买/下一真实死叉退出、拒买后下一真金叉、部分可卖/他股/外部清仓、reset与正常含成本旧新完整报告；独立复核、精确全检查、单独发布。

## 模块49：MACD交叉实际持仓信号

**Files:** 模块45发布后的`MACDStrategy.ts`、新真实Engine持仓专项及旧symbol专项必要信号形状更新，架构/状态/本计划。

- [x] 独立真实Engine：MACD1/2/2/.5，同日10/9/8/7/10/7/10，bar4买500、bar5死叉卖被T+1拒却flag=false、bar6金叉再买400；末900/现金990，actual诊断仅500/现金4995。
- [x] 独立真实部分可卖例：10/9/8/7/10/11/7，day3 bar5真实另买100，bar6实际600但可卖500，原targetWeight1卖600拒，actual诊断仅卖500@7费5、保留100锁定/现金7385。费用拒买后下一真金叉原已恢复，不误报。
- [ ] 等45发布后先红后绿，actual同股quantity gate+min可卖整手，保留EMA/slow+signal暖机/prevHistogram每次更新及prev<=0/>0或>=0/<0事件；无新交叉不补单。
- [ ] 验证T+1不叠买、下一新死叉/部分可卖、费用拒买后下一真金叉原报告兼容、其他持仓/reset与正常含成本完整报告；独立复核、精确全检查、单独发布。

## 模块50：研究页签连续键盘焦点

**Files:** `src/hooks/useNavigationFocus.ts`与新真实AppShell/Router/MarketResearchWorkspace集成回归，产品/架构/状态/本计划。

- [x] 独立真实集成证实：A股页签ArrowRight立即选中/聚焦turning，query导航改变location.key后RAF却将焦点抢至main，第二次方向键无法切到stock。当前仅MarketResearch的ARIA tab会触发路由，原快速搜索/跨页定位必须保留。
- [ ] 先红后绿；导航完成时若无显式targetId，且main中当前activeElement仍是aria-selected=true的role=tab，尊重已由页签管理的焦点并不重复滚动。仍记录completedKey/disconnect，原lazy等待/取消保持；显式深链、主内容外焦点、未选中tab和历史切换继续原导航定位。
- [ ] 真Router集成覆盖连续左右/循环/Home/End、mouse与lazy完成、refresh不抢焦点、快速搜索进market、跨页、历史返回和显式target；保留原导航7项、独立复核、精确全检查与单独部署。
