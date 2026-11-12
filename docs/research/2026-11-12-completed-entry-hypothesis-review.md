# 完成日线结构与原在线代理的固定对照

当前样本不支持把本次完整结构门槛直接接入生产。量价确认减少交易但三窗净权益均负；强势回踩所有12个对应组合更差；收缩确认0成交，不能赋予胜率。原代理近期窗口也亏损，不能因此称原规则有效。

## 数据与边界

冻结输入SHA256 `32fc7da6789ebcd55660f7b031d036ad070e09b3baa8d919c8391350f9963d01`，12股各500根东财qfq，止于2026-11-10。沿用166/166/168三个独立共同日窗口：2024-10-21–2025-06-25、2025-06-26–2026-03-04、2026-03-05–2026-11-10；每窗独立空仓20000，不是一条连续账户。特征可看窗口前已发生历史，至少120根之前日线才评估代理，股票分类严格早于决策日；报价和结构在决策日完成收盘后确认，次共同观察日开盘一次尝试。当前幸存者、当前qfq版本及已反复观察数据不是point-in-time股票池或新样本外。

三种策略原rankAdaptiveCandidateStrategies手动资格（candidateScore固定80，不重建旧扫描评分/市场行业路由）与增加结构模式并列。结构只过滤原代理存在的机会，不创造原代理没有的信号。量价为20根前高收盘突破且完成量比≥1.5；收缩另要求20/40平均日波幅比≤0.62、量比≥1.4；回踩为最近六根低点之前20根锚点回撤>0且≤7%、低点完成量比≤1、恢复≥0.8%、收盘越过前日高和完成量比≥1.15。见[事前计划](../plans/2026-11-12-completed-entry-hypothesis-research.md)。没有搜索参数或按好结果删组。

二者统一targetWeight=0.20、不加仓，实际均价3%止损/5%止盈或实际买入后第10个观察收盘超时，T+1/可卖整手检查后次开卖。拒单不启动持仓计时，意图不当成交；窗口末不强平，保留开放仓估值。沿用5000单笔、25%单股、5%日亏和零固定现金预留，费用基础0.03%/最低5元/5bps、压力0.06%/最低10元/15bps。不含完整税项、限价封单、完整法定日历/日内峰谷，正日量不证明开盘可成交；该控制退出也不是线上全部退出重放或完整每日执行预算。

## 单位校正与复现

