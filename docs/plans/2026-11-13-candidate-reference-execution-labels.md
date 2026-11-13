# 候选扫描参考与实际执行规则的显示边界

状态：实施前登记。基线60e9357；UTC23:40禁止所有新发布，UTC11月14日00:00截止。

## 问题与范围

DailyCandidates将paper-buy扫描标签显示为“模拟买入”，摘要为“模拟可买”，仓位及2%止损/5%止盈参考没有说明与实际退出的区别。实际历史资格、费用、资金、持续性和风控后可能无计划；在线持仓共用成本止损及条件减仓，固定止盈未完整接入。因此扫描页的直接动作语言可能使用户误解没有成交或卖出规则。

仅改该页的文案：paper-buy显示“验证候选”，摘要“初步候选”并说明尚需确认；仓位/止盈止损标为研究参考；新增可见说明，指向持仓现有“退出规则”。保留原数值、响应、查询、排序、分页和刷新，无接口或订单行为变更。不把2%/5%参考改成3%而伪造统一策略。

## 验收

- [x] 在真实组件中作最小显示修改，继续使用原DTO字段。
- [x] 既有完整src单Vitest、server/app TS/Vite；不为纯文案新增镜像实现的测试。用实际React旧/新完整HTML对照，移除明确登记的文案差异后其余输出及输入完全一致，并检查paper-buy/watch/avoid三种标签和零额外请求。
- [x] 隔离Chrome在390/768/1440验证可见说明、参考数值、候选标签、表内横滚及分页，无外部fetch；人工看手机截图。
- [x] 更新0132决策/产品/状态/总计划，独立push exit0且HEAD=upstream/干净树后部署，核对实际归档、三健康、双域HTTPS/匿名401、动态完整经济/风险、上一60e9357材料；API/桥接容器及镜像严格保持，并检查实际web字节与公网一致。
- [ ] 仅一次文档回执后核对三个已测容器严格保持，结果写runtime/handoff不递归。

- UTC23:02前本地完成：完整67文件537前端及server/app TS/Vite通过；6个候选数量组的真实完整HTML/输入除登记文案和说明外保持，fetch0；Chrome三宽度×两页6组，三动作/5%和2%/分页保持、手机截图人工核查。证据runtime/2026-11-13-candidate-reference-{src-tests,compatibility}.json和runtime/candidate-reference-browser-d21e65a83b/result.json；后端3438/桥接308/归档41只继承。尚待独立提交发布。

- UTC23:04：源码29fff22a2c2eb367de8617cea6dcd8127fb18cd0已push/deploy exit0，HEAD=upstream/干净。919实际归档文件、三健康、双域6项系统可信HTTPS/匿名401、动态完整经济/风险及上一60e9357源码/三镜像/私有导出和覆盖拒绝通过；API/桥接容器及镜像严格保持，继承3438实际生产测试的后端镜像身份匹配。实际DailyCandidates新chunk字节与公网可信HTTPS逐字节一致。证据runtime/2026-11-13-candidate-reference-{release-summary,production-web}.json；本提交为唯一文档回执，后核对三已测容器保持，结果仅写runtime/handoff不递归。
