# Paper执行器通知等待的账本一致性

使用executing-plans、kairos-portfolio-allocation-review和kairos-release-verification在当前聊天依次实施。基线927fd0e，0129及唯一回执已全部完成；UTC23:40停止新复杂代码及全部发布，UTC11月14日00:00截止，不顺延。

**目标：** 计划及预检完成后等待通知期间，若有外部挂单、成交、拒单或撤单，停止执行这份过期计划，保留已经成功的外部账本操作。

**架构：** 将0129相同的最近10000笔订单、全部pending平面副本、总/可用现金捕获和精确比较抽到paperExecutionContext。原计划服务调用共享函数、正常仍使用冻结orders。执行器仅在已有通知await前捕获，通知返回原控制检查后复核；保留已有日期/时段提前退出顺序，无通知时不增加捕获。冲突沿原409类/watch-only，不新增自动重试、通知或订单。比较不放在本轮逐笔提交循环，避免把本轮已成功成交当外部变化而误停第二单。

**技术：** TypeScript、Node内置isDeepStrictEqual、真实PaperBroker/内存和JSON仓储、Vitest、有界已有发布工具。

## 步骤

- [x] Create server/trading/paperAutoExecutor.notificationLedger.test.ts。复用现有控制边界测试方法，只固定外部计划输入和本地通知promise；真实Broker执行外部挂单、即时成交、撤单、同数量挂单成交、拒单、先挂后撤资金恢复和无现金变化卖单撤销。两Store覆盖；控制包括没有变化时两笔自己的成交，以及报价/审计/风险观察变化。所有通知为本地stub，无生产调用或测试通知。
- [x] 在旧927fd0e运行真实反例/控制：`node node_modules/vitest/vitest.mjs run --dir server --environment node server/trading/paperAutoExecutor.notificationLedger.test.ts --maxWorkers=2 --minWorkers=1`。记录失败确实为旧计划被自动提交，不能把无效夹具算反例。
- [x] Modify server/trading/paperExecutionContext.ts：导入isDeepStrictEqual和OrderRecord，增加PaperLedgerContext及capturePaperLedgerContext(store)、assertPaperLedgerContext(store, expected)；复制/比较与0129原代码完全一致，变化抛已有ledger固定理由。Modify server/research/paperTradingPlanService.ts，用共享函数替换原捕获/比较，orders引用ledgerContext.orders。
- [x] Modify server/trading/paperAutoExecutor.ts：有通知时在notify await前捕获`const notificationLedgerContext = capturePaperLedgerContext(store)`，notify返回的既有assertExecutionContext之后增加`assertPaperLedgerContext(store, notificationLedgerContext)`。保留原控制优先、时段/日期/逐笔报价及Broker最终风控。无行情分支不提交订单，不扩大本项范围。
- [x] 一次一个Vitest，先新通知边界/原0129/控制/HTTP/执行器相关，再完整server；server/app TS/Vite。复用0129离线24组完整旧/新服务输出/经济输入对照，以927fd0e为新基线验证抽取等价，不重复旧收益研究或称新样本外。前端509/桥接308/归档41无改继承。
- [ ] 更新0130决策、架构/状态/总计划；独立提交、推送exit0且HEAD=upstream/干净树后部署。新鲜完整经济/风险、实际上传归档字节/SHA/哈希、三健康、双域可信HTTPS/匿名401、上一927fd0e材料及实际运行API不可变镜像禁网全后端测试。
- [ ] 源码验收后仅一次文档回执；严格保持三个已测容器及镜像，最终写runtime/handoff，不递归发布回执。

## 边界

这是预检后通知等待的独立保护，不声称已发生真实账户错误或解释实际亏损。不保证撤回已发送通知，不撤销外部操作；研究返回包装、本轮同步提交中onOrder/其他同步事件回调引起的外部账本变化及其他消费者仍需独立审查。零固定预留、费用、整手、T+1、策略默认和硬限额保持。

## 流水

- UTC21:48：确认927fd0e/HEAD=upstream、干净树、无在途测试发布，0129验收全部完成。代码确认通知await之后只有账户控制修订检查，普通订单变化不会推进该修订；先以真实本地账本验证影响。
- UTC21:52：两Store旧版14失败/4控制；把首项断言改为实际submittedOrders后再次确认反例确实包含旧自动买单，不以actionable标签替代成交证据，见runtime/2026-11-13-notification-ledger-old-valid.log。
- UTC21:53至21:55：初版在研究前捕获使四项既有时段/日期早退增加订单读取，收窄为仅notify前按需捕获，原控制恢复。最终163相关、201文件3438后端（75.15秒）、server/app TS/Vite通过；24组完整旧/新服务输出及经济输入保持、外部读取0，仅作等价回归。证据runtime/2026-11-13-notification-ledger-{target-final,server,build,compatibility}.log/json。前端509/桥接308/归档41无改继承，未宣称生产等待或胜率改善。
