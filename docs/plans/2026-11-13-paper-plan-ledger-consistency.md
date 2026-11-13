# Paper计划等待期间的资金与订单一致性

当前聊天使用writing-plans、executing-plans、kairos-portfolio-allocation-review和kairos-release-verification逐项实施。基线703dcdd，0128及唯一文档回执已完成，不重复发布。截止UTC23:40冻结所有发布、UTC11月14日00:00结束。

**目标：** 计划等待历史研究期间发生挂单、成交或撤单时，不再把等待前的账户/持仓与等待后的订单拼成一份可消费的计划；以既有409冲突语义要求下一轮重算。

**架构：** 在buildCurrentPaperTradingPlan首次await前保存最近10000笔订单、全部现存pending订单的平面副本和总/可用现金；研究返回（含降级）后，先保留原控制修订检查，再精确比较这些本地账本证据，变化则抛既有PaperExecutionContextChangedError的新固定ledger理由。正常计划使用冻结订单。全部pending单独保存，是为了检测被最近10000笔截断的旧挂单成交/撤销；不能只比较订单数量或依赖可变引用。无新增网络、队列、持久字段或自动重试。

**技术：** TypeScript、node:util.isDeepStrictEqual、真实PaperBroker和内存/JSON仓储、Vitest。默认策略和资金定量不变。

## 文件与步骤

- [x] Create server/research/paperTradingPlanService.ledgerConsistency.test.ts。仅mock外部研究构建边界，以deferred控制真实计划服务的等待；真实Broker完成限价挂单、市价成交、撤单和旧pending状态转变。两Store覆盖，另有只改报价/审计、无变化和缓存复用控制。计划不能撤销或改写外部已成功的订单/现金/风险。
- [x] 实际执行器调用真实计划服务：等待期间的外部订单导致watch-only，不产生自动订单；既有HTTP409/no-store/匿名401用例扩ledger固定理由。无生产调用、通知或人工造生产单。
- [x] 旧版运行保存真实失败与控制：`node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/paperTradingPlanService.ledgerConsistency.test.ts --maxWorkers=2 --minWorkers=1`。
- [x] Modify server/trading/paperExecutionContext.ts：构造器接受可选`reason: "controls" | "ledger" = "controls"`，默认消息保持；ledger仅输出固定“Paper资金或订单账本已变化”说明，不输出账户身份或原始订单。
- [x] Modify server/research/paperTradingPlanService.ts：导入精确比较及已有错误类；在首次await前捕获并在原控制检查后执行下述比较，正常分支把冻结orders传给原构建器：

```typescript
const orders = input.system.store.listOrders(10_000);
const pendingOrders = input.system.store.getPendingOrders().map(order => ({ ...order }));
const totalCash = input.system.store.getCash();
const availableCash = input.system.store.getAvailableCash();
// ... original research await and assertPaperExecutionRevision ...
if (input.system.store.getCash() !== totalCash ||
    input.system.store.getAvailableCash() !== availableCash ||
    !isDeepStrictEqual(orders, input.system.store.listOrders(10_000)) ||
    !isDeepStrictEqual(pendingOrders, input.system.store.getPendingOrders())) {
  throw new PaperExecutionContextChangedError("ledger");
}
```

- [x] 新用例、相关服务/执行器/HTTP冲突/仓储控制测试，再完整server与server/app TS/Vite。一次一个Vitest、显式server/node、最多两worker。用稳定账户固定夹具比较完整旧/新计划，无账本变化时完整输出保持；测6/10000近期订单比较开销并注明本机样本，不称生产提速。
- [x] 更新决策0129、架构、状态和总计划。D的官方来源调查同步记录：上交所同响应确认601398/601288/601166为CSRC门类J金融业；不是银行子类，000001深交所接口500未知，不能混用旧东方财富银行Ⅱ或回填历史分类。来源材料在runtime/2026-11-13-official-industry-source，未接生产分类。
- [ ] 独立提交推送exit0、HEAD=upstream/干净树后部署；新鲜完整经济/风险、实际归档字节/哈希/SHA、三健康、双域可信HTTPS/匿名401及上一703dcdd材料；实际运行API不可变镜像禁网全套。前端/桥接没有源码变化时继承既有验证。
- [ ] 源码验收后仅一次文档回执，验三已测容器严格保持；最终写runtime不递归。

## 范围

这是等待期间账本混用的可复现缺陷，尚不能解释11月13日实际没有买入或历史亏损。不增加行业/相关性硬限额，不扩大固定现金预留，不改变费用、整手、T+1、止损或路由。该模块保护计划生成的等待边界，不能据此宣称所有后续通知等待及其他消费者的并发问题全部解决。

## 流水

UTC21:25在代码中定位首次await前账户/持仓与之后listOrders的时点差；先创建本计划，再通过真实仓储反例验证。

- UTC21:32：修正首次测试未等待共享研究启动的夹具后，有效旧版26项中24失败/2控制，失败均为过期计划未冲突；首轮无效夹具日志不计产品证据。加入资金恢复、同数量订单状态变化、实际10000笔外旧卖单和真实执行器控制。
- UTC21:36：修复后111相关、完整200文件3420后端（73.99秒）、server/app TS/Vite通过。24组冻结时钟完整旧/新服务输出和经济输入保持，外部读取0；21次复制/比较CPU中位6笔0.0031ms、10000笔3.47ms，仅本机样本。证据runtime/2026-11-13-plan-ledger-{old-valid,target,server,build,compatibility}.log/json；前端509/桥接308/归档41为无改继承。
- UTC21:38前只读取得新的发布前完整经济/风险与三容器摘要，生产仍703dcdd。接下来独立提交推送后才发布，尚不声称已上线。
