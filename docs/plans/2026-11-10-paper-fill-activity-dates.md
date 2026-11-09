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
- [x] `a2de5931e384715a76a72770ca94012fb48ac7de`已独立提交部署、UTC18:59核验558文件/三健康/可信HTTPS/健康200与匿名401、原20000元账户/检查点及归档世代保持，195运行摘要/43账户样本/integrity ok。上一留存轮换为B版554文件，身份/三镜像和不覆盖私有导出均通过。GitHub直连/既有临时通道曾连接重置，UTC19:02正常推送成功，同分支同步。

## B：周度成交日与FIFO时间序

文件：`server/research/weeklyPaperReview.ts`、新增`server/research/weeklyPaperReview.fillTime.test.ts`，复用A解析函数及已有周度测试。

- [x] 周度12项新业务案例在旧实现全部失败，包含成交次序与委托相反时利润方向变化、跨周卖出、时区边界、未知证据和未来成交；原有8项经济断言保持，改后20项通过。
- [x] 周度submitted/rejected/pending/cancelled仍使用提交日，filled与每日成交/费用/策略分布/成交天数使用成交日；活动日期采用并集，没有本周新委托但有历史挂单成交仍有活动证据。
- [x] FIFO按真实成交时刻排序，卖出闭合归属成交日；不以未来买入配早先卖出，未匹配卖出数量明确提示。页面明确FIFO片段单位、净盈亏及与完整周期不同，新增展示报告解释。
- [x] 保留成交时间坏记录或同股同毫秒顺序不明时，相关股票不参与FIFO、其他股票继续；成交金额仍按确认日期。实际成交时间上限取报告now与周期末较早者，避免未来成交入样。
- [x] 完整126服务端文件1965项通过；最终周度目标20项、前端复盘静态/交互8项及TS/Vite通过。前端完整343项沿用A，本轮只做受影响页面目标验证。决策0034与产品说明同步。
- [x] `d71a2545b0cb67e13a1c41830b8f6a474e4cfaa2`独立提交部署，UTC19:10核验559文件/三健康/健康200与匿名401、可信HTTPS和原账户/检查点保持。归档196运行摘要/46样本/integrity ok、世代不变，上一A版558文件/三镜像/导出完整性通过。
- [x] B/C的GitHub推送曾因直连443不可达/重置、既有临时通道重置失败；UTC19:29正常推送成功，原origin同分支同步至C，无改写历史。

## C：执行活跃目标日期与真实配置说明

文件：`server/trading/paperAutoExecutor.ts`、已有`paperAutoExecutor.executionTime.test.ts`；`server/research/dailyMarketReview.ts`及测试；`server/app.ts`与新增`server/app.dailyReviewPolicy.test.ts`。

- [x] 新增8项Executor、2项复盘和1项HTTP回归，旧版10失败/1通过；覆盖跨日、坏时间、同日未来、旧字段、北京时间零点、手动/未成交排除及日硬上限。
- [x] countFilledOrders接受明确asOf参数，getStatus传now、研究探针入口传started，复用getOrderFillTime按实际日期和不晚于asOf计数。countSubmittedOrders完全保持现状。

```ts
const time = getOrderFillTime(order);
return order.clientOrderId?.startsWith("kairos-auto-paper:") === true &&
  time !== null && Date.parse(time) <= asOf.getTime() &&
  getChinaDateKey(new Date(time)) === tradingDate;
```

- [x] 真实Executor/Broker夹具同时提供历史委托当日成交及当日4笔提交已满，目标仍缺1但不调用Broker下单，保留日硬上限原因。
- [x] 日复盘新增maxAutoOrdersPerRun输入，HTTP透传当前配置；三单/七单真实注入接口先失败再通过，纯函数缺输入为2/4。生产只读核对实际2/10、目标6、60秒、validation-probe、零比例预留及真实执行关闭。
- [x] 单笔资金不足拒单不再被推断为必然重复预算，修正逐笔原因和问题项；去掉开发固定端口建议，按网站/API/桥接描述。
- [x] 完整127服务端文件1976项、目标三文件58项及TS/Vite通过，专题决策/产品说明同步。C无前端/共享字段变更，沿用A完整343项及B最后页面8项，不重复声称新跑。
- [x] C `856c551f1ef871c05d50515445fa6a2e0a98cbfa`独立提交部署，UTC19:22核验560文件/三健康/可信HTTPS/健康200与匿名401，原20000元账户、零持仓订单、检查点及归档世代保持。归档197运行/48样本/integrity ok，上一B版559文件独立匹配、三镜像及私有导出通过；B/C的GitHub同步仍因网络故障重试中。

## D：周度成交金额与费用证据

文件：`server/research/weeklyPaperReview.ts`、新建`server/research/weeklyPaperReview.executionEvidence.test.ts`及权威产品说明/决策。

- [x] 最初20项中旧版18失败/2通过；已成交但缺/坏实际价格、数量、金额或费用不能回退委托值或默认零费用生成FIFO净利润，已确认日期的成交笔数保留。
- [x] 实际数量为正安全整数、实际价格/金额为正有限数、费用为非负有限数，金额与实际量价误差不超过一分。完整记录才进入金额/费用统计；不完整记录所属股票整段保留历史不参与FIFO，避免跳过坏买单后错误配对。FIFO本金采用实际金额/成交量分配，兼容一分舍入仍保留真实现金差。

