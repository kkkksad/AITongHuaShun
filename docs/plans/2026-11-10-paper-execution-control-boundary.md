# 模块23：异步Paper计划的账户控制边界

> 使用writing-plans规划、executing-plans在当前工作区逐项执行。用户已授权连续升级、提交和部署，沿用既有检查点，不另行等待执行选择。

**Goal:** 研究或通知等待期间发生账户重置、策略/档位切换、暂停恢复或执行器停止时，旧轮次不得继续提交模拟订单。

**Architecture:** 两种Store提供只在当前进程内生效的执行控制修订号，成功的控制变化和每次重置递增，相同值重复设置保持不变；JSON失败回滚同时恢复修订号。研究服务和执行器在异步边界检查，账户资金变化和自身成交不属于该控制修订，逐笔风险检查保持。

**Tech Stack:** TypeScript、Vitest、真实PaperBroker、内存与JSON Store；无新增服务或生产测试订单。

## 文件与步骤

- `server/contracts/TradingStore.ts`、两个Store：新增`getExecutionRevision(): number`；setPaused/setStrategyProfile/setExecutionStrategy的实际变化与resetAccount递增；修订不写盘、不向浏览器暴露，重启没有旧Promise。
- `server/trading/paperExecutionContext.ts`：带409状态的固定中文失效错误；服务/执行器共用。
- `server/research/paperTradingPlanService.ts`：捕获开始修订，研究完成后、记录研究及生成计划前检查。
- `server/trading/paperAutoExecutor.ts`：捕获开始修订与生命周期，研究返回和每笔提交前检查；停止当前轮后不因恢复操作复活；失效明确watch-only，保留已发生的真实模拟成交。
- 新增双Store控制测试与执行器回归，研究服务新增等待中控制变化案例；覆盖相同值、ABA、同额重置、写盘失败、未改变时正常双笔及自身成交不误停。
- 文档：0043、产品/架构/安全/状态及主计划记录边界与验证限制。

## 可验证顺序

- [x] 新业务回归先在旧代码运行：在研究Promise或通知Promise中改变真实Store，旧版出现订单即证明失效；不把缺少新方法的错误作为全部业务证据。
- [x] 最小修复Store与JSON原子回滚。用`const before = store.getExecutionRevision(); store.setPaused(true); store.setPaused(false); expect(store.getExecutionRevision()).toBeGreaterThan(before)`确认ABA被识别。
- [x] 服务与执行器边界实现，运行目标回归；同值设置不取消，恢复后新轮次可运行；`stop()`后的在途任务不再提交。
- [x] 运行完整服务端/前端、TS/Vite、空白检查；更新证据后独立提交、推送、部署另见下一项发布核验。
- [ ] 生产只读验证SHA/HTTPS/健康/匿名保护、原20000账户/风险检查点/归档世代、上一发布留存；生产镜像隔离运行目标回归，不触发生产订单或通知。

命令：`node node_modules/vitest/vitest.mjs run --dir server server/trading/paperAutoExecutor.controlBoundary.test.ts server/store/executionRevision.test.ts server/research/paperTradingPlanService.test.ts --environment node --maxWorkers=1 --minWorkers=1`。旧版预期控制变化案例失败，修复后全部通过。全套命令沿用主计划，显式`--dir server`/`--dir src`且串行Vitest。

## 范围

修订号只用于当前进程的控制失效，不是资金流水版本、数据库事务号或多市场账户隔离。正常成交/估值不使轮次失效；现金/挂单/风险变化仍由原Broker重查。已经发往通知提供方的消息无法撤回，停止也不回滚已成交订单。

## 验证记录

旧版执行器28项中26失败，均出现旧计划提交，普通未变控制案例两种Store通过；服务4项旧版全失败，返回了已过时的计划。最终执行器扩为30项，包含第一笔已成交后设置变化不撤销该笔；Store7项、JSON原子19项、研究调度11项合计67项通过。

首次完整142文件2149通过/1失败，唯一新HTTP断言比较了两次实时updatedAt，资金未变；将该夹具改为注入固定时钟，认证/no-store/409与账户不变回归通过，未修改生产时间或账户字段。固定后目标三文件38项与TS/Vite通过，完整复跑结果随后记录。

固定时钟后完整服务端142文件2150项通过，无生产测试操作。前端与最终发布核验继续中。

完整55前端文件366项、TS/Vite与空白检查通过。此模块没有页面结构变化，不重复运行浏览器布局夹具；HTTP真实Fastify验证认证/no-store/409。独立提交推送部署后再记录生产事实。
