# 模块29：历史排队与工作耗时诊断

> 使用writing-plans编写、executing-plans执行；在模块28上线核验后开始源码修改。

**Goal:** 让现有桥接健康诊断区分历史任务等待名额和占用名额的耗时，为下一交易时段判断服务器瓶颈提供证据。

**Architecture:** HistoryFetchLimiter在原接纳/取得槽/退出边界读取单调时钟，只保留最近和本进程最大排队/工作毫秒。原health.historyScheduler增加timing对象，缺样本为null，不触发新读取/定时器/清缓存或扩大2工作槽/24接纳。

**Tech Stack:** Python单调时钟、pytest受控事件；既有FastAPI只读health。无依赖或新服务。

## 文件与验收

- [x] akshare-bridge/test_history_timing.py：六项新诊断合同旧版因缺字段/注入参数失败；初始null、受控双任务排队1500ms与工作1000/2000ms、来源失败/恢复、排队取消、重复读取与HTTP只读均通过。不将新功能缺失描述成旧业务故障。
- [x] akshare-bridge/research_cache.py：构造允许测试注入now，边界计时保留四个有界值；异常和取消均沿用原计数/传播，无任务或数据量累积。
- [x] akshare-bridge/main.py：原健康接口historyScheduler.timing映射四字段，标明history-limiter/process-lifetime/ms；HTTP测试核对初始null与原预算/计数保持。
- [x] Linux桥接完整六文件177项、固定真实SDK离线契约通过；完整145服务端文件2173项、55前端文件366项与TS/Vite通过，风控/资金不改变。十份受影响文档212个本地链接目标检查通过。
- [x] 更新0049、操作/架构/状态与主计划；29473a2独立提交部署，UTC23:17核验631文件/三健康/可信HTTPS/原账户/检查点/归档世代及上一2579d5b的628文件/三镜像，API/web容器保持。线上原2/24预算、零计数与四项timing null符合休市无样本；实际生产桥接镜像仅挂测试文件、无网络/生产数据挂载177项通过。正常GitHub直连失败后，本次临时SSH通道成功同步，未改变持久代理或凭据。
- [x] 同步核对docs/product/future-optimization.md与roadmap：旧现金/分时总仓位比例明确已替代，旧4笔/八页签/泛化PostgreSQL方向不再当当前事实；保留2026-07真实历史观察和数字，链接0010/0047及当前权威页。该文档清理不改变资金或配置。

## 指标含义

排队是任务被接纳到取得limiter槽的单调区间；工作是持有槽到封装fetcher退出的区间，可能包含共享executor等待、上游网络/SDK，不包括后续normalize/整个HTTP/策略计算。最大值为本进程生命周期，不是P95、SLA或滚动窗口。显式内部取消按封装任务退出计时，不证明底层线程已经停止；普通调用取消已由模块28隔离。健康读取不能改变调度或把缺样本写成0。

本模块增加可观测性，不据单次休市样本宣称加速或扩大容量。真实盘中应结合API事件循环/请求P95、行情来源年龄及pending/rejected判断，核心数据期限与账户门禁保持。