```ts
const complete = Number.isSafeInteger(order.filledQuantity) && order.filledQuantity > 0 &&
  Number.isFinite(order.filledPrice) && order.filledPrice! > 0 &&
  Number.isFinite(order.notional) && order.notional > 0 &&
  Number.isFinite(order.commission) && order.commission >= 0 &&
  Math.abs(order.notional - order.filledQuantity * order.filledPrice!) <= 0.010000001;
```

- [x] 本期有缺执行字段时，报告明确金额/费用为完整记录的部分统计，均单金额仅平均完整记录；保留真实成交笔数和日期，不把部分金额当零成交或完整资金部署证据。其他完整股票独立计算；追加不误判资金部署/计划未落地案例，共21项。
- [x] 目标三文件41项通过，保留原20项断言；完整128服务端文件1997项、TS/Vite和diff检查通过。无前端或共享字段变化，前端完整343项及页面8项沿用A/B。
- [x] D `5112c11cad5da724e4a4d88e6c55edeeb2ccff6b`正常推送并独立部署，UTC19:33核验561文件/三健康/可信HTTPS/200与401、原20000元账户/检查点保持，归档198运行/50样本/integrity ok及世代保持；上一C版560文件/三镜像/私有导出通过。本期不存在生产订单，不声称发生实际盈亏错误。

## E：订单策略归因在审计裁剪后仍可读取

文件：`server/research/weeklyPaperReview.ts`、新建`weeklyPaperReview.strategyProvenance.test.ts`；`dailyMarketReview.ts`及现有测试，产品说明和0034。

- [x] 最初12项新周/日案例旧版8失败/4通过；最终扩为15项，覆盖无审计、冲突、部分字段、旧字段、clientOrderId回退、不同未知名称分组、跨周入场归因和同键名称补齐。日策略优先订单名称、其次订单键、最后审计，缺理由仍明确历史回退。
- [x] 周度优先订单策略键/名称；订单键存在但无名称时，仅审计键相同才补名称；只有名称时仅审计名称相同才补键，否则以unattributed:名称独立分组，不混合不同未知键策略。旧单保留审计/ruleChecks兼容。

```ts
const key = nonempty(order.strategyKey);
const name = nonempty(order.strategy);
if (key) return { strategyKey: key, strategyName: name ?? (audit.strategyKey === key ? audit.strategyName : null) };
if (name) return { strategyKey: audit.strategyName === name ? audit.strategyKey : null, strategyName: name };
return audit;
```

- [x] 不将当前选择策略回填旧单，不以归因补造交易理由/规则；FIFO收益归对应买入策略，成交分布归每笔自身策略。追加未知名称分组测试最初仅因断言了无关中文排序失败，改为精确集合、保留每组笔数/分离断言，最终通过。
- [x] 最终五文件81项、完整129服务端文件2012项与TS/Vite通过。无前端/共享结构变化，前端343项及页面8项沿用A/B。
- [x] E `246ebf5da92cb33031e246a6ae9294f574c5ea25`独立提交部署并正常推送，UTC19:49核验565文件/三健康/可信HTTPS/200与401、原20000元账户/检查点保持；归档199运行/54样本/integrity ok及世代保持，上一C1版564文件/三镜像/私有导出通过。直连失败后既有临时通道推送成功。

## 执行记录

当前已确认三个只读入口仍使用createdAt归属成交；日收益重建已采用filledAt/updatedAt，本模块不重写其资金算法。生产当前零订单，不据此断言曾实际漏记成交；修复依靠受控订单案例。

A最终目标三文件70项通过（通知37、日复盘23、时间解析10）。新增内容是只读统计与显示，不改变执行器以clientOrderId日期前缀计算的提交硬上限；执行器成交目标日期口径仍是独立后续项。

B先20项通过后运行完整服务端检查；同毫秒歧义按整股历史保守排除，会减少可核验FIFO样本，不制造并不存在的成交先后。未来若增加不可变成交序列，可另行解除这一缺证据限制，当前不迁移订单格式。

新增展示性能说明后，旧前端重试测试把经济说明中的“胜率暂不可用”误认为API失败，初次8项中1失败。改为明确断言“上周 Paper 复盘暂不可用”请求错误消失，保留取回金额/调用次数和缓存失败断言；最终8项通过。首次并行两个Vitest进程曾有HMR端口占用提示，最终分开运行通过，不修改服务或跳过测试。

后续独立排查：执行器成交目标仍按委托ID日期；日复盘建议仍有历史固定单轮/每日笔数文案；周度价格/数量兼容回退是否会使缺成交字段记录进入盈亏尚未验证，应以缺证据夹具复现后再决定，不能宣称已发生生产损益错误。

上项前两条已由C修复、完整1976项和发布核验通过；D已由20项夹具复现旧版18失败并修复，扩为21项/完整1997项通过待发布。UTC19:29 B/C恢复正常推送；C核验时归档197运行/48样本，未改资金或触发生产策略执行。
