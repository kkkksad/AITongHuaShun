# 原生下一开盘研究意图合同执行计划

> 当前聊天用 writing-plans、executing-plans、kairos-quant-validation 和 kairos-release-verification 逐项执行；不并行修改代码。前一0126源码及唯一a954ee2回执已全部验收，不能重复回执。

**Goal:** 非法子策略意图不能被静默丢弃、过滤或仅记Broker拒单后形成正常研究报告。

**Architecture:** 仅在离线runNextOpenPortfolioResearch的完成收盘回调边界复制并校验完整一批信号，全部有效后才进入pending；失败沿现有failures汇总使整个研究抛错。保持BacktestEngine、线上计划、Broker和所有策略参数。

**Tech Stack:** TypeScript、Vitest、真实BacktestEngine/PaperBroker、现有固定历史脚本和发布工具。

## 基线与合同

基线a954ee2。UTC19:53预先登记假设并在真实离线适配器复现14种坏方向/数量/权重×首根/不可执行下一开盘/尾根，共42组全部正常完成；9组合法零值、权重回退、数量优先、非整手及正常风控拒绝保存完整输出。证据runtime/2026-11-13-native-intent-{hypothesis,baseline}.json；生产调用0。0126已阻止坏方向假成交，但不能替代研究整体失败；没有当前真实六笔订单由本缺陷造成的证据。

shared/backtest.ts声明targetWeight范围0至1。BacktestEngine现有quantity=0时按正targetWeight定量，有限零值和低于整手本来就是合法无成交，不能照搬退出包装器的严格正值合同。quantity优先时，存在的另一个字段仍须满足其类型与范围。没有指定任何定量字段属于非法意图；合法无信号应返回空数组。

## 文件与步骤

- Create: server/research/nextOpenPortfolioResearch.intentContract.test.ts，使用真实适配器/引擎/风控，不mock成交结果。
- Modify: server/research/nextOpenPortfolioResearch.ts，仅增加局部复制校验函数、替换原数组/身份/type检查及重复spread；不导出新API。
- Create: docs/decisions/0127-native-next-open-research-intent-contract.md。
- Update: 本计划、夜间总计划、当前状态和架构离线研究说明。

- [x] 先写坏意图参数化用例：缺定量、坏/缺/null方向，负/NaN/无限/null/文本数量，负/超1/NaN/无限/null/文本权重；首根、尾根和下一开盘不可成交都必须研究抛错。另测稀疏数组、非数组、空元素、错股和非market，验证整批先校验再接纳。示例：

```typescript
expect(() => runNextOpenPortfolioResearch(daily,
  new Map([[symbol, { name: "bad", onBar: () =>
    [{ symbol, side: "buy", type: "market", quantity: NaN }] }]]), costs, asOf))
  .toThrow(/异常|越界/);
```

- [x] 运行新文件保存旧版失败及合法控制结果：`node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/nextOpenPortfolioResearch.intentContract.test.ts --maxWorkers=2 --minWorkers=1`。控制验证空数组、显式零值/负零、quantity=0与正权重回退、有限非整手、正数量优先、上限/T+1正常拒绝，以及原始返回对象不被改写。
- [x] 最小复制校验。函数只接收unknown、返回新对象数组；Array.from逐项遍历防稀疏数组被some/map跳过，在副本上核对本股market、buy/sell、显式数量有限且>=0、显式权重有限且0<=x<=1、至少一个定量字段。任何一项失败在push pending前抛固定错误，不把原始payload放错误中。核心实现：

```typescript
function copyChildSignals(raw: unknown, symbol: string): StrategySignal[] {
  const error = "逐股研究仅接受本股市价及有效方向和定量意图";
  if (!Array.isArray(raw)) throw Error(error);
  return Array.from(raw, item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Error(error);
    const signal = { ...item } as StrategySignal;
    if (signal.symbol !== symbol || signal.type !== "market" ||
      (signal.side !== "buy" && signal.side !== "sell") ||
      (signal.quantity !== undefined && (!Number.isFinite(signal.quantity) || signal.quantity < 0)) ||
      (signal.targetWeight !== undefined && (!Number.isFinite(signal.targetWeight) || signal.targetWeight < 0 || signal.targetWeight > 1)) ||
      (signal.quantity === undefined && signal.targetWeight === undefined)) throw Error(error);
    return signal;
  });
}
```

- [x] 新用例通过，再相关nextOpen/退出研究/完整server，server/app TS及Vite。一次仅一个Vitest，明确server/node、最多两worker。
- [x] 用新脚本只比较原9组合法完整输出，不覆盖旧基线；42组坏意图现在全部失败。原216组退出研究运行两次并比较完整结果（除来源元数据）和独立6024逐笔重建；仍是旧控制而非新样本外，不按收益选择校验。
- [x] 更新决策/架构/状态/流水；独立提交推送exit0且HEAD=upstream/干净树才发布。新鲜完整经济/风险摘要、实际归档字节/哈希/SHA、三健康/双域可信HTTPS/匿名401、上一a954ee2源码/三镜像及私有导出拒绝覆盖；实际运行API不可变镜像禁网完整server。
- [x] 唯一文档回执发布后核对三已测容器严格保持，不递归。UTC23:40停止新复杂代码与所有新发布，UTC11月14日00:00截止不变。

## 边界

不改线上资格、预算、费用、T+1、止损、持仓或数据源；不造单/手动触发生产研究。不能把修复报错方式当策略胜率或收益改善。退出包装器的独立正值合同和普通BacktestEngine容错政策保持；行业组合硬限额、逐股资金流/论坛仍另行验收。

## 执行流水

- UTC19:59：75项新用例旧版54失败/21控制；最小复制校验后新75及原31下一开盘/69退出合计175通过。整个非法批次不进入pending，尾根/不可执行下一开盘也不会隐藏合同错误，合法T+1/上限拒绝及零值保持。
- UTC20:02：完整198文件3388后端通过（71.69秒），server/app TS/Vite通过。42坏意图全失败、原9合法完整输出相同。原216组退出两次逐字节一致/6024成交独立重建；除codeCommit/workingTreeDirty/sourceSha256外，完整旧报告相同，适配器哈希匹配。证据runtime/2026-11-13-native-intent-{old,target,server,build,study}.log及-compatibility.json/-exits-{a,b,summary}.json；没有新增收益或样本外结论。
- UTC20:10至20:14：源码32a7ad0推送及部署exit0，905实际上传文件、三健康、六次双域可信HTTPS/匿名401、动态完整经济和风险摘要、上一a954ee2源码/三镜像/私有导出及覆盖拒绝通过。实际运行API按不可变镜像ID禁网、无生产账户或凭据挂载完整198文件3388通过（101.09秒）；桥接容器/镜像和网页镜像保持，网页容器按发布流程刷新。证据runtime/2026-11-13-native-intent-release-{summary,production-server}.json/log。本次仅此一次文档回执，随后核对三已测容器严格保持，不递归；没有策略、资金或线上权限变化。前端509/桥接308/归档41无改继承。
