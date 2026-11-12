# 相关风险研究的收益区间对齐

> 使用writing-plans制定，executing-plans在当前隔离工作树逐项执行。

**Goal:** 修复缺日历史把不同持有区间收益混算、无关第三只股票改变两股相关性的缺陷；为银行集中风险提供可复现诊断。

**Architecture:** 新建只读纯函数server/research/historicalCorrelation.ts，复用完整日线/asOf/qfq/身份校验。每对股票只匹配相同起止日期的收盘收益，按日期取最近120个有效区间。固定至少60个区间才给Pearson值；不足和零方差分别返回null及明确状态。已知坏/重复日期不能通过删除后跨接增加样本，零量端点排除。没有交易日历，不把跨周末/节假日或双方共同缺日的区间保证为单个交易日；报告区间范围与最大日历跨度。

**Files:** 新增上述函数及server/research/historicalCorrelation.test.ts；scripts/research-adaptive-coverage-history.ts调用该函数并记录源哈希；server/operations/adaptiveCoverageHistory.test.ts验证完整业务入口。更新0096决策、研究报告、状态及总计划。

## 执行与验收

- [x] 先在现有researchAdaptiveCoverage入口加入业务反例。构造80根序列，第二只缺第40根：原版按结束日给78个混合区间，应只得77；加入仅有后70根的第三只，原两只79样本被降到70。旧版两项失败/原五项通过，日志runtime/2026-11-12-correlation-red.log。
- [x] 最小实现buildHistoricalCorrelations(input, asOf)，将实际startDate/endDate同时作为配对键。固定120上限与60最少样本是诊断政策，不能当置信区间或收益调参。覆盖不足、恒价、零量、无效/重复日线、无效时间、asOf盘前/盘后、输入乱序和不变性。
- [x] 冻结12股SHA32fc7da...完整重放新旧对照：66对完整对齐的相关值及4560行条件观察/策略覆盖/成本结果保持；两次新输出逐字节一致。四只银行六对0.614–0.902、当前成本暴露7088元（原始20000的35.44%），不当组合收益或胜率。
- [x] 单个Vitest目标23及完整183文件2815后端通过（114.30秒），TS/Vite顺序通过。前端/Python未改，继承模块1的411前端及此前177桥接/36 Linux归档，不称本模块新跑。当前线上bc67c8f/四仓六单，发布前动态重新捕获经济摘要（含blockedCash）与完整风险检查点。
- [x] 源码提交、推送、部署、逐归档字节/SHA/三健康/双域可信HTTPS/匿名401/动态账户与完整检查点/上一源码三镜像私有导出核验；实际API镜像隔离完整后端验证。
- [x] 回执文档63f68f0独立提交部署，777归档文件/三健康/可信双域HTTPS/匿名401/经济摘要与完整检查点/上一ac135e9材料通过，三容器及已测镜像严格保持。UTC16:36工作树干净，接续下一模块；证据runtime/2026-11-12-night-module2-final.json。

## 当前边界

没有可靠逐股行业字段，本模块不创建行业映射、线上组合限制、强卖或下单能力。收益相关实验仍须独立2万元累计预算和严格时间/成本路径。本冻结数据各500根完整对齐，旧银行相关值未必受缺陷影响；不得因修复宣称旧报告被推翻或收益改善。

UTC16:21起：本地/upstream/实际生产均bc67c8fa80aaf45b7eb84335c2278e89ea8cdfca，工作树干净，无在途测试/发布。旧冻结复跑输出runtime/2026-11-12-correlation-before.json，4560观察、66对，入口校验警告空。

UTC16:30前：两项业务旧失败与23目标通过，完整2815后端/TS/Vite通过。冻结两次输出SHA256=c1f49873a20245451df44e9474a7464699e5df171a745db64c32e9d6deb74181，66对原值和4560行保持，见runtime/2026-11-12-correlation-comparison.json。待独立提交、推送、部署及实际生产镜像验证。之后接续生产20000元累计组合预算/历史信号结构，不能把本模块说成线上相关风险限额已实现。

UTC16:32–16:35：源码ac135e97e72c6a40db9d8570229e4970fec6bf03已推送部署，777归档文件逐字节、三健康、双域系统可信HTTPS与匿名401通过。发布前后动态经济摘要（含blockedCash）及完整风险检查点严格相同，现金12812、四仓六单；上一bc67c8f的772源码/三镜像与私有导出独立验证，exportVerified/overwriteRefused均true。实际生产API镜像sha256:cfe2b713758ecda4b3f05362454e3ef48732b6679d0c5ec2a32019586fb09059禁网、无生产数据/凭据挂载，完整183文件2815后端通过（95.27秒）。材料runtime/2026-11-12-correlation-release-{before,after,verification,summary}.json、correlation-{retained,public-https}.json及production-server-full.log。下一步仅部署此文档回执并核对运行容器/镜像保持，然后接续20000元组合预算与真实信号结构；行业硬限制仍未实现。
