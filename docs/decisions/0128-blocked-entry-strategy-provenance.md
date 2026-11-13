# 0128：入场纪律阻塞保留已选策略来源

日期：2026-11-13。状态：本地验证中，发布验收见[子计划](../plans/2026-11-13-blocked-entry-strategy-provenance.md)。

## 问题

持续性、往返费用和同日回补检查发生在策略选中及可定量之后；原阻塞operation只显示共用“隔夜持续性与费用纪律”名称，没有复制已知candidate.strategyKey。执行器因此将真实来源记成null，不能从后续审计区分被阻塞的策略。11月13日已有11轮类似阻塞，但缺失的历史编号不能靠当前路由猜测回填。

## 决策

仅在原entryBlockReasons非空分支增加`strategyKey: candidate.strategyKey`。沿已有skippedOperations与skippedReasons传播，不增加`strategy-route: pass`，不把阻塞变成准入。保留原action、零数量/金额、原因、规则、资金、排序及所有门槛。

新来源使审计签名能区分实际不同的策略，可能出现一次新的审计记录；blocked不是filled，不计入近期已成交策略使用数。旧operation没有显式来源和旧路由通过证据时继续为null。本项不影响已有持仓入场元数据，也不补写历史。

## 验证边界

使用真实计划构建器覆盖持续性、费用、同日回补和两类验证策略；真实模拟执行器及内存账本确认来源进入跳过及持久审计、没有订单/资金/持仓/风险变化，legacy来源保持未知。只替换外部研究获取边界，没有mock跳过、审计或Broker。

1152组固定计划比较中288条原入场纪律阻塞新增编号（snapshot-candidate256、qualified-probe16、validation-basket16），移除此字段后完整输出逐字节一致。它修复后续复盘归因，不证明交易频率、收益或胜率改善，不改变任何策略默认。
