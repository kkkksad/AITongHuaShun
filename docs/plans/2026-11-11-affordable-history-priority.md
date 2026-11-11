# 可买整手候选历史优先执行计划

> **For agentic workers:** 使用 executing-plans 在当前会话执行，遵循总计划逐模块部署检查点。

**Goal:** 持仓始终优先，随后把硬限额内至少能买一手的候选放到不可能买一手的候选之前，减少6/12个历史名额被高价股占用。

**Architecture:** `buildPreferredHistoricalStocks`接受可选只读入场预算，使用现有`executionCosts`投影一手费用。保持扫描器交错、分层顺序、去重和上限；不可买标的仍作末尾补位。预算只决定研究顺序，不授予交易资格，后续计划和Broker仍重新核验市场缩放和风控。

**Tech Stack:** TypeScript、Vitest。

**Files:**
- Modify: `server/research/paperTradingPlanService.ts`
- Test: `server/research/paperTradingPlanService.test.ts`
- Test: `server/research/paperTradingPlanService.scheduling.test.ts`
- Create: `docs/decisions/0078-affordable-lots-prioritize-paper-history.md`
- Modify: `docs/product/overview.md`, `docs/status/current-state.md`

- [ ] 在选择器测试中构造两只不可买高分股、一只可买低分股和一只高价持仓，验证持仓和可买候选先入池；旧实现应先选高价候选而失败。
- [ ] 加入100股费用边界、滑点后超单笔、费用后超仓位、可买观察股先于不可买买入候选、无可买时保留补位与双扫描去重测试。
- [ ] 用调度服务测试验证实际传入账户/风险/佣金/滑点预算；拒绝仅测试未接入的纯函数。
- [ ] 实现可选预算分组：`positions, feasibleActionable, feasibleWatch, remainingActionable, remainingWatch`。相同组仍按原双扫描器交错，无预算调用兼容原顺序。
- [ ] 运行目标测试并确认通过：

```powershell
node node_modules/vitest/vitest.mjs run --dir server --environment node server/research/paperTradingPlanService.test.ts server/research/paperTradingPlanService.scheduling.test.ts server/research/paperTradingPlanService.timeBoundary.test.ts
```

- [ ] 运行服务端全套、TypeScript、Vite；同模块未改共享前端契约或页面，不把旧前端测试称为新结果。
- [ ] 更新文档、提交推送、部署并按总计划核验。保存实际前后研究选择（同一冻结盘后行情），不可将新增覆盖称为新增成交或胜率改善。

## 证据与限制

UTC16:12验证：九项新测试中七项旧版失败；目标54项、169文件2583项服务端（限制两worker）、TS/Vite通过。默认并发首次一项scrypt认证超时，完整受限复跑通过，未改超时/断言。冻结盘后扫描五项替换、三持仓保持；前端/Python无改动。下一步提交推送部署与动态账户核验。

UTC16:52：715c960已推送部署核验，705文件/三健康/匿名401/健康200通过，账户经济摘要与检查点严格保持，上一2c2f4a0源码/三镜像/私有导出通过。模块完成；此收尾流水随下一模块归档发布。

UTC15:31盘后只读诊断覆盖60只唯一候选，12个历史名额包含浪潮信息56.56、中微公司250、北方华创547.91、中芯国际109.31和阳光电源80.09等；部分一手本金超过账户单笔上限。该诊断使用盘后行情和当日完整日线，不能倒推盘中同样选择或因果。今天31次运行有合格新股，其中30次无可成整手，另一次中国中车100股641元被往返最低佣金1%门槛阻止；公开审计前8条截断不能完整解释其他30次。
