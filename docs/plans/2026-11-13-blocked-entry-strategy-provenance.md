# 入场纪律阻塞的已知策略来源

使用 writing-plans、executing-plans、kairos-trade-lifecycle-review 和 kairos-release-verification，在当前聊天依次实施。基线6ea904eed5f08d00e00b51c6664afca6d47de203；前一0127及唯一回执已经全部验收，不重复发布。

**目标：** 已选中策略的候选被持续性、费用或同日回补纪律阻塞时，保留实际策略编号供后续运行审计归因。它是解释信息缺失，不是导致不买的执行错误。

**架构：** 只在server/research/paperTradingPlan.ts现有entryBlockReasons分支增加`strategyKey: candidate.strategyKey`。沿已有executor跳过记录及审计序列化，不新增准入通过标志、不改变路由、数量、预算或任何门槛。旧记录缺失来源仍未知，禁止猜测回填。

**技术：** TypeScript、Vitest、真实计划构建器/模拟执行器/内存账本，现有独立发布工具。

## 反例与边界

11月13日239轮盘中记录的11轮入场纪律阻塞没有策略编号，虽然此分支之前已选中candidate.strategyKey。0118已经保留失败数值，本项不重复。新编号可能使审计签名一次变化，这是正确反映来源；不得承诺审计签名不变。只有filled决策参与策略使用统计，blocked仍不计数。

## 文件与执行步骤

- [x] 在server/research/paperTradingPlan.test.ts为原持续性、费用和同日回补案例检查真实snapshot-candidate来源，并增加两种验证策略被同日回补纪律阻塞的用例；无路由来源控制不能伪造编号。验证策略在定量时已要求费用效率，不能用低于最低有效金额的夹具假称走到了费用阻塞分支。
- [x] 新建server/trading/paperAutoExecutor.entryProvenance.test.ts，用真实计划、执行器和本地账本验证新来源进入skippedOperations及持久审计skippedReasons、未生成订单且资金/持仓保持；移除来源模拟旧记录时保持null。只mock外部研究报告入口，不mock跳过/审计或成交。
- [x] 旧版本运行相关测试，保存真实失败及合法控制：`node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/paperTradingPlan.test.ts server/trading/paperAutoExecutor.entryProvenance.test.ts --maxWorkers=2 --minWorkers=1`。
- [x] 实施唯一产品改动：

```typescript
strategy: "隔夜持续性与费用纪律",
strategyKey: candidate.strategyKey,
quantity: 0,
```

- [x] 相关计划、executor及策略使用统计用例通过；完整server一次只跑一个Vitest，显式server/node且最多两worker；server/app TypeScript及Vite通过。前端/桥接无修改继承原验收。
- [x] 用固定参数矩阵在旧/新实际构建器比较完整计划：仅入场纪律blocked的strategyKey允许新增；移除此字段后逐字节一致，执行动作/金额/门槛不变。生产调用0。
- [x] 新建docs/decisions/0128-blocked-entry-strategy-provenance.md，更新当前状态及总计划；独立提交、推送exit0且HEAD=upstream/干净树后部署，记录实际上传文件数与SHA/哈希、三健康、双域可信HTTPS/匿名401、动态完整经济/风险及上一版本材料。
- [x] 实际运行API不可变镜像禁网且无生产账户挂载跑完整server。
- [ ] 当前提交为唯一文档回执，发布后核对三已测容器严格保持；最终结果只写runtime/2026-11-13-entry-provenance-receipt-summary.json及handoff，不为勾选本项再作递归提交。

截止UTC2026-11-13 23:40停止新复杂代码及全部发布，UTC11月14日00:00只读收尾。保留零固定预留、费用、整手、T+1、硬限额；不手动触发生产研究/执行，不造单，不新增资金流/论坛来源或真实券商权限。

## 验证记录

- UTC20:55：修正首轮测试夹具mock来源/空limit及验证策略提前定量阻塞后，有效旧版7失败/24控制，所有失败均为实际阻塞来源缺失；legacy未知控制保持。证据runtime/2026-11-13-entry-provenance-old-valid.log，首轮无效夹具不计作产品缺陷证据。
- UTC20:58：相关69项、本地完整199文件3393项通过（71.21秒）；TS发现新测试漏填必需targetDailyOrders，补齐后真实执行器3项及server/app TS/Vite通过。1152组矩阵中288条新增来源，除此完整计划逐字节保持，生产调用0。证据同前缀-target/server/build-final.log及-compatibility.json；无策略或经济改善结论，待独立发布与实际镜像验收。
- UTC21:04至21:09：源码4b64e9f成功推送及部署exit0，908实际上传文件与字节/哈希/SHA、三健康、六次双域可信HTTPS及匿名401、动态完整经济/风险和上一6ea904e源码/三镜像/私有导出与覆盖拒绝通过。实际运行API不可变镜像禁网199文件3393项通过（100.96秒），桥接容器/镜像和网页镜像保持。原GitHub两路径超时后，当前公开DNS的20.205.243.166匿名Git接收端401可达，临时可信SSH SOCKS加正常SNI/schannel证书校验推送成功；无永久代理、TLS或凭据配置变化。证据runtime/2026-11-13-entry-provenance-release-{summary,production-server}.json/log。本提交仅一次文档回执，部署后检查三已测容器严格保持，不递归。
