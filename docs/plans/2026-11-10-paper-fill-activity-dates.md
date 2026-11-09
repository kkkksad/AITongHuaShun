# 模块15：Paper成交活动日期与周度配对复盘

> 使用writing-plans制定、executing-plans在当前隔离分支逐步实施；A/B各自提交推送部署，不改变交易执行或为统计生成订单。

**Goal:** 成交数量、金额、费用和周度FIFO采用实际成交时间，委托数量保留提交时间，正确解释跨日挂单和低活跃证据。

**Architecture:** 新建只读成交时间解析函数，优先filledAt、缺字段旧记录兼容updatedAt；显式损坏不回退createdAt。日复盘同时保留委托与成交集合，周度配对独立升级；不改Broker、账本、日硬上限或资金。

**Tech Stack:** TypeScript、Vitest、现有React复盘页；不新增进程和外部数据请求。

## A：当日成交、通知和明细

文件：新建`server/trading/orderFillTime.ts`及测试；修改`server/research/dailyMarketReview.ts`及测试、`server/notifications/paperPlanNotifier.ts`及测试；前端`src/lib/tradingApi.ts`和`src/components/LearningPipeline.tsx`兼容增加成交时间。

- [x] 用已有通知/日复盘入口补跨日限价单测试：昨天委托今天成交应计今天金额/费用，今天委托次日成交不计今天成交，同日提交只计一次，legacy无filledAt按updatedAt；无效显式时间不得退回提交日，保留诊断。
- [x] 明确旧实现失败的断言：最初12项新增中11失败/1通过，原有47项通过。目标命令：`node node_modules/vitest/vitest.mjs run --dir server --environment node --maxWorkers=1 --minWorkers=1 server/research/dailyMarketReview.test.ts server/notifications/paperPlanNotifier.test.ts`。
- [x] 新增解析函数10项单元边界：非filled返回null、有效时间转统一ISO、显式坏时间返回null，旧字段兼容但不读createdAt。

```ts
export function getOrderFillTime(order: OrderRecord): string | null {
  if (order.status !== "filled") return null;
  const time = Date.parse(order.filledAt ?? order.updatedAt);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
```

- [x] 日复盘submitted仍按createdAt；filled从全体订单按成交日选出。明细为提交日或成交日的并集、按活动时间排序，保留原createdAt并增加filledAt；入场结论仅取当天买入成交。现金拒单/开盘提交统计保持提交日。损坏成交时间写明确研究缺口，不猜日期。
- [x] 通知成交数量/金额/费用从全体订单按成交日选择；拒单/未成交委托仍按创建日。新增可选unresolved时间计数和明确消息缺口提示，不把无法定位日期当零成交；新增消息格式回归通过，未发送生产通知。
- [x] 页面分别显示北京时间委托和成交时间，旧响应缺成交字段显示未提供，解释两种口径及旧单更新时间兼容。沿用页面现有结构，不增加额外查询。
- [x] 完整125服务端文件1953项、51前端文件343项、TS/Vite与diff检查通过；通知最终文案后37项目标再次通过。权威产品说明和决策0034已更新。
- [ ] A独立提交推送部署，验证HTTPS/三健康/匿名保护/原账户及归档世代。

## B：周度成交日与FIFO时间序

文件：`server/research/weeklyPaperReview.ts`及测试，复用A解析函数。

- [ ] 复现跨周委托/成交归属错误与乱序限价单造成FIFO盈利失真；加入不同ISO时区表示、同时间稳定序和旧时间字段案例。
- [ ] 周度submitted/rejected/pending/cancelled仍使用提交日，filled与每日成交/费用/策略分布/成交天数使用成交日；活动证据不能仅从本周提交数判断。本周无新委托但有历史挂单成交应显示实际成交。
- [ ] FIFO仅按真实成交时刻稳定排序，卖出闭合归属成交日；不以未来成交买单匹配早先卖单，缺失入场不制造胜率。明确FIFO片段胜率与完整持仓周期风控计数的不同口径，不把其当真实收益或策略预测。
- [ ] 目标回归、必要全套/构建与文档完成后独立提交推送部署核验；若触及既有胜率口径需独立记录决策。

## 执行记录

当前已确认三个只读入口仍使用createdAt归属成交；日收益重建已采用filledAt/updatedAt，本模块不重写其资金算法。生产当前零订单，不据此断言曾实际漏记成交；修复依靠受控订单案例。

A最终目标三文件70项通过（通知37、日复盘23、时间解析10）。新增内容是只读统计与显示，不改变执行器以clientOrderId日期前缀计算的提交硬上限；执行器成交目标日期口径仍是独立后续项。
