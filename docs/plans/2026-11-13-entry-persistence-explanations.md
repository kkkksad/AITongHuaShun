# 隔夜持续性拒绝子条件可解释性执行计划

> 当前聊天内逐项实施；本模块只解释既有拒绝，不改变放行或资金规则。行业数据合同同时只读调查，未接入前保持未知。

**Goal:** 后续自然运行拒绝入场时，能指出具体失败的历史数量、形态置信度、区间或均线条件，解决11月13日11轮只看到unclear总标签无法复盘的问题。

**Architecture:** 将paperTradingPlan内纯assessEntryPersistence原逻辑移入paperEntryPersistence.ts，保持所有allowed/ruleCheck及通过理由；只给已被拒绝的分支追加当前失败子项与原值，进入既有reason/审计/归档展示，不增加数据或交易请求。

**Tech Stack:** TypeScript、Vitest、现有Paper计划/运行审计/SQLite只读归档。

## 文件及步骤

- 修改server/research/paperTradingPlan.ts；新增server/research/paperEntryPersistence.ts及对应测试；补决策0118和复盘/状态/总计划。
- [x] 先通过实际buildPaperTradingPlan用例证明旧拒绝只含总标签，不含历史数量/置信度/20日收益/距MA20/斜率子项；旧允许区间仍可买。
- [x] 以完整原条件建立独立纯评估测试，覆盖缺历史、无需历史、健康趋势、洗盘样本/频率未知及不足、五个区间策略、非区间策略、各边界、多个失败和原对象不变。保留NaN/Infinity显示为非法而不增加新的放行规则。
- [x] 原函数完整搬迁并保留公开行为；只在原blocked末尾追加失败子项，最多六条、仅内部固定标签和数值。历史频率与形态置信度不描述成未来盈利概率。
- [x] 用独立原布尔表达式在15360个确定性边界笛卡尔样本比较allowed，尤其0.55/0.65、120根、20样本、-0.06/0.08、-0.1/0.03与-0.01。无需回测参数搜索，也不以增加交易为验收。
- [x] 单Vitest显式--dir server --environment node、最多两worker；目标后完整后端及TS/Vite，452前端/308桥接无改继承。
- [x] 单独提交推送exit0、部署并完成全部保护和实际生产API镜像禁网验证；一次文档回执后接行业风险模块。历史11轮未保存的旧数值仍为未知，不事后回填。

## 行业风险只读调查

shared/MarketQuote和候选尚无逐股行业身份，现板块快照不含可靠成分映射。先读取实际固定SDKstock_individual_info_em传输合同：需核对返回股票身份、行业分类体系、timeout、观察/来源时间、缓存期限和独立有界容量。当前行业标签不能当历史point-in-time行业，无法核实的新候选不能被当作独立风险。行业硬上限需另设明确预算和待买暴露；不在本解释模块隐式引入，不为分散立即强卖旧仓。

## 流水

- UTC15:02：实际生产/本地/upstream为af44f22，工作树干净，无在途；本轮完整动态经济/风险摘要与三健康保持。11轮原始证据见runtime/2026-11-13-late-blocks.json，不能反推未保留逐股子特征。
- 原实际计划反例1失败/25控制；实现后目标三文件80项通过，新增20纯用例+1集成，完整192文件3158后端及TS/Vite通过。边界对照初版仅误写组合总数（1280断言2560），实际allowed比较全通过；已扩为包含样本/频率/策略的15360组合并通过，不改生产逻辑迎合测试。
- 实际固定SDK行业源码与四股本地有界来源读取完成，工商返回匹配代码与“银行Ⅱ”，其余三股HTTP失败保持未知；详见[来源初查](../research/2026-11-13-industry-source-contract-review.md)。行业硬上限尚未接入。本解释模块准备单独推送部署。
- 原a08d719推送两次因GitHub443连接失败未部署；UTC15:16恢复后推送exit0，再动态基线/部署exit0。UTC15:20前实际上传866文件、三健康、双域六次可信HTTPS/匿名401、动态完整经济及风险摘要、上一af44f22源码/三镜像及导出/拒绝覆盖通过；原桥接容器保持，API更换、web按原机制刷新上游。实际生产API镜像禁网192文件3158项通过（98.53秒）。证据runtime/2026-11-13-persistence-explanation-{verification.log,https.json,retained.json,before.json,after.json,production-server.log}。
- 独立提取原函数文本比较证明除export及原blocked理由追加外全部一致，另有15360边界布尔对照；保存runtime/2026-11-13-persistence-explanation-original-equivalence.json。只做一次文档回执，不递归回执发布。
- 等待镜像测试期间完成[六对固定历史相关性研究](../research/2026-11-13-held-stock-correlation-review.md)，工商/农业60共同收益区间Pearson0.8605，六对独立公式核对通过；这是旧样本的组合风险证据，不是当前实测相关性或交易权限改变。
