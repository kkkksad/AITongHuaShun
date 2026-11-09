# 模块24：研究复用与读取并发上限

> 使用writing-plans规划、executing-plans在当前任务逐项执行。上一模块完成上线核验后开始源码修改，沿用用户授权逐模块提交部署。

**Goal:** 缓存满载时仍共享已在途的研究；超量新任务明确等待后续读取，避免无限启动计算或网络请求。

**Architecture:** ResearchResultCache保留未完成条目，只淘汰完成条目；每个实例的在途数在clear之后也继续计数。Bridge读取增加独立64个实际请求上限，命中缓存不占新槽，包含不缓存请求，clear不释放仍在途的槽。两层均无新等待队列，成功/失败后自动释放；行情快通道不共用研究槽。

**Tech Stack:** Node/TypeScript、Promise、现有Fastify错误处理和Vitest；不增加数据库、线程、进程或外部端口。

## 文件职责

- `server/research/researchCapacity.ts`：固定中文、无URL/凭据的`ResearchCapacityError`，503状态。
- `server/research/researchResultCache.ts`：在途引用不被容量淘汰，活动Set与缓存清理分离；成功/失败/TTL函数抛错都释放，失败不残留永久拒绝Promise。
- `server/research/bridgeRequest.ts`：全局64个实际读取请求预算；超过预算抛`BridgeRequestError(code="capacity")`且不调用fetch、不启动定时器，原64项缓存/TTL/token隔离保持。
- `server/app.ts`：计算容量耗尽返回受认证/no-store的503可重试说明。
- 两个已有测试文件及新增`app.researchCapacity.test.ts`：容量/同key复用、满槽拒绝、槽释放、clear期间预算、完成项淘汰、TTL失败重试和真实HTTP。
- 0044及架构/开发手册/状态/主计划：明确是资源保护、没有生产吞吐或盘中效果结论。

## 实施与验收

- [x] 在旧代码复现：2个活动任务后第3个应不启动，重读第1个只启动一次；64个桥接请求后第65个不得fetch。新业务断言先失败，不以缺少新错误类导入作为复现。
- [x] 最小实现Promise生命周期保护。核心断言为`expect(createA).toHaveBeenCalledTimes(1)`、`expect(fetchImpl).toHaveBeenCalledTimes(64)`；满载请求的拒绝立即被测试观察，全部旧任务最终settle并检查恢复。
- [x] 覆盖成功/异常释放、clear不清活动计数、同key缓存命中和凭据分区；TTL求值抛错后同key可重新计算。保留原TTL/旧响应失效规则。
- [x] 新HTTP回归认证401且不进入builder，已认证满载503/no-store且无账户/订单变化；源读取容量不足通过既有降级说明展示。
- [x] 目标与完整服务端/前端、TS/Vite、空白检查通过；独立提交推送部署及生产核验见下一项。
- [x] 生产只读核验SHA/健康/HTTPS/匿名保护/原账户/风险检查点/归档世代/上一发布；生产镜像无网络/无生产挂载下目标测试，不对生产接口施压。

目标命令：`node node_modules/vitest/vitest.mjs run --dir server server/research/researchResultCache.test.ts server/research/bridgeRequest.test.ts server/app.researchCapacity.test.ts --environment node --maxWorkers=1 --minWorkers=1`。初始容量断言预期失败，修复后通过。完整检查沿用主计划，Vitest不并行运行。

## 范围与取舍

64是全Node进程的研究HTTP预算，未按来源或账号分片，缓存满时不排队也不立即重试；实际桥接仍有自己的2工作槽/24队列。Research缓存预算是封装Promise数量，不是供应商底层线程数，deadline后的底层取消由既有HTTP超时处理。它不提高策略资格或交易数量，不把休市资源样本当盘中容量测试。

## 验证记录

旧版新增7项业务断言全部失败，复现活动计算被淘汰/重复、clear绕过活动预算、TTL抛错永久缓存以及无缓存/有缓存的第65个真实fetch继续启动。第一次完成项淘汰夹具没有共享同一deferred，修正夹具后重复旧版确认第7项失败，未修改生产代码来迎合旧断言。

最终Cache10项、Bridge19项、HTTP1项与既有排行榜18/调度11项合计59项通过；包含64个AbortSignal实际超时、满槽不创建第65个timer、全部释放后恢复，以及clear后旧成功/失败不覆盖新结果。最初HTTP夹具选中了自带200降级的排行榜接口，改为没有该fallback的实际计划接口验证503；排行榜原降级合同保持。TS/Vite通过，完整回归继续中。

完整143服务端文件2161项、55前端文件366项、TS/Vite及空白检查通过。UTC22:22休市只读采样4核、可用2546343936字节、同盘剩6668300288字节；三个服务低负载。没有压力测试生产或清理镜像，也不把共享层Docker统计相加当可释放空间。

`10efcc270cd77bee33c6a77daf8eef4b93c1d60e`已独立部署，UTC22:27核验616文件/三健康/HTTPS/匿名保护、原20000账户/检查点/归档世代保持；上一eb299fa的612文件/三镜像及私有导出保护通过。SQLite209运行/85样本、integrity ok、分钟摘要published。实际Linux生产镜像无网络/无生产挂载五文件59项通过，没有生产施压或订单。GitHub直连及临时SSH通道初次失败，UTC22:29同origin正常推送成功，分支已同步10efcc2。
