# 持仓共同风险证据执行计划

> 当前聊天执行，使用executing-plans、kairos-portfolio-allocation-review和kairos-release-verification。只读解释当前已成交持仓；不改变策略、仓位预算或订单。

**Goal:** 在既有Paper计划显示股票市值占当前权益、持仓内比例及两两历史共同变化，解决股票数量被误当分散、成本投入被误当当前仓位的问题。

**Architecture:** 在已有市场研究已请求的原始股票日线边界计算有界相关性，保留原拒绝日期和完成时点；核心缓存保留原historyAsOf。计划服务用每次已读的账户/持仓投影当前风险，页面复用同一计划响应，不增加HTTP、历史读取或后台任务。只展示当前成交持仓，不冒充含挂单和拟买的组合硬风控。

**Tech Stack:** TypeScript共享DTO、原historicalCorrelation纯函数、React、Vitest、现有发布helper。

## 文件与步骤

- [x] 新增server/research/marketRegimeResearch.correlation.test.ts，通过实际analyzeMarketRegimeData证明原报告缺少所需证据；对两股有效历史、请求外身份、重复股票/日期、零量、未来未完成、days预算、13股上限、错误供应方及外层不可用验证。先保留旧版失败。
- [x] 新增shared/paperPortfolioRisk.ts、server/research/stockCorrelationEvidence.ts及server/research/paperPortfolioRisk.ts。原historicalCorrelation仅增加可选requestedSymbols/maxBars并声明共享返回类型，默认算法/120区间/60门槛保持。生产限12身份/66对；来源仅固定安全标签，缺失来源保持未知。市场研究从原始响应构建，不能从已清理日线制造跨坏行收益。
- [x] 原市场报告增加可选stockCorrelations，外层timeout/mock fallback不伪造选择集合。PaperTradingPlan及tradingApi增加可选portfolioRisk，buildCurrentPaperTradingPlan在既有计划之后投影，只读并保留原valuationAsOf与缓存historyAsOf。未来/非法研究边界不使用，缺历史/短样本/常数序列保持不同未知；按总权益与按全部持仓市值计算分母，不能只用展示的12股。
- [x] 新增纯投影测试覆盖现金分母、陈旧weight字段不可信、13股截断分母、非法/重复估值、空仓、部分历史/短样本/常数、缓存时点、输入不变与缺证据。扩实际服务缓存用例，证明两次仅一次核心读取、原证据时间不刷新、账户当前值重算、订单/风险不因诊断改变。
- [x] 新增src/components/PaperPortfolioRiskPanel.tsx及对应测试，LearningPipeline已加载计划内引用。旧后端明确缺证据；展示范围/估值时点/历史截止、来源、样本日期及unknown，不显示胜率或“已分散”。表格折叠、12股/66对有界、手机可滚动，零新请求。复用已有表格样式。
- [x] 单Vitest依次运行server目标、src目标、完整后端、完整前端；共享契约改变再TS/Vite。Python/归档源码无改为继承验证。用隔离生产模式fixture浏览器检查桌面/手机和无外部请求，不能调用生产计划造样本。
- [x] 更新决策0119、状态页及总计划；单独提交推送exit0、HEAD=upstream且干净后发布。新鲜经济/风险摘要、869起的实际上传文件、三健康、双域可信HTTPS/匿名401、上一8e180c1源码/三镜像/导出拒绝覆盖及实际生产API镜像禁网测试。原桥接保持；一次文档回执后继续下一模块。

## 断言与边界

与原报告删除新字段后的市场分类、路由、Paper操作、资金与风险必须完全一致；相关性不被任何策略/自动执行判断读取。不得从当前行业名称补分类，不开启行业/相关性硬限额。历史pairwise窗口不同不能拼成协方差矩阵，零方差不是零相关；共同缺失日无法凭观察区间证明完整交易日历。没有新生产读行情、策略运行或通知。UTC23:40停止所有新发布，00:00截止不变。

## 流水

- UTC15:45：本地/upstream/生产8e180c1，工作树干净；无在途测试/发布，三健康、动态完整经济与完整风险摘要保持，证据runtime/2026-11-13-1545-checkpoint.json。开始反例，不把之前离线60区间结果硬编码到产品。
- UTC15:49至16:06：旧实际分析缺字段反例已失败；实现和新增33后端/8前端完成。目标5文件116项、完整194文件3191后端、65文件460前端和TS/Vite通过。前端初轮原导航超时/连带焦点失败，单文件9项和完整一worker460项复测通过，未改导航或增加超时。
- 独立32组真实冻结输入新旧报告删除新字段后严格一致；原计划运行源码仅类型增加。固定输入交替20次CPU中位29.28→48.82ms、P95 32.96→52.72ms，仅为诊断增加CPU的本机测量，不是生产延迟。证据runtime/2026-11-13-portfolio-evidence-invariance.json。
- 隔离Chrome生产fixture覆盖正常/缺历史/短样本/常数/非法估值/13持仓/空仓/旧后端×三宽度24组，零组件数据请求且页面无横溢，390px截图人工核验。证据runtime/portfolio-evidence-browser-19e3636a30/result.json；所有表格在窄屏内部滚动。
- 发布前动态检查runtime/2026-11-13-portfolio-evidence-before.json：生产8e180c1、三健康、现金12812/四仓/六单；后续完整经济和完整风险摘要逐字节摘要比较，不以这些数值代替动态对账。接下来提交、推送退出成功后发布并完成实际API镜像禁网测试。
- UTC16:07源码4a4d8a78de1108f504152ed738ac064e96506b68提交推送退出0，HEAD=upstream且工作树干净后开始发布，发布退出0。UTC16:09校验878实际上传文件、三健康、可信双域HTTPS六检查/匿名401、动态完整经济/完整风险检查点保持、上一8e180c1源码三镜像及私有导出覆盖拒绝通过；桥接容器和镜像保持。runtime/2026-11-13-portfolio-evidence-{verification,before,after,https,retained,summary}.json。
- UTC16:11实际生产API镜像禁网完整194文件3191项通过（99.89秒），仅挂载公开deploy/public/Dockerfile/.dockerignore源码fixture，没有生产账户或凭据。runtime/2026-11-13-portfolio-evidence-production-server.log。资金/路由/执行器不变；下一步只做一次文档回执并确认已测三容器保持，然后接续总计划。
