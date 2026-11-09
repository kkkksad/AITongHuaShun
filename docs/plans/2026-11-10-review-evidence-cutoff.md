# 模块19：日复盘和通知的报告时刻边界

> 按writing-plans规划、executing-plans在当前已授权工作树执行，完成核验后独立提交推送部署。

**Goal:** 日复盘与通知不得把晚于报告时刻的同日成交、委托或审计当成已发生事实。

**Architecture:** 报告冻结一个asOf，先核对来源时刻，再按北京时间归属交易日。日复盘保留报告前的委托活动，但明确该成交未纳入统计；无法重建报告时刻的资金结果返回不可用，不推算历史资金。通知由执行器显式传入其注入时钟，统计函数默认当前时刻。

**Tech Stack:** TypeScript/Vitest、现有日复盘、通知摘要及React页面；不改变执行器下单、资金和风控。

## 实施与验证

- [x] 新增`server/research/dailyMarketReview.cutoff.test.ts`，覆盖同日未来成交、恰好边界、旧更新时间、未来委托/审计、未来记录不进入资金重建；新增7项。最初两文件12项旧版10失败/2通过；后续纠正运行审计夹具使用实际regime字段，并追加未来行情/账户案例。
- [x] 新增`server/notifications/paperPlanNotifier.cutoff.test.ts`，调用`summarizePaperOrders(orders, tradingDate, audits, asOf)`，6项覆盖同日毫秒边界、北京时间/UTC偏移、旧字段、未来委托和未来理由。
- [x] `dailyMarketReview.ts`用固定now约束统计与审计；`paperPlanNotifier.ts`用asOf约束摘要；`paperAutoExecutor.ts`三处摘要显式传`this.now()`。普通读取不触发策略或通知。

```ts
const time = getOrderFillTime(order);
const inCutoff = time !== null && Date.parse(time) <= asOf.getTime();
```

- [x] 日复盘返回逐行`fillIncludedInReview`，`LearningPipeline.tsx`区分保留成交记录与本日统计，旧响应兼容。页面3项静态渲染行为通过，未声称这些展示案例曾在旧版运行失败。
- [x] 初次五文件96项通过，最终完整134服务端文件2067项、受影响页面四文件14项、TS/Vite通过；0034、产品说明、状态和上一模块实际核验记录已同步。
- [x] `6eec50dc2a8e0b878eeb29fd185edb3e3976964e`独立提交推送部署；直连推送重置后使用既有临时通道正常推送，无改写分支。
- [x] UTC20:58核验585个源码文件、三健康、HTTPS/匿名保护、原20000元现金/零持仓订单、风险检查点保持，归档204运行/67样本/integrity ok与世代保持；上一47e的581文件/三镜像和不覆盖私有导出通过。不发送生产消息、不调用生产策略执行。

## 范围

这是当前账本快照的时间安全摘要，不是历史任意时点的账户回放；尚无完整不可变事件日志，未来时间字段出现时不猜测当时终态或资金。前项磁盘核查有6.49GiB余量、旧镜像不足24小时，未删除资源，不为占满CPU新增服务。
