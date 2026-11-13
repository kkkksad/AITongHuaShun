# Paper整手搜索安全整数边界执行计划

> 当前聊天使用writing-plans、executing-plans、kairos-portfolio-allocation-review和kairos-release-verification执行总计划I的独立可复现计算边界修复；不放宽低价限制或交易比例。

**Goal:** 防止有限但极大的资金/额度生成不安全整手数量后，二分搜索因浮点精度无法推进而阻塞研究及API线程。

**Architecture:** 仅在candidateQuantity计算初始整手后拒绝非安全整数，并在相邻整手检查前验证该数量安全。保留0042的一元保守定量上限、现有成本/单股/单笔/现金/费用检查和搜索算法，超出数量表达边界返回不可定量而非放宽限额。

**Tech Stack:** TypeScript、Vitest、带超时的隔离Node子进程、既有Docker发布流程。

## 已复现的事实

- 起点5216708，生产三健康、完整经济/风险保持，UTC17:57新鲜检查，无在途发布。UTC23:40冻结/11月14日00:00截止不变。
- 初查低价定量被旧决策0042明确保留，试改及6个反事实已全部撤回；原4文件58项恢复通过，见[撤回记录](2026-11-13-subyuan-paper-plan-sizing.md)。不会把失败的反事实当生产缺陷。
- UTC18:06用原源码SHA08439b6fc7cc8f281fd7551040e9506c8a882c4787645435890b1c376a74160c编译真实buildPaperTradingPlan，独立子进程分别限时1500ms；同一合法10元报价、100股、25%单股、commission0.03%/最低5、0滑点、零预留、单笔上限等于本金：20000及1e10分别约112/91ms完成（含进程启动），1e20及1e308均超时后被父进程终止。没有生产调用或账户挂载。
- 原原因：初始数量高于安全整数范围；费用后的权重使初始检查失败，二分在浮点相邻可表示数处可能反复取同一个middle。正常账户没有此数量级，不声称它导致当日不买、亏损或当前页面慢。

## Task 1：有界回归

文件：新增server/research/paperTradingPlan.quantityBoundary.test.ts。

- [x] 通过`spawnSync(process.execPath,['--import=tsx','-e',code],{timeout:5000})`执行真实模块，合法固定报价+极大有限账户1e20/1e308必须在子进程界限内正常返回且无拟买；旧版在相同测试中超时失败。父Vitest线程可继续，避免直接测试旧同步循环导致测试挂死。
- [x] 使用同一子进程方法对20000保持400股、1e10保持249981200股及完整费用控制，证明不是所有大账户都禁用。现有postCosts/commissionRounding/sizing/affordability覆盖正常与低价政策。

## Task 2：最小实现

文件：server/research/paperTradingPlan.ts。

- [x] 在初始roundLot之后添加`if (!Number.isSafeInteger(quantity)) return 0;`；原相邻检查变为`if (Number.isSafeInteger(quantity + lotSize) && fitsBudget(quantity + lotSize)) quantity += lotSize;`。不改原1元floor、比率、允许股池或Broker。
- [x] 目标新边界及原四文件，再完整server，一次一个Vitest，显式`--dir server --environment node --maxWorkers=2 --minWorkers=1`；server/app TypeScript及Vite。509前端/308桥接/41归档未改继承。
- [x] 运行有界新旧正常输入比较，完整计划及输入保持；极大账户只验证无不安全拟买与有界返回，不作为量化收益研究。

## Task 3：文档与逐模块发布

- [x] 决策0123/状态/资金核查/总计划记录根因与范围，保留撤回历史；没有策略胜率或利用率改善结论。
- [x] 新鲜完整经济/风险/容器基线，提交推送exit0/干净HEAD=upstream后原helper发布。
- [x] 上传实际文件哈希/SHA、三健康、双域可信HTTPS/匿名401、完整经济/风险、上一5216708源码/三镜像及私有导出/覆盖拒绝；原网页镜像/桥接保持。实际新API镜像禁网完整server，无生产账户或凭据挂载。
- [ ] 形成唯一文档回执，回执发布/三已测容器复核结果写runtime与handoff，不递归回执。

## 流水

- UTC18:11前本地新增4项旧版2超时失败/2控制；改后目标5文件62项、完整195文件3217后端、server/app TypeScript及Vite通过。144组正常完整输出/输入保持，34种拟买数量组合；极大输入独立进程约80ms返回0拟买，包含启动不作API性能指标。源码仅两处保护，原0042低价上限保持，放宽试改未提交/未发布。源证据runtime/2026-11-13-{plan-safe-quantity-before,plan-safe-quantity-after,plan-safe-quantity-invariance}.json；发布待验。
- UTC18:18至18:22：ea30922a70d623ba0dc7448cf2e05afb65c8f3be经临时可信SSH SOCKS远端DNS推送成功，原helper部署exit0；893实际上传文件逐哈希、三健康、双域六项系统可信HTTPS/匿名401、动态完整经济/完整风险检查点、上一5216708源码889文件/三镜像及私有导出/拒绝覆盖全部通过。桥接容器与镜像严格保持，网页镜像保持，原代理按后端更换正常重建。实际新API镜像禁网且无生产账户/凭据挂载的195文件3217后端通过（99.34秒），镜像tag与运行容器身份匹配。证据runtime/2026-11-13-safe-quantity-release-summary.json、-production-server.log及-production-image.json。本次仅提交一次文档回执；回执发布结果写runtime与handoff，不递归提交。
