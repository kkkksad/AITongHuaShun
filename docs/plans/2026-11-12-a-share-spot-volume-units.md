# A股发现快照成交量单位修复

> 使用writing-plans制定，由executing-plans在当前工作树逐项执行；前置17d1dfc实际生产API全套/完整发布保护和一次回执完成后才修改运行源码。

**Goal:** 消除东财发现快照“手”和新浪/腾讯快照“股”混用，使同一流动性不因回退来源改变100倍；保留来源价格、金额、时间和缺失时效限制。

**Architecture:** 仅在akshare-bridge/main.py的fetch_a_share_spot_dataframe取得eastmoney结果后，把副本成交量列按已核实合同×100转换成股，再交原QuoteCache解析。新浪a-share-spot及手工腾讯parser已经是股，原对象与读取次数保持。只改发现快照，不改指定报价/指数/港股/期货/日线/调度和下单接口；历史仍来源原单位，研究报告不得假设其已经统一。

**Tech Stack:** Python/pandas/pytest、实际生产AkShare1.20.34源码只读审计、现有完整桥接与后端测试、部署隔离Linux。

## 来源证据与范围

- 官方[stock_quote](https://akshare.akfamily.xyz/data/stock/stock_quote.html)明确stock_zh_a_spot_em成交量手/金额元，stock_zh_a_spot成交量股/金额元。生产容器只读inspect确认1.20.34的东财无转换、新浪原float股数，腾讯现有parser显式手×100；不能按本机旧版本推断生产SDK。
- 材料runtime/2026-11-12-{spot-volume-provider-docs.txt,production-history-sdk.json}；只含公开SDK源码，无凭据/账户。日线东财手、生产腾讯历史已股，两来源日线合同统一另案，不在本项改数据尺度。
- 手→股只做一次，对原DataFrame不变；每次原函数重复返回同一夹具时得到同值，不乘两次。成交额、turnover%、updatedAt/缺失值和原source属性不改。无成交量列的东财正文为合同失败并按原fallback，不能返回虚假0流动性。
- 东财有限非负数字含数字字符串安全转换，非数字/NaN/负值/溢出不可制造大流动性；原解析器对非法量的跳过保持，不将坏字段猜成成交量。不因单位修正补造来源时间或交易权限。

## 执行步骤

- [ ] akshare-bridge/test_bridge.py先写业务反例：同一东财50000手和新浪/腾讯5000000股进入QuoteCache应同值；东财旧版100倍失败、两fallback控制通过。复制不改原df、重复不累乘、价额/换手/来源时点保持、坏列回退与非法量不放大、缺时间仍不可交易。
- [ ] main.py仅eastmoney fetch分支最小转换；复用pd.to_numeric和副本，不重构其他源或改成交量阈值。目标pytest和完整Python桥接全套本地/Linux；桥接变化后跑相应后端全套/TS/Vite，不重跑无关前端或固定策略样本。
- [ ] 用明确合成供应方夹具逐字段对照规范化前后，量外全部字段与新浪/腾讯完整保持。只读生产现有快照/健康检查，不触发全市场额外抓取或生产策略，不宣称此前亏损由此造成。
- [ ] docs/decisions新增合同修复记录、状态/运维/总流水更新；独立提交推送部署，实际生产桥接全套及已测API镜像保持、SHA/归档字节/三健康/可信HTTPS/401、动态经济与完整风险摘要/上一发布材料通过，再一次文档回执核验三容器保持。

UTC21:40登记，距离UTC23:40复杂代码/发布冻结约两小时，UTC00:00硬截止保持。如来源合同无法复现，保留未知和只读研究，不据此放宽资格或造单。
