# 模块16：真实策略历史证据与固定参数复核

> 使用writing-plans制定，executing-plans在当前分支逐项实施，各模块必要验证后独立提交部署。

**Goal:** 真实策略研究只消费报告时点已完成、符合请求股票及前复权语义的有效历史，再以固定参数记录真实样本和成本证据。

**Architecture:** 在只读稳健性研究入口增加有界历史校验，17个代表策略和三个不重叠窗口保持；不使用该批验证结果重新调参或直接更改自动交易许可。

**Tech Stack:** TypeScript/Vitest、现有BacktestEngine和AkShare只读桥接；不新增常驻服务。

## A：历史时点、字段和身份边界

文件：新增`server/research/strategyHistoryEvidence.ts`；修改`strategyRobustness.ts`，新增`strategyRobustness.historyEvidence.test.ts`，维护产品说明和0036决策。

- [x] 最初24项新增旧版21失败/3通过：未收盘/未来、坏日期、非有限或不一致OHLC/量额、重复日期/股票、非qfq和请求外股票；299旧日线加未来记录可错误运行榜单，修复后不能凑门槛。
- [x] 报告固定now，上限取now与快照较早者；日线15:00北京时间已完成才使用。helper可注入asOf；无效或比报告未来超过5秒快照不发起请求。

```ts
const cutoff = Math.min(now.getTime(), Date.parse(input.snapshot.marketTime));
const complete = Date.parse(`${bar.date}T15:00:00+08:00`) <= cutoff;
```

- [x] 严格民用日期、正有限OHLC、high/low包围open/close、非负有限volume及可空amount；重复日期/股票全部排除，不猜版本，不补价格或复权。零成交量只估值，真实BacktestEngine夹具证明信号不成交。
- [x] 仅AkShare返回、本次股票、非空实际源与qfq；最多最近请求预算/500条，警告明确丢弃数量与降级。聚合来源取实际有效序列；17固定策略/三窗口/费用模型保持。
- [x] 最终31项新增加原6项共37项、完整130服务端文件2043项及TS/Vite通过。无前端或共享结构变化，前端343项/页面8项沿用此前独立验证，不重复声称新跑。
- [x] A `8ab26f4`独立提交部署，UTC20:02核验569文件、三健康、HTTPS/200与401、原20000元账户/检查点；归档200运行/56样本/integrity ok与账户世代保持，上一E版565文件/三镜像/私有导出通过。正式交易许可与参数不变；GitHub直连及临时通道受网络重置影响，继续重试同步，不声称已推送。

## B：真实历史固定参数与成本证据

- [x] UTC20:23:54只读冻结12只真实股票各500日，实际均eastmoney-stock-history/qfq，共同494日，入口无排除/来源警告。单独脚本仅InMemoryTradingStore，不装配生产system/Executor或读写账本。
- [x] 固定17参数/三个164、164、166日窗口，先复现旧多报价输入只测试第一可交易股票的问题；默认逐股独立100万元账户，不同实验结果不能当生产2万元账户收益。DCA旧路径因茅台一手超过1万元固定投入而零成交，逐股后有431笔。
- [x] 原样本基础成本0.03%/最低5元/5bps与压力0.06%/最低10元/15bps共1224次；没有重新调参。网格高频仍有负权益窗，DCA100%片段胜率不包含27个期末持仓实验的未实现损失，不承诺未来成功率。
- [x] 新`scripts/research-fixed-strategy-history.ts`可复查，纳入TypeScript检查并通过；相同冻结输入重复输出SHA256一致。全部17项有限汇总、限制和下一步写入[研究记录](../research/2026-11-10-fixed-strategy-history-and-cost-review.md)，原响应和完整结果只在忽略runtime，未公开供应商全文或凭据。
- [x] B `380cb93`独立提交部署，UTC20:33核验577文件/三健康/HTTPS/原账户、归档202运行62样本/integrity ok及世代和上一B版575文件/三镜像/私有导出通过；UTC20:39推送恢复并实际核对GitHub。在线覆盖修复见[模块18](2026-11-10-strategy-robustness-symbol-coverage.md)。
