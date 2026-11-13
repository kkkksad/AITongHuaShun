# 退出研究先校验观察边界执行计划

> 当前聊天按已授权总计划E执行，使用writing-plans、executing-plans、kairos-quant-validation和kairos-release-verification；不新建聊天或并行改共享代码。

**Goal:** 防止退出研究包装器先向有状态原策略提交未来、未完成或无效行情，再丢掉本轮信号而留下污染状态。

**Architecture:** 只调整createStrategyExitResearch非native分支的调用顺序。先复用现有唯一标的、paper、完成收盘、asOf、源时点、有限正价格和递增时钟检查；通过后才复制上下文并调用原策略、校验意图及统计被替代卖出。现有退出参数、native原实例、计划/路由/执行器保持。

**Tech Stack:** TypeScript、Vitest、现有216组共享资金历史工具及独立核验器、现有发布helper。

## Task 1：固定反例

文件：server/research/strategyExitResearch.test.ts。

- [x] 在两个非native模式下，为future/intraday/stale-quote/duplicate/reversed/missing-quote/duplicate-quote/non-paper/bad-price建立有状态原策略。先读有效10元，再送无效999元，再读有效10元；无效观察不得推进原策略，后一有效买入与只读有效序列的控制一致。具体核心反例：

```ts
let previous = 10;
let calls = 0;
const original = base(value => {
  calls++;
  const prior = previous;
  previous = value.snapshot.quotes[0]?.price ?? Number.NaN;
  return prior <= 10 ? [buy, sell] : [];
});
const result = createStrategyExitResearch(original, symbol, "trend", "family-exit", asOf);
result.strategy.onBar(context(0));
const future = context(1, 999);
future.snapshot.marketTime = future.snapshot.quotes[0].updatedAt = "2026-01-01T15:00:00+08:00";
expect(result.strategy.onBar(future)).toEqual([]);
expect(calls).toBe(1);
expect(result.strategy.onBar(context(1))).toEqual([buy]);
```

- [x] 增加无效观察不调用会抛错原策略的检查；有效观察的错误仍向上传递，native仍返回原实例，不吞原意图错误。保留原T+1、整手、实际成本、年龄、回调隔离和次开成交用例。
- [x] 运行旧版目标，保存失败日志：`node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/strategyExitResearch.test.ts --maxWorkers=2 --minWorkers=1`。预期新增反例因callback已被调用失败，不能把原47项当缺陷。

## Task 2：最小顺序修复

文件：server/research/strategyExitResearch.ts。

- [x] 将原策略回调、validateIntent、replacedNativeSellSignals及buys复制四步移到原有效观察检查之后，previousClose更新之前。检查表达式及已有退出判断原样保持：

```ts
if (context.snapshot.mode !== "paper" || quotes.length !== 1 || !validTime ||
  !Number.isFinite(quote.price) || quote.price <= 0 || Date.parse(quote.updatedAt) !== close ||
  (previousClose !== undefined && close <= previousClose)) {
  diagnostics.invalidCloseObservations++;
  return [];
}
const raw = base.onBar(structuredClone(context));
validateIntent(raw, symbol);
diagnostics.replacedNativeSellSignals += raw.filter(signal => signal.side === "sell").length;
const buys = raw.filter(signal => signal.side === "buy").map(signal => ({ ...signal }));
```

- [x] 重跑原目标与nextOpenPortfolioResearch相关测试；只允许一个Vitest在途。非法观察只增加原invalidCloseObservations，不计原策略信号、不推进原策略或政策时钟；有效路径不改变经济规则。

## Task 3：已知历史行为与全套

- [x] 先核对既有冻结输入及216组旧报告SHA；参数、2万元共享本金、T+1/整手、三窗/双成本/正逆顺序保持，不追加选参，不将同批样本称新OOS。
- [x] 顺序运行两次：`node node_modules/tsx/dist/cli.mjs scripts/research-strategy-exits-history.ts runtime/bank-portfolio-history-attempt1.json runtime/2026-11-13-exit-boundary-a.json`及不同b.json输出；用scripts/verify-strategy-exit-history.cjs沿原204组控制独立验证逐笔资金、费用、FIFO、库存、次开价、回撤和native保持。
- [x] 将新216组逐组完整结果（去掉源码身份元信息）与原216组比较，报告任何变化，不以收益较高选实现；若固定有效输入均未触发坏观察，应保持全部经济和诊断。
- [x] 完整server单Vitest及TS/Vite；前端/Python/归档无改沿用已验证460/308/41，不无故重复。
- [x] 实际生产API镜像上线后禁网完整server验证，无账户/凭据挂载。

## Task 4：文档、提交及发布

- [x] 新增docs/decisions/0120-exit-research-observations-before-callbacks.md，更新研究局限/状态/总计划，明确这是离线工具时间边界修复，不是历史亏损根因或线上策略默认改善。
- [x] 保存新鲜动态完整经济/风险与三容器基线，独立提交推送退出0、HEAD=upstream且干净后发布。
- [x] 核对实际归档字节/SHA、三健康、双域可信HTTPS/匿名401、动态完整经济及完整风险检查点、上一80a73a4源码/三镜像/私有导出与覆盖拒绝；桥接保持。一个文档回执后接续，不递归回执。

## 流水

- UTC16:37：本地/upstream/生产80a73a4，工作树干净；动态账户四仓六单、经济及完整风险摘要保持，runtime/2026-11-13-1637-checkpoint.json。无在途测试/发布；截止UTC23:40冻结/00:00结束不变。
- 现有216组历史明确坏完成观察为0，本项不能预先声称改变这些历史经济结果；核心风险是当前包装器先回调再检查时间，需用状态污染反例验证。

- UTC16:45本地完整194文件3213后端、目标100、TS/Vite通过。新增22项旧版20失败/2控制；同一216组新输出SHA85718c6a两次一致，6024逐笔独立重建、最低现金0、72native保持；全部216完整交易/经济/诊断与旧报告保持。不是新OOS或线上默认改善。

- UTC16:55至16:58：5022affdd88cd9bf35de7b964c74e63f6958d5eb推送/部署退出0，882实际上传文件逐哈希、三健康、六次系统可信HTTPS/匿名401、动态完整经济和风险摘要保持、上一80a73a4源码/三镜像/私有导出/覆盖拒绝通过，桥接身份保持。实际新API镜像禁网、无生产账户凭据挂载194文件3213项通过（101.81秒）。证据runtime/2026-11-13-exit-boundary-{summary,https,retained,before,after}.json及-production-server.log。
- 本次一次文档回执包含用户新授权工具的真实安装与验证记录；回执发布后仅核对三已测容器/镜像保持，不递归回执，也不重跑未变的完整应用测试。
