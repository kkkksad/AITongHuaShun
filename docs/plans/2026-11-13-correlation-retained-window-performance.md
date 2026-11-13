# 相关性保留窗口比较开销执行计划

> 当前聊天使用writing-plans、executing-plans和kairos-performance-debugging实施总计划F；单模块顺序执行，不并行修改共享代码。

**Goal:** 减少相关性诊断对保留窗口外日期的重复比较，完整保持时间边界、坏行屏障和所有输出。

**Architecture:** 仅在historicalCorrelation.ts构造rejectedDates时裁剪不可能位于保留相邻区间内部的日期。原始响应、校验器、窗口内部拒绝日期屏障保持，无新缓存/请求/并发/接口，不读取结果调整买卖。

**Tech Stack:** TypeScript、现有Vitest、esbuild隔离新旧完整分析、原Docker发布验证。

## 已测事实与假设

上个模块文档回执097ec8a已UTC17:13推送/部署/882文件全保护验收，三个已测容器镜像保持，无在途测试或发布。

UTC17:06四次实际匿名登录表单2662/2392.5/1225.8/1248.3ms，四JS、约159730字节；禁缓存/绕SW、未限速、未登录，上游冷热未知，不估生产P95。239条旧盘中审计研究中位71.51/P95 1100.641ms，不代表新增诊断上线后的运行。

原函数把因maxBars裁剪的旧日期加入rejectedDates，每个相邻区间重复some比较；窗口外日期不可能位于任何保留区间内部。固定12股各500行/180预算的内存候选已有96组完整结果/输入保持、30次交替中位18.43→15.70ms，仅为纯函数CPU；runtime/2026-11-13-correlation-pruning-profile.json。源码尚未改动。

## Task 1：最小实现与边界

文件：server/research/historicalCorrelation.ts。

- [x] 保留validDates及原始拒绝日期构造，增加边界裁剪，完整实现如下：

~~~ts
const firstDate = item.bars[0]?.date, lastDate = item.bars.at(-1)?.date;
const rejectedDates = [...new Set(input.find(source => source && source.symbol === item.symbol)!.bars
  .filter(bar => bar && typeof bar.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && !validDates.has(bar.date))
  .map(bar => bar.date))].filter(date => firstDate !== undefined && lastDate !== undefined &&
    firstDate < date && date < lastDate);
~~~

- [x] 不改Pearson、120/60门槛、起止配对、正量端点、maxCalendarSpanDays、警告和排序。0/1根没有区间；窗口内坏/重复日期继续阻断。性能不写脆弱毫秒断言，不新增镜像实现的测试；已有功能检查旧版本就应通过，不造旧版功能失败。
- [x] 目标命令：node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/historicalCorrelation.test.ts server/research/marketRegimeResearch.correlation.test.ts server/research/paperPortfolioRisk.test.ts --maxWorkers=2 --minWorkers=1。预期原业务边界全部通过。

## Task 2：完整比较与CPU测量

- [x] 分别编译git097ec8a旧函数和真实改后函数；8预算×12场景96组完整输出及原输入保持，含窗口内非法价格/重复、未来、零量、常数、空、逆序、联合缺失和身份重复。
- [x] 两个实现分别用于完整analyzeMarketRegimeData，4预算×8正常/异常场景32组比较全部报告及原输入，不删除新诊断字段。冻结输入SHA32fc7da6789ebcd55660f7b031d036ad070e09b3baa8d919c8391350f9963d01。先暖机再交替30次，分报纯函数和完整同步分析CPU，不冒充HTTP/并发负载或策略收益。
- [x] 单Vitest完整server、TS/Vite；前端460/Python308/归档41为代码未改继承。
- [ ] 上线后实际新API镜像禁网完整server验证，无生产账户/凭据挂载。

## Task 3：文档与逐模块发布

- [x] 新增docs/decisions/0121-correlation-rejected-dates-inside-retained-window.md；更新状态、架构和总计划，记录实际测量及限制。
- [ ] 新鲜完整经济/风险/三容器基线，独立提交推送exit0、干净HEAD=upstream后用现有helper部署。
- [ ] 核验实际归档字节/哈希/SHA、三健康/可信双域HTTPS/匿名401、完整经济/风险摘要、上一097ec8a源码/三镜像/私有导出与覆盖拒绝、桥接保持及实际API禁网全套。
- [ ] 单次文档回执后确认三个已测容器保持，不递归回执，再接续E/I/H。UTC23:40冻结/00:00截止不变。

## 流水

- UTC17:13登记，内存试验不等于已改源码或上线。公开页面及桥接健康只读测量前后完整经济、风险及容器身份保持，runtime/2026-11-13-performance-readonly-summary.json。

- UTC17:20本地目标3文件47项旧/新均通过、完整194文件3213后端（71.39秒）、server/app TS及Vite通过。96纯函数与32完整分析/输入保持；实际源码交替30次中位20.0014→16.06335ms、完整分析48.58175→45.5345ms。原47项已涵盖主要业务边界，没有新增低价值计时单测。源码尚待独立发布。
