# 完成日线价格结构观察展示执行计划

> 当前聊天使用writing-plans、executing-plans和kairos-signal-evidence-research逐项实施总计划H；单模块顺序执行，无代理并行修改。

**Goal:** 将已有完成日线结构展示为可核查的突破和回撤观察，缺失、坏证据和旧响应明确未知，不增加请求或改变交易规则。

**Architecture:** 仅前端消费既有historicalEntryStructure，网络字段以unknown接收并在独立展示组件校验。复用MarketRegimePanel既有query与缓存；两个独立观察分别判定，保留历史asOf，不用报告生成或浏览器时间刷新它。

**Tech Stack:** React、TypeScript、现有Vitest/jsdom、原Docker发布验证。

## 预登记事实与规则

- 起点f7a7b8b22f23dd3c0fd7a18b96a0e353aed0a370已上线，本轮新鲜完整经济/风险及三容器核验保持；无在途测试/发布。UTC23:40冻结、11月14日00:00截止不变。
- 服务端已计算至少61根完成前复权日线的结构。股票代码、最近交易日、有效根数与外层股票一致；scope/source/qfq/status/validation须符合既有合同。最近日收盘北京时间15:00不晚于结构asOf，结构asOf不晚于报告generatedAt。旧缓存可以保持早于报告的asOf。
- 突破观察独立使用前20根高点、该高点日期、最近最高/收盘及布尔一致性。close>priorHigh20为“突破待持续确认”；否则high>priorHigh20为“冲高未站稳”；相等不算越过；其余“未越过前20日高点”。所有价格正且有限，close<=high，高点日期严格早于最近日。该观察不要求成交量确认，也不暗示盈利。
- 回撤观察独立核验anchorDate<lowDate<latestDate、前锚高/低/收盘和前日高、派生回撤/恢复比例及布尔一致性。正回撤、低点量比0<ratio<1、之后恢复且close>previousDayHigh同时成立才显示“回撤后恢复线索”；否则“回撤恢复条件未齐”。零/缺失量比显示“低点量比未知”，不得替代为缩量或零流入。缺字段或矛盾为该项未知，不吞掉另一完整项。
- 保留最新完成日、原始来源、原asOf并注明北京时间。观察不是主力意图、实时盘中信号、胜率或订单许可；没有新增逐股资金流/论坛源。

## Task 1：展示边界与反例

文件：新增src/components/CompletedPriceStructure.tsx和对应.test.tsx；修改src/lib/tradingApi.ts、src/components/MarketRegimePanel.tsx及src/styles/index.css；新增该面板.interaction.test.tsx。详情限定宽度并换行，既有横滚表格可聚焦操作。

- [x] 先写组件反例：突破、盘中越过未站稳、等于边界、回撤恢复、未恢复/缺量、旧响应、坏数、错股、日期与asOf越界、损坏/重复、独立项缺失、输入不变及无交易控件。运行缺组件失败，记录为新增能力缺失，不能宣称生产缺陷。
- [x] 网络字段声明`historicalEntryStructure?: unknown`；组件通过`typeof`/有限数/日期/一致性检查，只展示已验证事实。
- [x] 组件在形态表“依据/反证”单元格内引用，无新表列、请求、轮询或服务端修改。折叠详情显示两个观察各自的证据和来源时间。
- [x] 面板实际交互验证原`fetchMarketRegimeResearch(10,8,180,signal)`仅调用一次；切换/展开不请求，卸载未完成请求仍abort。旧响应未知。

## Task 2：验证和文档

- [x] 单Vitest目标与完整src，显式`--dir src --environment jsdom --maxWorkers=2 --minWorkers=1`；server/app TS与Vite构建。仅前端新增optional unknown字段，不修改服务端/共享运行合同；既有3213 server、308桥接、41归档无改继承，不冒充本轮重跑。
- [x] 隔离浏览器固定本地已完成数据验证桌面/移动可访问折叠、未知及无横向页面溢出；不得手动调用生产研究/计划接口或录入凭据。
- [x] 新增决策0122、更新产品/状态和总计划，分清当前功能与资金流/论坛/策略验证缺口。

## Task 3：逐模块发布

- [x] 捕获新鲜完整经济/风险与三容器基线；独立提交、成功推送、HEAD=upstream/干净树后使用现有helper发布。
- [x] 核验实际上传文件哈希/SHA、三健康、可信双域HTTPS/匿名401、完整经济/风险、上一f7a7b8b源码/三镜像/私有导出/覆盖拒绝；API/桥接未改须严格保持容器镜像，网页使用新镜像。
- [x] 形成唯一文档回执，回执发布与三个已验容器保持的最终结果仅写runtime/2026-11-13-price-observation-receipt-summary.json及handoff；不递归回执，随后接续E/I/H。

## 流水

- UTC17:32复核后登记。用户再次允许下载；既有Playwright、Jupyter及Context7已有实际验收，未重复安装。当前会话原生Context7工具仍未暴露；配置与实际匿名读取不能当作已热加载。
- UTC17:46前本地验收通过：新增49项（46组件/3面板交互）、完整67文件509前端、server/app TypeScript及Vite；18组隔离Chrome和48组真实服务端结构兼容通过。没有服务端/Python/归档源码变化，原3213/308/41及实际API镜像验证继承。经济及风险基线新鲜保存release-before.json，尚待推送发布。
- UTC17:47直接推送低速失败，临时可信SSH SOCKS远端DNS与正常TLS推送恢复；58e64ca6026f220314f35c47159c131cd9b8dcb7推送/部署均exit0。UTC17:50全部验收：889实际归档文件/哈希、三健康、双域六次可信HTTPS/匿名401、完整经济/风险保持、上一f7a7b8b源码/三镜像及私有导出拒绝覆盖通过，API/桥接容器镜像严格保持。实际网页新产物MarketRegimePanel-CIdiN_fd.js内四标签存在且公网可信HTTPS字节与容器完全一致，SHA5d68a359bd64a64a93421f914a55d3fee451951f2f7a87df9025f6106249c338。源码验收证据runtime/2026-11-13-price-observation-release-summary.json和-production-web.json；本次只做一次文档回执，最终结果不再递归提交。
