# 股票与指数非有限字段隔离

> 使用writing-plans制定，executing-plans按项执行。前置e28ce8b回执847文件/全部保护与已测三容器保持已UTC22:26核验。

**Goal:** 单只股票核心价格为NaN/无限值，或可选量价字段非有限时，不能污染整批JSON响应或将非法数据当可交易；合法邻股继续可读。

**Architecture:** QuoteCache/IndexCache在已有逐行解析中仅检查price/previousClose/changePercent为有限数，不有限则跳行。两个_safe_float对非有限数返回None，沿原可选字段未知语义；原零值→None保持。只改这两个解析入口，原有效值、时间/数量、来源回退/缓存调度/期限/权限不变。必要字段仍有限但为零的既有语义不在本项改变。

**Tech Stack:** Python/pandas/pytest/Starlette JSONResponse、现有腾讯指定报价复用QuoteCache解析、实际Linux同版桥接与后端全套/TS/Vite。

- [x] 先业务反例：两个cache的三核心字段NaN/正负无限，非法行跳过、合法邻股保留；可选open/high/low/amount/turnover（股票）/amplitude非有限为None，有限/零/缺失控制。用实际QuotesResponse与JSONResponse验证可序列化，不仅断言内部值；不补来源时间，指数只读保持。
- [x] 最小有限检查与可选转换，无新全市场抓取、无广泛模型重构；腾讯指定报价经原parser受保护的路径控制。完整本地/Linux桥接及后端全套/TS/Vite，无资金/策略/研究改动，不重复无关冻结研究/前端。
- [ ] 更新决策/状态/运维/总流水，独立提交推送exit0后部署；实际生产桥接全套、已测API/网页保持及全部发布保护/动态经济和完整风险摘要/上一材料，再一次文档回执。

UTC22:28登记。仅合成反例可证实代码问题，不能称生产当天实际发生或导致旧亏损。UTC23:40新复杂代码/发布冻结，UTC00:00硬截止保持。

UTC22:33：30新增在HEAD隔离旧源码全部失败，包含严格JSONResponse抛ValueError与真实指定报价HTTP返回核心坏股，后者部分框架会序列化null，不能一概称HTTP500。首轮整数dtype夹具注入inf自身错误已纠正，最终同一float夹具旧版30失败；修复后本地272/1跳过、Linux273、完整191文件3137后端（114.65秒）与TS/Vite通过。仅8行解析变化，无策略/资金/并发/来源时间变化；先独立推送发布/实际桥接全套与全部保护、一次回执，再实际等待及截止交付核对。

UTC22:35：源码b72e53944c772e16bad8bdb7fe9bf5d1ff391e9a已推送exit0后独立部署，849文件/三健康/双域可信HTTPS/匿名401/动态经济与完整风险摘要、上一e28ce8b源码/三镜像/私有导出核验通过。实际生产桥接禁网273项全通过，已测API/网页容器镜像保持。一次回执并核对三容器后按[最终运行证据计划](2026-11-12-final-runtime-evidence-review.md)接续只读等待/队列与未完成项，不制造生产流量或新策略样本。
