# 11月10日盘后策略与加载复盘

> 使用 writing-plans 记录范围，按 executing-plans 在当前工作树执行；先取得今天的证据再决定改动，不恢复已结束的夜间续跑。

**Goal:** 核实11月10日模拟交易及阻塞原因，评估策略和加载优化空间，对可复现的问题实施最小修复并验收。

**Architecture:** 生产账本/SQLite/日志只读收集，行情桥接只读健康及有界测量；策略诊断与真实订单分开。代码修改依证据限定模块，保留现有资金、硬限额和真实执行关闭，账户不得按昨晚零持仓断言重置。

**Tech Stack:** TypeScript/Fastify/React、Python/SQLite、Vitest/pytest、已有归档发布工具。

## 1. 今天的真实证据

- [x] 只读读取生产版本、账本白名单字段、北京时间今日委托/成交、持仓和自动执行审计；按时段/阶段/策略/研究降级/跳过原因聚合，保留样本覆盖限制。
- [x] 只读SQLite核对本日145条运行与账本一致，归档完整性ok、账户世代保持；收集账本摘要，没有触发自动执行或测试通知。读取为只读连接，未为本次核对创建数据库副本。
- [x] 4笔买本金8258/买佣金20/现金11722；盘后报价估值权益19939、净变动-61，明确不是官方收盘或闭合胜率。

## 2. 加载证据与根因

- [x] 核对服务资源、桥接排队/工作/缓存/报价年龄和页面请求依赖；静态压缩沿用今晨实际公网证据。本轮没有诊断会话，不伪造受保护性能端点或全日P95。
- [x] 阅读 `src/pages/MarketPage.tsx`、`src/components/MarketResearchWorkspace.tsx`、`src/components/LearningPipeline.tsx`、`src/lib/researchQueries.ts`；发现轻量每日复盘被昂贵研究阻塞，计划错峰依赖保持。
- [x] 阅读 `server/research/paperTradingPlanService.ts`、`server/trading/paperAutoExecutor.ts`、`server/research/paperTradingPlan.ts` 和 `strategyLeaderboardService.ts`；记录合成榜关键依赖、已有持仓不重复加仓及记录间隔限制，没有把106.55秒全部当作计算耗时。

## 3. 有证据的修复和交付

- [x] 四项交互回归旧版全部失败，最小修复后全部通过；未调参或修改后端执行代码。
- [x] 完整56文件370项前端、TypeScript及Vite通过；初次并行构建下两项既有导航失败，独立9项和完整重跑370项均通过，未改导航测试或源码。
- [x] 复盘写入 `docs/research/2026-11-10-session-strategy-loading-review.md`，状态与产品范围同步。

发布验收：本包独立提交推送部署，核对新版本/健康/HTTPS/匿名保护及今天四持仓/四订单经济摘要保持。最终发布结果记录在本轮聊天与忽略的runtime回执，不为把自身SHA写进文档循环发布。

## 初始发现

盘后只读归档已报告4笔订单、330次归档执行记录，三个容器均持续健康，生产账本尚待逐笔核对。4笔订单不能在读取成交状态前描述为4笔成交，也不能直接当成完整周期收益或胜率。

## 已确认的小范围加载修复

`server/app.ts` 的每日复盘仅从当前快照、账户和审计生成，不依赖策略榜或候选网络请求；但 `LearningPipeline.tsx` 将它的enabled与两项昂贵请求的isFetched绑定。初次进入时任何一个研究请求一直未完成，已有成交记录也无法加载。

- [x] 新建 `src/components/LearningPipeline.dailyLoading.test.tsx`，真实QueryClient/组件配合受控promise，验证研究挂起、独立失败、60秒刷新及卸载取消；原纸面计划错峰门槛保持。
- [x] 四项旧版全部失败后仅移除每日复盘enabled依赖，直接共享查询配置，不改网络超时、刷新频率或交易代码。
- [x] 新四项、全部370前端、TS/Vite通过，既有测试夹具和断言无需修改。
- [x] 部署前保存今天现金11722/四持仓/四订单及完整经济摘要；发布验收按该摘要对比，不运行昨晚空仓不变量脚本。
