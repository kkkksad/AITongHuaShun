# 逐股历史身份的长期归档计划

> 使用writing-plans制定，以executing-plans接续；已实施，验证/发布流水见下。

**Goal:** 让0107新增的有限逐股身份沿现有同机SQLite观察副本和认证七日摘要保留，避免交易主账本裁剪后再次无法复盘。

**Architecture:** 只扩展现有execution_runs.details_json的白名单，不新增数据库、端口、执行权限、表迁移或采集频率。现有90天运行保留、最多20000行七日聚合/20条最近运行和128KiB模型边界保持。旧记录与非法可选证据为未知，不能回填；采集器继续只读原主账本。

**Tech Stack:** Python标准库/sqlite3、共享TypeScript类型、现有Zod读取入口和Vitest。Python改动须单独Linux验收。

## 已知缺口与文件

- scripts/paper_history.py的_run目前仅保存researchDiagnostics数量和issues；scripts/paper_history_read_model.py的safe_run仅投影issues。源码已确认丢字段，先用新式合法源运行构造离线SQLite往返反例，不手改生产账本或触发策略。
- 新建shared/stockHistoryCoverage.ts承接0107接口，server/research/stockHistoryCoverage.ts仅迁移类型导入/再导出，纯校验与运行行为保持；shared/paperHistory.ts增加可选最近运行身份。
- scripts/paper_history_contract.py增加独立safe_stock_history_coverage：与0107相同scope、UTC毫秒时间、每组≤12唯一六位代码、顺序与四层子集；丢弃额外字段。只有counts一致且asOf≤原运行审计时间才保留。非法可选字段不破坏原运行/账户采集，不能用当前时刻补齐asOf。
- scripts/paper_history.py仅将经验证的身份写入原诊断JSON；paper_history_read_model.py对历史JSON再次校验投影，跨世代和未来运行的原隔离保持。
- server/research/paperHistoryArchive.ts沿原受保护读取接受可选身份并再次白名单校验，晚于occurredAt的可选证据省略而非让整个历史模型失效。不得提供任意SQL或原始账本/响应下载。
- 在scripts/test_paper_history_read_model.py复用真实采集/SQLite往返夹具，同时覆盖采集与模型，scripts/test_paper_history.py原全套保持；扩展server/research/paperHistoryArchive.test.ts、app.paperHistory.test.ts。至少验证真实离线SQLite往返、旧/坏/未来可选证据、额外字段、复制、20行/128KiB和账户世代边界；必要时共享有界合同夹具核对Python/TS语义。
- 更新0108决策、operations/paper-history、system-overview、安全边界、current-state与总流水。0107“本项未扩展长期归档”为历史范围说明，不抹去当时事实，追加0108链接。

## 顺序与验收

- [x] 先写合法新源运行→SQLite→七日只读模型的失败测试，证明身份被丢失；原资金、订单、运行数量和去重保持。旧字段缺失不得被填成零选择。
- [x] 实施最小白名单保存/再验证与共享可选合同；包含坏时间、13股、重复/乱序/外部身份、accepted/usable数量不符、asOf晚于运行时间和未知额外字段控制。非法可选字段仅省略，正常运行摘要继续可读。
- [x] 一次一个Vitest运行相关server目标与共享契约所需完整server/src、TS/Vite；Python本地全套和Linux隔离全套，不能只用Windows通过代替Linux。复核新元数据未进入风险/订单或策略路由，无需重复无关固定策略研究。
- [x] 独立提交推送部署，实际生产API镜像隔离相应全套；检查归档timer健康/最近成功、七日模型大小及已有DB状态，原主账本账户经济/风险保护保持。不启动生产策略、不发送测试通知、不以人工注入身份当自然采样。
- [x] 全部发布保护及上一材料核验、文档回执和已测三容器保持；记录线上旧数据仍缺身份，后续自然运行才新增身份。然后检查现有复盘显示是否能解释选择/返回数量，再决定下一模块。

UTC20:22登记，前置485a00c已通过824归档文件/全部保护及实际生产3069后端。先完成前模块文档回执/已测三容器核验，才开始本项代码。UTC23:40停止复杂代码与新发布，UTC00:00截止；同一heartbeat保持ACTIVE，不把本计划当已实现。

UTC20:30：7855ac0前模块回执825文件及全部保护/已测三容器保持于UTC20:24核验，本次先核对UTC/git/upstream/动态生产摘要保持后接续。新增Python旧版1失败/非法可选兼容通过、Node旧版2失败/原33通过；最小白名单保存/再投影及共享类型已实施，目标67通过，Python本地41（2项POSIX跳过）与Ubuntu Linux全部41通过。隔离复制原主账本采集/七日投影/备份/quick_check通过，原文件字节保持；源747轮/七日692只是当时私有副本的数量，不是有身份的运行数。初版Zod未显式optional导致27旧控制失败，修复后原行为和新控制保持。完整server在途，未发布；不重复无关固定策略研究，Python桥接177无改继承。

UTC20:35本地验证完成：13新增后端包含在完整188文件3082项，63文件439前端、TS/Vite通过；Python新增5项，本机41（跳过2项POSIX）及Ubuntu Linux41全通过。现有归档服务预检success/exit0、quick_check=ok、90天计数与分钟更新正常；准备源码提交推送部署及实际API镜像/已发布Python全套，生产验收尚未完成。证据runtime/2026-11-12-history-archive-{target,server-full,web-full,python-full,linux,ts,vite}.log及service-before.json。没有修改交易/风险/费用源码，无需重复固定策略回测。

UTC20:40验收：1651118a97d3f36bf370b94005a9efed7392bc36已推送部署，827归档文件/实际字节哈希、三健康、可信双域HTTPS/匿名401、动态经济与完整风险摘要、上一7855ac0源码/三镜像和私有导出全部通过。实际生产API镜像禁网隔离188文件3082后端通过（97.79秒）；已发布/opt脚本Linux41全通过，无生产策略或测试通知。

归档timer自然在UTC20:38:01成功更新，数据库quick_check=ok、模型11787字节/20最近轮，新增可选字段确已出现在自然投影；20轮均身份未知，不是0只选股或新覆盖证明。原账本在只读检查期间字节保持，认证边界外匿名401、实际容器只读模型ready/世代隐藏、仅模型目录只读挂载而无SQLite/备份目录通过。runtime/2026-11-12-history-archive-{release-summary,service-after}.json、endpoint.txt、production-{server,python}.log为证据。先文档回执并核对已测三容器保持，再接续[覆盖显示计划](2026-11-12-stock-history-coverage-display.md)；旧11月12日身份仍未知。