官方[AkShare行情文档](https://akshare.akfamily.xyz/data/stock/stock_quote.html)明确stock_zh_a_hist成交量为“手”、成交额为“元”。冻结12股均eastmoney-stock-history；新研究只在报价绝对流动性门槛将手×100转股，原历史/相对量比保持。旧observeAdaptivePrefix直接复用手作为quote.volume，首次未换算实验已标invalid并保留，不能与最终报告混用。原历史覆盖研究中涉及绝对快照量门槛的结论也受此局限，原分类/同序列量比及共享固定策略报告不因此自动改变。腾讯历史存在SDK版本字段差异，未核实来源直接拒绝，生产桥接与旧研究未在本模块改变。

最终72组两次逐字节一致，输出SHA256 `e1898b6e6d4f8cd4cc4ac5c84d39535c2c69490c9929b1d603afc0c3f452b4ee`。独立脚本从原OHLC重建18,000组结构/时点，对原rank函数重新计算18,000代理资格，并重建全部2367笔/1229买入的次开价格、费用、现金、FIFO/T+1、共同固定退出、库存、终值和开/收盘观察回撤。最小逐笔现金约52元，无负现金；正逆顺序不是独立统计样本。输出含父提交/dirty及实际源码哈希，不将父提交当最终源码提交。

```powershell
node node_modules/tsx/dist/cli.mjs scripts/research-completed-entry-history.ts runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-frozen-volume-a.json docs/research/2026-11-12-entry-history-volume-contract.json
node node_modules/tsx/dist/cli.mjs scripts/research-completed-entry-history.ts runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-frozen-volume-b.json docs/research/2026-11-12-entry-history-volume-contract.json
node scripts/verify-completed-entry-history.cjs runtime/bank-portfolio-history-attempt1.json runtime/2026-11-12-frozen-volume-a.json runtime/2026-11-12-frozen-volume-b.json runtime/2026-11-12-frozen-volume docs/research/2026-11-12-entry-history-volume-contract.json
```

后续[0112](../decisions/0112-frozen-entry-volume-declaration.md)要求上述显式单位声明，输入字节SHA与声明绑定，避免将已转股载荷再次乘100；不是仅按来源名称猜单位。上文e1898b6e为17d1dfc阶段原结果的历史SHA，工具校验升级后的新元数据输出另存，不回写原文件。哈希不证明人工声明正确；原样本仍非新样本外。

单位绑定升级后的两次输出字节一致SHA256 `c6aa0fca92f828d0a017f87f06ecb8bf9de073d49cdcbb0d5bcf2b0b585cac60`，2367逐笔/18000结构和代理独立核验通过；全部72组经济结果/资格/窗口与原e1898b6e输出完全保持。另将旧输入仅历史volume×100生成受控副本（SHA31979bb8b63daf6ac1f8a01ea81cec91014bd7952567f60288bcec5260599d3a），声明为shares后72组同样保持；此项仅验证单位等价，不是新增市场样本或样本外验证。原始输入字节未改，原不利结论保持。

## 汇总

收益/观察回撤为百分比。闭合盈利/分母、成交/佣金是三个正序基础窗口合计，未平仓包含估值；不能当一个连续账户胜率或实盘胜率。

| 策略/模式 | 正序基础三窗收益% | 正序压力三窗收益% | 基础盈利/闭合片段 | 基础成交/佣金元 | 基础最差回撤% | 基础期末有仓窗 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 量价/原代理 | 4.190 / 3.395 / -1.975 | 2.640 / 4.335 / -3.600 | 37/73 | 153/765 | 4.618 | 3 |
| 量价/结构 | -0.255 / -1.115 / -0.765 | -0.325 / -1.685 / -0.880 | 2/8 | 17/85 | 1.690 | 1 |
| 收缩/原代理 | 8.740 / 6.515 / -2.545 | 5.780 / 4.995 / -5.050 | 46/86 | 181/905 | 6.269 | 2 |
| 收缩/结构 | 0 / 0 / 0 | 0 / 0 / 0 | 未知（0闭合） | 0/0 | 0 | 0 |
| 回踩/原代理 | 7.690 / 6.880 / -1.440 | 4.795 / 4.985 / -3.775 | 51/94 | 194/970 | 5.438 | 2 |
| 回踩/结构 | 0.405 / 0.555 / -4.580 | 0.175 / -1.885 / -5.060 | 8/24 | 49/245 | 5.215 | 1 |

量价原代理321个股日资格，结构联合21；收缩512→2；回踩458→60。三策略各6000股日中前60日结构未知720（12×60），都保留未知，不当0信号。量价与收缩各12对应组有4权益较好、8较差；回踩0较好、12较差。收缩归零的较好只表示持币避开部分下跌，不是有效获利或策略更好；2联合机会没有成交，拒单/尾意图和资金条件见下方全表。

结构门槛并未形成统一费用后优势，近期窗口尤其不利。保留原线上默认，本项只上线离线研究工具。下一步优先核实供应方量/额合同和版本、记录自然运行结构与候选资格，再用新时间段做前瞻验证；不能拿本报告反复寻优后宣称新样本外成功。

## 全部72组

| 策略 | 模式 | 成本 | 窗 | 顺序 | 期末权益 | 观察回撤% | 成交/佣金 | 盈利/闭合片段 | 未平仓股数 | 拒单 | 尾意图 |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kairosVolumePriceBreakout | proxy | base | 1 | ascending | 20838 | 1.775 | 26/130 | 7/11 | 4 | 3 | 3 |
| kairosVolumePriceBreakout | proxy | base | 1 | descending | 20838 | 1.775 | 26/130 | 7/11 | 4 | 3 | 3 |
| kairosVolumePriceBreakout | proxy | base | 2 | ascending | 20679 | 4.618 | 85/425 | 22/42 | 1 | 8 | 1 |
| kairosVolumePriceBreakout | proxy | base | 2 | descending | 20679 | 4.618 | 85/425 | 22/42 | 1 | 8 | 1 |
| kairosVolumePriceBreakout | proxy | base | 3 | ascending | 19605 | 3.872 | 42/210 | 8/20 | 2 | 0 | 0 |
| kairosVolumePriceBreakout | proxy | base | 3 | descending | 19605 | 3.872 | 42/210 | 8/20 | 2 | 0 | 0 |
| kairosVolumePriceBreakout | proxy | stress | 1 | ascending | 20528 | 2.132 | 24/240 | 6/10 | 4 | 0 | 3 |
| kairosVolumePriceBreakout | proxy | stress | 1 | descending | 20528 | 2.132 | 24/240 | 6/10 | 4 | 0 | 3 |
| kairosVolumePriceBreakout | proxy | stress | 2 | ascending | 20867 | 3.586 | 87/870 | 22/43 | 1 | 8 | 1 |
| kairosVolumePriceBreakout | proxy | stress | 2 | descending | 20867 | 3.586 | 87/870 | 22/43 | 1 | 8 | 1 |
| kairosVolumePriceBreakout | proxy | stress | 3 | ascending | 19280 | 4.385 | 40/400 | 8/19 | 2 | 0 | 0 |
| kairosVolumePriceBreakout | proxy | stress | 3 | descending | 19280 | 4.385 | 40/400 | 8/19 | 2 | 0 | 0 |
| kairosVolumePriceBreakout | structure | base | 1 | ascending | 19949 | 0.265 | 2/10 | 0/1 | 0 | 0 | 2 |
| kairosVolumePriceBreakout | structure | base | 1 | descending | 19949 | 0.265 | 2/10 | 0/1 | 0 | 0 | 2 |
| kairosVolumePriceBreakout | structure | base | 2 | ascending | 19777 | 1.690 | 12/60 | 2/6 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | structure | base | 2 | descending | 19777 | 1.690 | 12/60 | 2/6 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | structure | base | 3 | ascending | 19847 | 0.899 | 3/15 | 0/1 | 1 | 0 | 0 |
| kairosVolumePriceBreakout | structure | base | 3 | descending | 19847 | 0.899 | 3/15 | 0/1 | 1 | 0 | 0 |
| kairosVolumePriceBreakout | structure | stress | 1 | ascending | 19935 | 0.325 | 2/20 | 0/1 | 0 | 0 | 2 |
| kairosVolumePriceBreakout | structure | stress | 1 | descending | 19935 | 0.325 | 2/20 | 0/1 | 0 | 0 | 2 |
| kairosVolumePriceBreakout | structure | stress | 2 | ascending | 19663 | 2.174 | 12/120 | 1/6 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | structure | stress | 2 | descending | 19663 | 2.174 | 12/120 | 1/6 | 0 | 0 | 0 |
| kairosVolumePriceBreakout | structure | stress | 3 | ascending | 19824 | 0.975 | 3/30 | 0/1 | 1 | 0 | 0 |
| kairosVolumePriceBreakout | structure | stress | 3 | descending | 19824 | 0.975 | 3/30 | 0/1 | 1 | 0 | 0 |
| kairosVolatilityContractionBreakout | proxy | base | 1 | ascending | 21748 | 2.092 | 30/150 | 10/12 | 6 | 1 | 2 |
| kairosVolatilityContractionBreakout | proxy | base | 1 | descending | 21849 | 1.469 | 31/155 | 12/13 | 5 | 7 | 3 |
| kairosVolatilityContractionBreakout | proxy | base | 2 | ascending | 21303 | 3.733 | 90/450 | 22/45 | 0 | 8 | 0 |
| kairosVolatilityContractionBreakout | proxy | base | 2 | descending | 21148 | 3.144 | 88/440 | 21/44 | 0 | 8 | 0 |
| kairosVolatilityContractionBreakout | proxy | base | 3 | ascending | 19491 | 6.269 | 61/305 | 14/29 | 3 | 0 | 2 |
| kairosVolatilityContractionBreakout | proxy | base | 3 | descending | 19491 | 6.269 | 61/305 | 14/29 | 3 | 0 | 2 |
| kairosVolatilityContractionBreakout | proxy | stress | 1 | ascending | 21156 | 1.826 | 29/290 | 8/12 | 5 | 2 | 2 |
| kairosVolatilityContractionBreakout | proxy | stress | 1 | descending | 21202 | 1.826 | 29/290 | 9/12 | 5 | 1 | 2 |
| kairosVolatilityContractionBreakout | proxy | stress | 2 | ascending | 20999 | 4.085 | 92/920 | 22/46 | 0 | 9 | 0 |
| kairosVolatilityContractionBreakout | proxy | stress | 2 | descending | 20850 | 3.910 | 90/900 | 21/45 | 0 | 9 | 0 |
| kairosVolatilityContractionBreakout | proxy | stress | 3 | ascending | 18990 | 7.459 | 61/610 | 12/29 | 3 | 0 | 2 |
| kairosVolatilityContractionBreakout | proxy | stress | 3 | descending | 18990 | 7.459 | 61/610 | 12/29 | 3 | 0 | 2 |
| kairosVolatilityContractionBreakout | structure | base | 1 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | base | 1 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | base | 2 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | base | 2 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | base | 3 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | base | 3 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 1 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 1 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 2 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 2 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 3 | ascending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| kairosVolatilityContractionBreakout | structure | stress | 3 | descending | 20000 | 0.000 | 0/0 | 0/0 | 0 | 0 | 0 |
| aSharePullback | proxy | base | 1 | ascending | 21538 | 2.364 | 30/150 | 10/13 | 4 | 0 | 4 |
| aSharePullback | proxy | base | 1 | descending | 21538 | 2.364 | 30/150 | 10/13 | 4 | 0 | 4 |
| aSharePullback | proxy | base | 2 | ascending | 21376 | 5.438 | 106/530 | 27/53 | 0 | 4 | 0 |
| aSharePullback | proxy | base | 2 | descending | 21243 | 5.470 | 106/530 | 27/53 | 0 | 4 | 0 |
| aSharePullback | proxy | base | 3 | ascending | 19712 | 4.588 | 58/290 | 14/28 | 2 | 0 | 0 |
| aSharePullback | proxy | base | 3 | descending | 19712 | 4.588 | 58/290 | 14/28 | 2 | 0 | 0 |
| aSharePullback | proxy | stress | 1 | ascending | 20959 | 2.652 | 27/270 | 8/12 | 3 | 0 | 4 |
| aSharePullback | proxy | stress | 1 | descending | 20959 | 2.652 | 27/270 | 8/12 | 3 | 0 | 4 |
| aSharePullback | proxy | stress | 2 | ascending | 20997 | 4.543 | 110/1100 | 29/55 | 0 | 5 | 0 |
| aSharePullback | proxy | stress | 2 | descending | 20721 | 4.908 | 108/1080 | 28/54 | 0 | 5 | 0 |
| aSharePullback | proxy | stress | 3 | ascending | 19245 | 6.172 | 58/580 | 11/28 | 2 | 0 | 0 |
| aSharePullback | proxy | stress | 3 | descending | 19245 | 6.172 | 58/580 | 11/28 | 2 | 0 | 0 |
| aSharePullback | structure | base | 1 | ascending | 20081 | 0.870 | 5/25 | 1/2 | 1 | 0 | 3 |
| aSharePullback | structure | base | 1 | descending | 20081 | 0.870 | 5/25 | 1/2 | 1 | 0 | 3 |
| aSharePullback | structure | base | 2 | ascending | 20111 | 1.945 | 26/130 | 5/13 | 0 | 0 | 0 |
| aSharePullback | structure | base | 2 | descending | 20111 | 1.945 | 26/130 | 5/13 | 0 | 0 | 0 |
| aSharePullback | structure | base | 3 | ascending | 19084 | 5.215 | 18/90 | 2/9 | 0 | 0 | 0 |
| aSharePullback | structure | base | 3 | descending | 19084 | 5.215 | 18/90 | 2/9 | 0 | 0 | 0 |
| aSharePullback | structure | stress | 1 | ascending | 20035 | 1.005 | 5/50 | 1/2 | 1 | 0 | 3 |
| aSharePullback | structure | stress | 1 | descending | 20035 | 1.005 | 5/50 | 1/2 | 1 | 0 | 3 |
| aSharePullback | structure | stress | 2 | ascending | 19623 | 2.612 | 24/240 | 3/12 | 0 | 0 | 0 |
| aSharePullback | structure | stress | 2 | descending | 19623 | 2.612 | 24/240 | 3/12 | 0 | 0 | 0 |
| aSharePullback | structure | stress | 3 | ascending | 18988 | 5.560 | 18/180 | 1/9 | 0 | 0 | 0 |
| aSharePullback | structure | stress | 3 | descending | 18988 | 5.560 | 18/180 | 1/9 | 0 | 0 | 0 |
