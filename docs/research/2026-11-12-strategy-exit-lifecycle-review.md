# 六策略固定退出生命周期对照

这批数据不支持统一切换分族退出。趋势健康、回踩、RSI和布林带的family-exit都出现低于native的窗口；低波趋势的权益有所提高，但12组中8组观察回撤更大。只留3%价格止损的方案常把盈利仓留在期末，闭合片段盈利数可以为零且权益为正，因此不能按闭合胜率或该批最高权益挑默认。生产默认、原六类、资金和旧仓未知来源均未改。

**状态：** 离线研究工具与结果已实现，本地目标92、完整187文件3010后端及TS/Vite通过；实际生产镜像与发布回执以[执行计划](../plans/2026-11-12-strategy-exit-lifecycle-research.md)为准。47项新增覆盖实际成本、T+1、周期计数/缺失、MA20、同根优先、原意图合法性、回调隔离、重复重置和真实次开成交。首轮测试先因新模块尚未实现而加载失败，不把它称47个旧代码缺陷。

## 固定方法与独立核验

沿用已反复观察的12股各500根qfq历史，2024-10-21至2026-11-10，输入SHA256为32fc7da6789ebcd55660f7b031d036ad070e09b3baa8d919c8391350f9963d01。来源AkShare/eastmoney-stock-history/qfq，输入观察时间2026-11-10T18:52:02.315Z；实际asOf由原输入观察与快照时间较早者固定，来源及验证警告均无。该批不是新样本外，也不是生产自动路由回放。

六profile×三退出×三不重叠窗166/166/168×双成本×正逆代码顺序，共216组。每窗重建账户与策略，不跨窗预热，不强制期末平仓；2万元本金、5000元单笔、25%单股、5%日亏、100股、T+1、无固定现金预留保持。基础佣金0.03%/最低5元/5bps，压力佣金0.06%/最低10元/15bps。当前及此前已完成收盘决策，下一共同日实际开盘加滑点成交，无重试；决策时仍锁定的数量不能提前计作翌日可卖。

native完全原类；common-price-stop推进原类后只保留买入，以实际均价3%价格止损替换卖出；family-exit再加预先固定规则。趋势族连续两个完成收盘低于各自MA20或持仓20次完成观察退出；回归族达到MA20且较实际均价至少恢复1.5%，或10次完成观察退出。年龄从可核实实际首笔成交后的首个有效收盘计1，加仓/部分退出不重置；未知、未来或研究开始前的旧周期不猜年龄。共同止损优先，退出意图抑制同根买入。3%不是含费最大亏损，1.5%也不是净盈利保证。详见[0105](../decisions/0105-offline-strategy-family-exit-research.md)。

两次输出逐字节一致，最终输出SHA256=bbea65e5d9ccf5390dc5ee7cd034c48db2faaa65fab9cfda2010835ab178ae57。全部6024笔成交独立重建实际次开价/滑点/佣金、逐笔现金、FIFO含费盈利分子与闭合分母、T+1/库存、期末权益和开盘/收盘观察回撤。最小逐笔现金0，未出现负现金。native的72组投影与上轮204组对应子集完整相同；全部216组组合唯一且齐全。另向两份报告同时注入现金、佣金、FIFO盈利数、回撤、native权益及重复组六类错误，独立核验器均拒绝。非native缺失年龄、坏成本、坏完成收盘观察均为0；这只证明该固定输入未触发缺失分支，不能外推线上来源齐全。native直接返回原类，其退出包装器诊断为未参与计数，不表示市场没有相关条件。

## 对“最近亏损”的具体启示

