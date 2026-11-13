# Paper订单方向与类型运行时校验执行计划

> 当前聊天内逐项实施，使用executing-plans和KAIROS量化/发布验收技能，不并行修改代码。

**Goal:** 拒绝内部调用的非法订单方向/类型，防止绕过买卖专属风险分支、生成虚假成交或把非法枚举写入主账本。

**Architecture:** 用独立纯函数校验side/type两个运行时枚举。PaperBroker在原幂等返回之后、行情/费用/风控/创建订单之前审计并抛错；RiskEngine独立调用也返回拒绝。合法请求与HTTP已有Zod校验、资金/费用/T+1/限额/幂等行为保持。

**Tech Stack:** TypeScript、Vitest、实际PaperBroker、内存/JSON Store、原发布机制。

## 事实、假设与范围

上一0125源码及唯一89cc7fc回执已全部核验898文件/全部保护/三已测容器保持，实际API3275通过。UTC19:25前只读本地运行真实nextOpenPortfolioResearch：错误side被记为filled/trade，空持仓现金/库存没有对应变化；缺数量/负数量/非法权重仍得到正常研究输出。只有前者是本模块修复范围，离线适配层的完整意图检查另行立项。证据runtime/2026-11-13-research-intent-{hypothesis,probe}.json。

Broker没有枚举运行时检查，RiskEngine的buy/sell专属分支均不处理未知side，未知type沿市场单路径。HTTP入口已用Zod严格枚举，本地类型转换反例不证明有人从线上API提交过，也不归因为历史真实亏损。进一步用两Store验证已有当日锁仓是否会被错误side当卖出；不触发生产调用。

## 文件与步骤

- Create: shared/orderDiscriminators.ts；返回固定code/message或null，不接收/记录任意大原始payload。
- Modify: server/broker/paperBroker.ts、server/risk/riskEngine.ts。
- Test: server/broker/paperBroker.orderDiscriminators.test.ts。
- Modify: scripts/research-{strategy-exits,shared-capital,completed-entry}-history.ts的来源指纹列表显式纳入新共享校验文件；只改来源元数据，不改研究参数或经济结果。
- Update: 本计划、夜间总计划、状态/架构/交易边界文档及决策0126。

- [x] 先写实际两Store反例：side=wrong/undefined/null和type=stop/undefined/null，分别纯现金、当日锁仓；必须抛对应错误、只新增拒绝审计，不创建订单/成交/冻结、不改完整账户/持仓/周期账/风险检查点。JSON重载必须成功且经济记录保持。旧版应失败，保存结果。
- [x] 控制已有pending买单的现金冻结不变、幂等重复先返回已有合法订单且不重复审计、正常市价买入/T+1拒卖/翌日卖出、合法未成交限价及撤销。RiskEngine独立输入也拒绝相同枚举，合法买卖/类型沿原分支。
- [x] 最小实现公共校验：`side !== "buy" && side !== "sell"`返回INVALID_ORDER_SIDE；其次`type !== "market" && type !== "limit"`返回INVALID_ORDER_TYPE。Broker在重复ID返回后调用，`appendAudit("risk", error.code, error.message, {stage:"broker-request-shape"})`后抛Error；不为坏请求伪造合法订单记录。RiskEngine在原暂停检查后/行情检查前调用并return reject，不改变正常拒绝优先级。
- [x] 一次一个Vitest，明确server/node/两worker；目标Broker/risk/共享资金/研究及完整server，再server/app TS/Vite。固定旧216组退出研究重跑两次、独立重建6024笔及逐组结果与旧报告完全一致，不能算新样本外或收益改善。
- [ ] 独立提交推送exit0、HEAD=upstream/干净树；动态完整经济/风险基线、部署、上传归档字节/SHA、三健康/双域可信HTTPS/匿名401、上一89cc7fc源码/三镜像/私有导出拒绝覆盖、实际运行API不可变镜像禁网完整server。随后唯一文档回执核对三已测容器，不递归回执。UTC23:40冻结/00:00截止保持。

## 验收边界

不新增交易权限或数据，不调整策略/预算/退出参数，不重置账户/造单/生产手动执行。坏枚举的审计不包含原始值；合法风控拒绝仍保留原订单记录。完整研究意图校验、行业/相关性组合硬上限和资金流/论坛接入仍未实现，不把本模块当这些工作完成。

## 执行流水

- UTC19:28：38新增旧版32失败/6控制，最小共享校验后38全部通过；八文件321目标通过。JSON重载、经济与完整周期账/风险检查点保持，坏请求无账户/订单事件且只新增固定审计。
- UTC19:33：完整197文件3313后端通过（72.53秒），server/app TS/Vite通过。旧216组退出两次逐字节一致，6024笔独立重建；除codeCommit/workingTreeDirty/sourceSha256三个来源字段外，完整旧报告逐字段相同，新共享源哈希存在且匹配。证据runtime/2026-11-13-order-discriminators-{old,target,server,build,study-verification}.log、-compatibility.json、-exits-{a,b,summary}.json。该批仍是旧控制，不作新样本外或收益改善。
- 同时将89cc7fc的Broker/RiskEngine原源码隔离编译，两Store实证空仓假成交、已有当日300锁仓被错误方向全部卖出；不只是类型推测。初次本地工具使用esbuild同步插件接口不支持，改为异步编译后成功，未改产品迎合工具。结果runtime/2026-11-13-order-discriminators-baseline.json；生产调用0。
- 独立推送/部署及实际新API镜像3313仍待验收；源码没有改变线上正常订单或策略参数。
