# 低于一元报价的Paper整手定量核查（试改已撤回）

**最终状态：未实施、未提交、未发布。** UTC18:04目标兼容检查发现旧[0042](../decisions/0042-paper-plan-post-cost-sizing.md)及原commissionRounding用例明确要求保留至少1元的保守手数上限。初查把它当计算缺陷不准确；新提出的6个反例只是撤销旧政策后的反事实，不能证明当前实现违反既有合同。所有定量源码和新增postCosts测试已逐项撤回，原低价限制保持。以下保存当时被否决的试改计划，不再执行；任何未来放宽需按独立风险政策研究验证，不能通过更改单测掩盖政策变更。极大数值的搜索收敛性另立边界核查，不依赖移除价格下限。

> 当前聊天按writing-plans、executing-plans、kairos-portfolio-allocation-review和kairos-release-verification实施总计划I中的可复现计算缺陷；不改策略资格或资金比例。

**Goal:** 修正候选定量把有效低于1元报价替换为1元、导致实际费用纪律误拒或少算整手的问题。

**Architecture:** 只改candidateQuantity内的价格分母与合法数量上界。原Broker成本投影、单笔/单股限制、二分整手、候选资格、费用纪律、零固定预留和路由比例保持。通过真实PaperBroker的内存/JSON两Store验证实际可执行性。

**Tech Stack:** TypeScript、Vitest、既有PaperBroker和Docker发布验收。

## 固定问题与范围

- 起点52167083e9dc28f4324790845476ce4df673153c，UTC17:57完整动态经济/风险及三容器复核通过，无在途任务；截止UTC23:40冻结/11月14日00:00不变。
- 原`const price = Math.max(candidate.price, 1)`是已被0042明确保留的保守手数上限。最初未定位旧决策，后续查证推翻“没有此政策”的初判；实际候选/Broker仍按真实报价，不能将保守定量上限混称为篡改成交价。
- 固定2万元现金/权益、单股25%、单笔1250、最低佣金5、100股、零滑点：0.50应为2500股（1250元），0.80应为1500股（1200元），0.95应为1300股（1235元）。下一整手均超单笔。原版前两项因算小后往返最低费用比例超1%而拒，第三项只能1200股。
- 这不解释现有四银行低利用或历史亏损，不能据此放宽任何ST/退市/流动性/趋势准入；不要求买低价股。
- 移除价格下限后须防止极小正数除法溢出或不安全整数导致二分无法收敛。数量必须是有限安全整数整手，超出安全可表达数量范围时保持不可定量，不伪造1元价格或放宽Broker。

## Task 1：反例

文件：server/research/paperTradingPlan.postCosts.test.ts。

- [ ] 对memory/json分别增加0.50/0.80/0.95三个真实计划反例，直接提交拟单至PaperBroker并断言数量/实际本金/5元费用/现金；再提下一整手必须被原单笔风控拒绝。记录旧版失败，不把既有用例算新增缺陷。
- [ ] 增加小于可安全定量范围的正价有界结束控制；只验证无不安全拟买，不声称整个行情接口因此安全。
- [ ] 旧目标`node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/paperTradingPlan.postCosts.test.ts --maxWorkers=2 --minWorkers=1`保存日志。

## Task 2：最小实现与验证

文件：server/research/paperTradingPlan.ts。

- [ ] 使用实际有限正价；先算资金/额度预算除实际价的整手数量，非有限/非安全数量直接0，合法相邻整手再走原fitsBudget。相邻数量也须安全，不改二分判断和Broker经济规则。
- [ ] 目标postCosts/commissionRounding/sizing/affordability及完整server，显式dir/node和最多两worker，一次一个Vitest；server/app TypeScript及Vite。509前端、308桥接、41归档源码未改继承。
- [ ] 既有固定历史结果中相关股票价格均高于1元时，不能声称本项提升收益；不重跑已知216组当新OOS。新缺陷只用确定性真实Broker反例验证。

## Task 3：文档与发布

- [ ] 新增决策0123，更新资金核查、状态和总计划，明确不解决行业集中/分策略退出与比例最优性。
- [ ] 新鲜完整经济/风险/容器基线，独立提交推送exit0、干净HEAD=upstream后原helper发布。
- [ ] 实际上传文件/SHA/哈希、三健康、可信双域HTTPS/匿名401、完整经济/风险、上一5216708源码/三镜像及私有导出拒绝覆盖；网页/桥接未变保持容器镜像。实际新API镜像禁网完整server，无生产账户/凭据挂载。
- [ ] 唯一文档回执后核对三容器保持，最终结果runtime/handoff，不递归回执。

## 流水

- UTC18:00之后发现并登记，尚未修改定量源码；先用真实Broker反例验证。
- UTC18:03新6个反事实旧版失败，试改后该6项通过但原兼容用例失败；查证原0042明确限制后撤回源码和新测试。未部署任何放宽限制的版本，不把这些反事实算作已修生产缺陷。后续单独验证极大资金/不安全数量时的二分收敛边界。