- RSI native正序基础三窗为+10.535%、-5.68%、-2.925%，闭合盈利22/31并不代表每窗盈利。family-exit变为-0.985%、-2.555%、-3.705%，成交70→187、佣金350→935元；最差观察回撤11.85%→7.34%，代价是收益/费用路径恶化。压力下family三窗仍全亏，不能只展示回撤减少。
- 布林带family基础第二窗从+0.07%转为-0.065%，压力三窗全亏；正序成交109→149、佣金545→745元。更主动退出没有形成通用优势。
- 趋势健康family相对native的12组中4组权益提高、8组降低，8组回撤更大。前高突破family为0组提高、4组降低、8组相同，不能凭增加一条退出规则宣称优化成功。
- 低波趋势family的12组权益均高于native，但8组回撤更大，且压力第三窗仍-1.36%；保留作前瞻验证假设，不按已经看过的数据上线择优。
- common-price-stop的已闭合盈利片段全部为零，但一些窗口期末权益较高，反映只止损而盈利仓未强平的样本截断。RSI/布林带该方案还出现顺序敏感与更大回撤；不能拿权益高、佣金低或零胜率中的任一项单独下结论。

修改退出会改变未来入场和资金可用性，三方案不是相同入场的配对成功率试验。正逆顺序不是独立样本，三窗汇总的佣金/成交只是总工作量，不是连续复利账户。下表与完整逐组记录保留所有负值、期末持仓、拒单、尾部意图及闭合分母。没有完整交易所日历、开盘盘口/涨跌停可成交性、税费全模型或point-in-time股票池；日内自动路由、kairosRangeRotation与旧四仓的实际策略归属不能由此推断。

## 重现

使用同一冻结文件，两个输出路径需不同；验证器需要原204组报告，且拒绝覆盖任何输入。日志和原输入位于忽略的runtime目录，不包含账户或凭据。

```powershell
node node_modules/tsx/dist/cli.mjs scripts/research-strategy-exits-history.ts runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-strategy-exits-a.json
node node_modules/tsx/dist/cli.mjs scripts/research-strategy-exits-history.ts runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-strategy-exits-b.json
node scripts/verify-strategy-exit-history.cjs runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-strategy-exits-a.json runtime/2026-11-12-strategy-exits-b.json runtime/2026-11-12-entry-context-shared-capital-a.json runtime/2026-11-12-strategy-exits
```

验证输出runtime/2026-11-12-strategy-exits-summary.json保留哈希、分模式诊断与顺序敏感性；主输出保留源码哈希、固定参数、来源/时间、实际成交及所有拒单。继续前瞻研究时先固定新样本与验收，不在本批追加参数搜索。

## 全部逐组结果

权益含未平仓市值；观察回撤是比例转百分数，成交包含买卖单，盈利/闭合为含双边费用FIFO匹配片段。年龄未知是观察次数，不是持仓或股票数；native未参与包装计数。顺序ascending/descending均按证券代码，窗口各自从2万元重新开始。

