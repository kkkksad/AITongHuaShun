# 0049：历史调度区分排队与工作区间

日期：2026-11-10（北京时间）。状态：已实现，发布核验见[模块29](../plans/2026-11-10-history-stage-timing.md)。

## 背景

服务器资源空闲不能证明行情或研究没有等待。原历史健康诊断仅有active/pending/accepted/completed/rejected，无法区分等待limiter名额和持有名额期间的耗时。先补可核实区间，才能有依据地调整同机工作预算。

## 决定

HistoryFetchLimiter在原接纳、取得槽、封装fetcher退出三个边界采样单调时钟，只保存最近和本进程最大排队/工作毫秒四个值。未取得过槽的排队指标为null，未结束过工作时工作指标为null；真实0耗时是有效样本，不用0替代未知。

健康接口historyScheduler新增timing：scope=history-limiter、window=process-lifetime、unit=ms，以及lastQueueWaitMs/maxQueueWaitMs/lastWorkMs/maxWorkMs。读stats不采时钟、不启动任务/网络或改变计数，原2工作槽/24接纳和异常传播保持。

工作区间包括fetcher内的executor等待和来源SDK/网络，不包括后续normalize、整个HTTP或策略计算；它不是纯网络时间。最大值为进程生命周期，不是滚动P95或SLA。显式内部取消只测封装任务退出，不证明底层线程已经停止，普通调用取消隔离继续见[0048](0048-history-shared-task-cancellation.md)。

## 验证与代价

六项新诊断合同在旧版因字段/注入时钟能力缺失失败，这是新增观测能力，不把这些失败描述为旧业务逻辑缺陷。新测试覆盖初始null、两任务排队/工作区分、最大值保留、来源失败/恢复、队列取消和只读健康；原171项保持，Linux完整177项通过。

新增每次接纳最多三次单调时钟读取、四个数值状态，不创建定时器、样本列表、线程或数据库。完整应用与实际镜像结果写入模块29，不以休市样本或指标新增声称已提高吞吐。
