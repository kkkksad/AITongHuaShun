# 模块28：历史缓存调用取消隔离

> 使用writing-plans规划、executing-plans执行。模块27已完成线上只读核验后开始源码修改。

**Goal:** 同一历史序列的一个等待者取消或超时，不取消其他等待者共享的实际读取，也不提前释放历史调度预算。

**Architecture:** ResearchHistoryCache冷读当前直接await共享Task；Python取消会传播至该Task，其他调用一起被取消，run_in_executor实际线程却可能继续运行。只在冷读等待边界加入asyncio.shield，调用方仍收到自己的取消/超时，原任务继续预热并按真实完成释放预算。

**Tech Stack:** Python asyncio、现有缓存与HistoryFetchLimiter；pytest使用受控Event与真实隔离ThreadPoolExecutor，不新增生产线程。

## 当前范围

这是现有内部缓存API的取消传播缺陷，不宣称当前HTTP断开一定会取消fetch_one：主桥接批次使用asyncio.wait且不主动取消子任务。原有显式clear仍取消缓存任务，底层运行线程的终止仍靠来源网络期限；本模块不改变clear、上游超时、2工作槽/24接纳或请求截止策略。

## 文件与步骤

- [x] 新建akshare-bridge/test_history_cancellation.py：首个等待者取消、wait_for超时、来源失败/重试、真实executor限流槽、全部调用退出仍预热五项在旧版全失败，原166项保持。
- [x] akshare-bridge/research_cache.py：冷读改为return await asyncio.shield(task)，注明共享任务不属于单一调用方；其他缓存和调度实现保持。Linux完整171项通过，真实SDK离线契约保持。
- [x] Linux完整桥接五测试文件171项通过；真实SDK离线契约保持，来源/时间与TTL不改变。完整145服务端文件2173项、55前端文件366项与TS/Vite通过，不放宽订单条件。
- [ ] 0048/架构/操作文档/状态与主计划记录精确范围；独立提交推送、同SHA部署及健康/HTTPS/原账户/检查点/归档/上一发布核验。
- [ ] 实际生产桥接镜像仅挂五测试文件，PYTHONPATH=/app、无网络/生产挂载复跑，不能把源码挂载结果冒充镜像实现。

## 验收细节

取消者本身仍立即收到CancelledError或TimeoutError；另一等待者得到原值或原始来源错误，而不是取消。真实线程未完成时active仍为1、另一个key只排队且超额key拒绝；释放事件后原任务结束并缓存，后续命中不再次调用来源。失败结果不进健康缓存且后续可重试。所有测试使用可结束的受控事件并在finally释放/回收，不依赖公网或制造生产交易。