| 策略 | 退出 | 成本 | 窗 | 顺序 | 权益元 | 观察回撤% | 成交/佣金元 | 盈利/闭合片段 | 期末仓数 | 拒单 | 年龄未知观察 | 尾部意图 |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kairosLowVolTrend | native | base | 1 | ascending | 20282 | 4.39 | 102/510 | 20/48 | 6 | 0 | 0 | 3 |
| kairosLowVolTrend | native | base | 1 | descending | 20282 | 4.39 | 102/510 | 20/48 | 6 | 0 | 0 | 3 |
| kairosLowVolTrend | native | base | 2 | ascending | 20559 | 1.91 | 42/210 | 8/21 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | native | base | 2 | descending | 20559 | 1.91 | 42/210 | 8/21 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | native | base | 3 | ascending | 20017 | 3.12 | 63/315 | 14/29 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | native | base | 3 | descending | 20017 | 3.12 | 63/315 | 14/29 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | native | stress | 1 | ascending | 19396 | 5.85 | 104/1040 | 16/49 | 6 | 0 | 0 | 3 |
| kairosLowVolTrend | native | stress | 1 | descending | 19396 | 5.85 | 104/1040 | 16/49 | 6 | 0 | 0 | 3 |
| kairosLowVolTrend | native | stress | 2 | ascending | 19997 | 2.47 | 40/400 | 7/20 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | native | stress | 2 | descending | 19997 | 2.47 | 40/400 | 7/20 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | native | stress | 3 | ascending | 19518 | 3.78 | 59/590 | 9/27 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | native | stress | 3 | descending | 19518 | 3.78 | 59/590 | 9/27 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | common-price-stop | base | 1 | ascending | 21324 | 5.39 | 18/90 | 0/6 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | common-price-stop | base | 1 | descending | 21324 | 5.39 | 18/90 | 0/6 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | common-price-stop | base | 2 | ascending | 20610 | 5.24 | 14/70 | 0/6 | 2 | 0 | 0 | 0 |
| kairosLowVolTrend | common-price-stop | base | 2 | descending | 20610 | 5.24 | 14/70 | 0/6 | 2 | 0 | 0 | 0 |
| kairosLowVolTrend | common-price-stop | base | 3 | ascending | 20545 | 3.63 | 15/75 | 0/5 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | common-price-stop | base | 3 | descending | 20545 | 3.63 | 15/75 | 0/5 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | common-price-stop | stress | 1 | ascending | 21181 | 5.72 | 18/180 | 0/6 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | common-price-stop | stress | 1 | descending | 21181 | 5.72 | 18/180 | 0/6 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | common-price-stop | stress | 2 | ascending | 20532 | 5.25 | 14/140 | 0/6 | 2 | 0 | 0 | 0 |
| kairosLowVolTrend | common-price-stop | stress | 2 | descending | 20532 | 5.25 | 14/140 | 0/6 | 2 | 0 | 0 | 0 |
| kairosLowVolTrend | common-price-stop | stress | 3 | ascending | 20495 | 3.89 | 15/150 | 0/5 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | common-price-stop | stress | 3 | descending | 20495 | 3.89 | 15/150 | 0/5 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | family-exit | base | 1 | ascending | 20683 | 5.46 | 58/290 | 9/26 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | family-exit | base | 1 | descending | 20683 | 5.46 | 58/290 | 9/26 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | family-exit | base | 2 | ascending | 20872 | 1.87 | 24/120 | 5/12 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | family-exit | base | 2 | descending | 20872 | 1.87 | 24/120 | 5/12 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | family-exit | base | 3 | ascending | 20052 | 3.66 | 39/195 | 5/17 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | family-exit | base | 3 | descending | 20052 | 3.66 | 39/195 | 5/17 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | family-exit | stress | 1 | ascending | 20055 | 6.47 | 58/580 | 6/26 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | family-exit | stress | 1 | descending | 20055 | 6.47 | 58/580 | 6/26 | 6 | 0 | 0 | 2 |
| kairosLowVolTrend | family-exit | stress | 2 | ascending | 20674 | 1.88 | 24/240 | 4/12 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | family-exit | stress | 2 | descending | 20674 | 1.88 | 24/240 | 4/12 | 0 | 0 | 0 | 0 |
| kairosLowVolTrend | family-exit | stress | 3 | ascending | 19728 | 4.10 | 39/390 | 5/17 | 5 | 0 | 0 | 1 |
| kairosLowVolTrend | family-exit | stress | 3 | descending | 19728 | 4.10 | 39/390 | 5/17 | 5 | 0 | 0 | 1 |
| kairosTrendHealth | native | base | 1 | ascending | 21090 | 3.71 | 40/200 | 10/18 | 4 | 0 | 0 | 1 |
| kairosTrendHealth | native | base | 1 | descending | 21090 | 3.71 | 40/200 | 10/18 | 4 | 0 | 0 | 1 |
| kairosTrendHealth | native | base | 2 | ascending | 20860 | 2.97 | 20/100 | 6/10 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | native | base | 2 | descending | 20860 | 2.97 | 20/100 | 6/10 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | native | base | 3 | ascending | 20419 | 2.10 | 24/120 | 5/10 | 4 | 0 | 0 | 2 |
| kairosTrendHealth | native | base | 3 | descending | 20419 | 2.10 | 24/120 | 5/10 | 4 | 0 | 0 | 2 |
| kairosTrendHealth | native | stress | 1 | ascending | 20479 | 4.79 | 40/400 | 9/18 | 4 | 0 | 0 | 1 |
| kairosTrendHealth | native | stress | 1 | descending | 20479 | 4.79 | 40/400 | 9/18 | 4 | 0 | 0 | 1 |
| kairosTrendHealth | native | stress | 2 | ascending | 20702 | 3.13 | 20/200 | 6/10 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | native | stress | 2 | descending | 20702 | 3.13 | 20/200 | 6/10 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | native | stress | 3 | ascending | 20314 | 2.34 | 24/240 | 5/10 | 4 | 0 | 0 | 2 |
| kairosTrendHealth | native | stress | 3 | descending | 20314 | 2.34 | 24/240 | 5/10 | 4 | 0 | 0 | 2 |
| kairosTrendHealth | common-price-stop | base | 1 | ascending | 21343 | 4.66 | 18/90 | 0/6 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | base | 1 | descending | 21343 | 4.66 | 18/90 | 0/6 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | base | 2 | ascending | 20733 | 4.57 | 8/40 | 0/3 | 2 | 0 | 0 | 0 |
| kairosTrendHealth | common-price-stop | base | 2 | descending | 20733 | 4.57 | 8/40 | 0/3 | 2 | 0 | 0 | 0 |
| kairosTrendHealth | common-price-stop | base | 3 | ascending | 20747 | 2.90 | 11/55 | 0/3 | 5 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | base | 3 | descending | 20747 | 2.90 | 11/55 | 0/3 | 5 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | stress | 1 | ascending | 20963 | 5.15 | 20/200 | 0/7 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | stress | 1 | descending | 20963 | 5.15 | 20/200 | 0/7 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | stress | 2 | ascending | 20668 | 4.58 | 8/80 | 0/3 | 2 | 0 | 0 | 0 |
| kairosTrendHealth | common-price-stop | stress | 2 | descending | 20668 | 4.58 | 8/80 | 0/3 | 2 | 0 | 0 | 0 |
| kairosTrendHealth | common-price-stop | stress | 3 | ascending | 20685 | 3.08 | 11/110 | 0/3 | 5 | 0 | 0 | 1 |
| kairosTrendHealth | common-price-stop | stress | 3 | descending | 20685 | 3.08 | 11/110 | 0/3 | 5 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | base | 1 | ascending | 20504 | 4.00 | 40/200 | 6/17 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | base | 1 | descending | 20504 | 4.00 | 40/200 | 6/17 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | base | 2 | ascending | 21136 | 1.75 | 14/70 | 5/7 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | family-exit | base | 2 | descending | 21136 | 1.75 | 14/70 | 5/7 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | family-exit | base | 3 | ascending | 20258 | 2.90 | 27/135 | 4/12 | 3 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | base | 3 | descending | 20258 | 2.90 | 27/135 | 4/12 | 3 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | stress | 1 | ascending | 20127 | 5.09 | 40/400 | 6/17 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | stress | 1 | descending | 20127 | 5.09 | 40/400 | 6/17 | 6 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | stress | 2 | ascending | 21026 | 1.88 | 14/140 | 5/7 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | family-exit | stress | 2 | descending | 21026 | 1.88 | 14/140 | 5/7 | 0 | 0 | 0 | 0 |
| kairosTrendHealth | family-exit | stress | 3 | ascending | 20035 | 3.22 | 27/270 | 4/12 | 3 | 0 | 0 | 1 |
| kairosTrendHealth | family-exit | stress | 3 | descending | 20035 | 3.22 | 27/270 | 4/12 | 3 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | native | base | 1 | ascending | 20022 | 1.73 | 9/45 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | native | base | 1 | descending | 20022 | 1.73 | 9/45 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | native | base | 2 | ascending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | base | 2 | descending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | base | 3 | ascending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | base | 3 | descending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | stress | 1 | ascending | 19957 | 1.95 | 9/90 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | native | stress | 1 | descending | 19957 | 1.95 | 9/90 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | native | stress | 2 | ascending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | stress | 2 | descending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | stress | 3 | ascending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | native | stress | 3 | descending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | base | 1 | ascending | 20068 | 1.73 | 8/40 | 0/3 | 2 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | common-price-stop | base | 1 | descending | 20068 | 1.73 | 8/40 | 0/3 | 2 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | common-price-stop | base | 2 | ascending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | base | 2 | descending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | base | 3 | ascending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | base | 3 | descending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | stress | 1 | ascending | 20010 | 1.95 | 8/80 | 0/3 | 2 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | common-price-stop | stress | 1 | descending | 20010 | 1.95 | 8/80 | 0/3 | 2 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | common-price-stop | stress | 2 | ascending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | stress | 2 | descending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | stress | 3 | ascending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | common-price-stop | stress | 3 | descending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | base | 1 | ascending | 19937 | 1.73 | 9/45 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | family-exit | base | 1 | descending | 19937 | 1.73 | 9/45 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | family-exit | base | 2 | ascending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | base | 2 | descending | 19682 | 2.13 | 6/30 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | base | 3 | ascending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | base | 3 | descending | 19624 | 2.45 | 11/55 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | stress | 1 | ascending | 19872 | 1.95 | 9/90 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | family-exit | stress | 1 | descending | 19872 | 1.95 | 9/90 | 1/4 | 1 | 0 | 0 | 1 |
| kairosVolumePriceBreakout | family-exit | stress | 2 | ascending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | stress | 2 | descending | 19638 | 2.31 | 6/60 | 0/3 | 0 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | stress | 3 | ascending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | family-exit | stress | 3 | descending | 19531 | 2.74 | 11/110 | 0/4 | 3 | 0 | 0 | 0 |
| aSharePullback | native | base | 1 | ascending | 20815 | 3.74 | 23/115 | 7/11 | 1 | 0 | 0 | 1 |
| aSharePullback | native | base | 1 | descending | 20815 | 3.74 | 23/115 | 7/11 | 1 | 0 | 0 | 1 |
| aSharePullback | native | base | 2 | ascending | 19533 | 2.65 | 14/70 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | native | base | 2 | descending | 19533 | 2.65 | 14/70 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | native | base | 3 | ascending | 19578 | 4.77 | 22/110 | 3/10 | 2 | 0 | 0 | 0 |
| aSharePullback | native | base | 3 | descending | 19578 | 4.77 | 22/110 | 3/10 | 2 | 0 | 0 | 0 |
| aSharePullback | native | stress | 1 | ascending | 20363 | 3.40 | 23/230 | 6/11 | 1 | 0 | 0 | 1 |
| aSharePullback | native | stress | 1 | descending | 20363 | 3.40 | 23/230 | 6/11 | 1 | 0 | 0 | 1 |
| aSharePullback | native | stress | 2 | ascending | 19409 | 3.09 | 14/140 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | native | stress | 2 | descending | 19409 | 3.09 | 14/140 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | native | stress | 3 | ascending | 19449 | 5.17 | 22/220 | 3/10 | 2 | 0 | 0 | 0 |
| aSharePullback | native | stress | 3 | descending | 19449 | 5.17 | 22/220 | 3/10 | 2 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 1 | ascending | 21679 | 6.52 | 12/60 | 0/4 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 1 | descending | 21679 | 6.52 | 12/60 | 0/4 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 2 | ascending | 19313 | 5.09 | 13/65 | 0/6 | 1 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 2 | descending | 19313 | 5.09 | 13/65 | 0/6 | 1 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 3 | ascending | 19587 | 5.49 | 18/90 | 0/7 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | base | 3 | descending | 19587 | 5.49 | 18/90 | 0/7 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 1 | ascending | 21691 | 6.63 | 12/120 | 0/4 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 1 | descending | 21691 | 6.63 | 12/120 | 0/4 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 2 | ascending | 19198 | 5.15 | 13/130 | 0/6 | 1 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 2 | descending | 19198 | 5.15 | 13/130 | 0/6 | 1 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 3 | ascending | 19491 | 5.85 | 18/180 | 0/7 | 4 | 0 | 0 | 0 |
| aSharePullback | common-price-stop | stress | 3 | descending | 19491 | 5.85 | 18/180 | 0/7 | 4 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 1 | ascending | 20134 | 1.91 | 21/105 | 5/10 | 1 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 1 | descending | 20134 | 1.91 | 21/105 | 5/10 | 1 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 2 | ascending | 19506 | 5.05 | 14/70 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 2 | descending | 19506 | 5.05 | 14/70 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 3 | ascending | 19800 | 3.37 | 21/105 | 1/9 | 3 | 0 | 0 | 0 |
| aSharePullback | family-exit | base | 3 | descending | 19800 | 3.37 | 21/105 | 1/9 | 3 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 1 | ascending | 19926 | 2.12 | 21/210 | 3/10 | 1 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 1 | descending | 19926 | 2.12 | 21/210 | 3/10 | 1 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 2 | ascending | 19382 | 5.12 | 14/140 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 2 | descending | 19382 | 5.12 | 14/140 | 1/7 | 0 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 3 | ascending | 19619 | 4.07 | 21/210 | 1/9 | 3 | 0 | 0 | 0 |
| aSharePullback | family-exit | stress | 3 | descending | 19619 | 4.07 | 21/210 | 1/9 | 3 | 0 | 0 | 0 |
| rsi | native | base | 1 | ascending | 22107 | 5.21 | 27/135 | 11/13 | 1 | 3 | 0 | 0 |
| rsi | native | base | 1 | descending | 22107 | 5.21 | 27/135 | 11/13 | 1 | 3 | 0 | 0 |
| rsi | native | base | 2 | ascending | 18864 | 8.04 | 18/90 | 4/6 | 6 | 0 | 0 | 3 |
| rsi | native | base | 2 | descending | 18864 | 8.04 | 18/90 | 4/6 | 6 | 0 | 0 | 3 |
| rsi | native | base | 3 | ascending | 19415 | 11.85 | 25/125 | 7/12 | 1 | 1 | 0 | 0 |
| rsi | native | base | 3 | descending | 19415 | 11.85 | 25/125 | 7/12 | 1 | 1 | 0 | 0 |
| rsi | native | stress | 1 | ascending | 21862 | 5.36 | 27/270 | 11/13 | 1 | 3 | 0 | 0 |
| rsi | native | stress | 1 | descending | 21862 | 5.36 | 27/270 | 11/13 | 1 | 3 | 0 | 0 |
| rsi | native | stress | 2 | ascending | 18704 | 8.32 | 18/180 | 4/6 | 6 | 0 | 0 | 3 |
| rsi | native | stress | 2 | descending | 18704 | 8.32 | 18/180 | 4/6 | 6 | 0 | 0 | 3 |
| rsi | native | stress | 3 | ascending | 19193 | 12.13 | 25/250 | 6/12 | 1 | 1 | 0 | 0 |
| rsi | native | stress | 3 | descending | 19193 | 12.13 | 25/250 | 6/12 | 1 | 1 | 0 | 0 |
| rsi | common-price-stop | base | 1 | ascending | 23683 | 11.40 | 26/130 | 0/10 | 6 | 20 | 0 | 0 |
| rsi | common-price-stop | base | 1 | descending | 23025 | 11.19 | 26/130 | 0/10 | 6 | 8 | 0 | 0 |
| rsi | common-price-stop | base | 2 | ascending | 19065 | 14.49 | 30/150 | 0/12 | 6 | 0 | 0 | 3 |
| rsi | common-price-stop | base | 2 | descending | 19065 | 14.49 | 30/150 | 0/12 | 6 | 0 | 0 | 3 |
| rsi | common-price-stop | base | 3 | ascending | 20910 | 12.08 | 34/170 | 0/14 | 6 | 12 | 0 | 0 |
| rsi | common-price-stop | base | 3 | descending | 20910 | 12.08 | 34/170 | 0/14 | 6 | 12 | 0 | 0 |
| rsi | common-price-stop | stress | 1 | ascending | 23724 | 11.17 | 24/240 | 0/9 | 6 | 23 | 0 | 0 |
| rsi | common-price-stop | stress | 1 | descending | 23520 | 10.96 | 24/240 | 0/9 | 6 | 22 | 0 | 0 |
| rsi | common-price-stop | stress | 2 | ascending | 18648 | 15.32 | 34/340 | 0/14 | 6 | 0 | 0 | 3 |
| rsi | common-price-stop | stress | 2 | descending | 18648 | 15.32 | 34/340 | 0/14 | 6 | 0 | 0 | 3 |
| rsi | common-price-stop | stress | 3 | ascending | 20408 | 14.01 | 35/350 | 0/15 | 5 | 13 | 0 | 0 |
| rsi | common-price-stop | stress | 3 | descending | 20408 | 14.01 | 35/350 | 0/15 | 5 | 13 | 0 | 0 |
| rsi | family-exit | base | 1 | ascending | 19803 | 4.17 | 56/280 | 14/28 | 0 | 0 | 0 | 0 |
| rsi | family-exit | base | 1 | descending | 19803 | 4.17 | 56/280 | 14/28 | 0 | 0 | 0 | 0 |
| rsi | family-exit | base | 2 | ascending | 19489 | 5.17 | 71/355 | 16/35 | 1 | 0 | 0 | 4 |
| rsi | family-exit | base | 2 | descending | 19489 | 5.17 | 71/355 | 16/35 | 1 | 0 | 0 | 4 |
| rsi | family-exit | base | 3 | ascending | 19259 | 7.34 | 60/300 | 12/30 | 0 | 0 | 0 | 0 |
| rsi | family-exit | base | 3 | descending | 19259 | 7.34 | 60/300 | 12/30 | 0 | 0 | 0 | 0 |
| rsi | family-exit | stress | 1 | ascending | 19337 | 5.92 | 56/560 | 14/28 | 0 | 0 | 0 | 0 |
| rsi | family-exit | stress | 1 | descending | 19337 | 5.92 | 56/560 | 14/28 | 0 | 0 | 0 | 0 |
| rsi | family-exit | stress | 2 | ascending | 18754 | 7.43 | 71/710 | 13/35 | 1 | 0 | 0 | 4 |
| rsi | family-exit | stress | 2 | descending | 18754 | 7.43 | 71/710 | 13/35 | 1 | 0 | 0 | 4 |
| rsi | family-exit | stress | 3 | ascending | 18690 | 9.72 | 60/600 | 12/30 | 0 | 0 | 0 | 0 |
| rsi | family-exit | stress | 3 | descending | 18690 | 9.72 | 60/600 | 12/30 | 0 | 0 | 0 | 0 |
| bollingerBands | native | base | 1 | ascending | 20695 | 4.76 | 34/170 | 14/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | base | 1 | descending | 20695 | 4.76 | 34/170 | 14/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | base | 2 | ascending | 20014 | 3.26 | 41/205 | 13/20 | 1 | 0 | 0 | 3 |
| bollingerBands | native | base | 2 | descending | 20014 | 3.26 | 41/205 | 13/20 | 1 | 0 | 0 | 3 |
| bollingerBands | native | base | 3 | ascending | 19591 | 5.98 | 34/170 | 10/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | base | 3 | descending | 19591 | 5.98 | 34/170 | 10/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | stress | 1 | ascending | 20401 | 5.73 | 34/340 | 14/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | stress | 1 | descending | 20401 | 5.73 | 34/340 | 14/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | stress | 2 | ascending | 19631 | 4.10 | 41/410 | 11/20 | 1 | 0 | 0 | 3 |
| bollingerBands | native | stress | 2 | descending | 19631 | 4.10 | 41/410 | 11/20 | 1 | 0 | 0 | 3 |
| bollingerBands | native | stress | 3 | ascending | 19189 | 6.54 | 34/340 | 8/17 | 0 | 0 | 0 | 0 |
| bollingerBands | native | stress | 3 | descending | 19189 | 6.54 | 34/340 | 8/17 | 0 | 0 | 0 | 0 |
| bollingerBands | common-price-stop | base | 1 | ascending | 22885 | 9.20 | 22/110 | 0/8 | 6 | 6 | 0 | 0 |
| bollingerBands | common-price-stop | base | 1 | descending | 22283 | 9.11 | 22/110 | 0/8 | 6 | 4 | 0 | 0 |
| bollingerBands | common-price-stop | base | 2 | ascending | 19404 | 5.39 | 37/185 | 0/16 | 5 | 1 | 0 | 3 |
| bollingerBands | common-price-stop | base | 2 | descending | 19404 | 5.39 | 37/185 | 0/16 | 5 | 1 | 0 | 3 |
| bollingerBands | common-price-stop | base | 3 | ascending | 21780 | 7.40 | 28/140 | 0/11 | 6 | 2 | 0 | 0 |
| bollingerBands | common-price-stop | base | 3 | descending | 21780 | 7.40 | 28/140 | 0/11 | 6 | 2 | 0 | 0 |
| bollingerBands | common-price-stop | stress | 1 | ascending | 22686 | 9.58 | 22/220 | 0/8 | 6 | 5 | 0 | 0 |
| bollingerBands | common-price-stop | stress | 1 | descending | 22087 | 9.49 | 22/220 | 0/8 | 6 | 3 | 0 | 0 |
| bollingerBands | common-price-stop | stress | 2 | ascending | 19087 | 6.00 | 37/370 | 0/16 | 5 | 1 | 0 | 3 |
| bollingerBands | common-price-stop | stress | 2 | descending | 19087 | 6.00 | 37/370 | 0/16 | 5 | 1 | 0 | 3 |
| bollingerBands | common-price-stop | stress | 3 | ascending | 21250 | 8.06 | 29/290 | 0/12 | 5 | 8 | 0 | 0 |
| bollingerBands | common-price-stop | stress | 3 | descending | 20529 | 8.06 | 33/330 | 0/14 | 5 | 4 | 0 | 0 |
| bollingerBands | family-exit | base | 1 | ascending | 20405 | 6.33 | 46/230 | 17/23 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | base | 1 | descending | 20405 | 6.33 | 46/230 | 17/23 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | base | 2 | ascending | 19987 | 3.48 | 55/275 | 14/27 | 1 | 0 | 0 | 3 |
| bollingerBands | family-exit | base | 2 | descending | 19987 | 3.48 | 55/275 | 14/27 | 1 | 0 | 0 | 3 |
| bollingerBands | family-exit | base | 3 | ascending | 19730 | 4.30 | 48/240 | 11/24 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | base | 3 | descending | 19730 | 4.30 | 48/240 | 11/24 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | stress | 1 | ascending | 19785 | 4.46 | 46/460 | 15/23 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | stress | 1 | descending | 19785 | 4.46 | 46/460 | 15/23 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | stress | 2 | ascending | 19491 | 5.07 | 55/550 | 12/27 | 1 | 0 | 0 | 3 |
| bollingerBands | family-exit | stress | 2 | descending | 19491 | 5.07 | 55/550 | 12/27 | 1 | 0 | 0 | 3 |
| bollingerBands | family-exit | stress | 3 | ascending | 18921 | 7.03 | 48/480 | 10/24 | 0 | 0 | 0 | 0 |
| bollingerBands | family-exit | stress | 3 | descending | 18921 | 7.03 | 48/480 | 10/24 | 0 | 0 | 0 | 0 |
