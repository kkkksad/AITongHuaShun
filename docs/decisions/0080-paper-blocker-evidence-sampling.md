# 0080：Paper逐股阻塞说明与有界审计取样

- 状态：接受
- 日期：2026-11-12（北京时间）
- 被取代关系：取代skippedReasons按原序列前八条取样；实际执行、完整运行和SQLite白名单保持。

## 背景

11月11日30次运行有匹配新股却不能形成整手，前八条审计被健康持仓和其他无信号候选占据，无法可靠复盘具体金额限制。计划把未研究、日线不足、趋势恶化统一写成未满足历史和策略，混淆缺输入与已评估失败。

## 决策

无资格候选保持原strategy-route: blocked (no-qualified-signal)及过滤，仅文字区分无历史路由、未覆盖、insufficient-data、trend-deterioration、有效历史但未命中。后者展示形态、置信度与日线数，形态置信度不是胜率，也不说明每条规则的逐项失败。

审计最多八条：阻塞及未执行计划先于observe、hold；同层先保留不同action+reason，再补重复原因，稳定保留同组原顺序。仅输出原白名单字段，新增skippedReasonCount、skippedReasonsOmitted和skippedReasonSelection=blocked-first-distinct-reasons-v1。完整run.skippedOperations及签名仍使用原序列，所有订单与风控行为不变。

## 结果与代价

四持仓+九同原因阻塞+末尾金额阻塞的14项反例，八条审计包含金额原因，完整14项保持顺序。不同原因超过八种仍省略，省略数是操作条数，非遗漏独立原因数；不是完整事件日志。旧记录不回填，SQLite仍保存白名单计数/问题码，不扩大归档内容。

四项完整计划和实际Executor旧版均失败。新增两项选择器及集成覆盖上限、稳定、输入不变、白名单、无订单副作用；验证与发布见[计划](../plans/2026-11-11-entry-blocker-evidence.md)。
