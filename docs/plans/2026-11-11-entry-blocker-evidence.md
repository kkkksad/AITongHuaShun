# 新建仓位阻塞证据计划

> **For agentic workers:** 使用 executing-plans 逐项验证并独立发布。

**Goal:** 明确区分未覆盖历史、有效日线不足、趋势恶化与未命中规则，并避免前八条持仓观察挤掉关键阻塞证据。

**Architecture:** 保留原strategy-route规则及交易行为，新增只读固定说明；审计采样固定八条，先blocked再observe/hold，同优先级先保留不同原因再补位，明确完整数和省略数。完整运行仍保留原顺序，不影响订单额度、签名或风险检查。

**Tech Stack:** TypeScript/Vitest。

**Files:**
- Modify: `server/research/paperTradingPlan.ts`, `server/research/paperTradingPlan.adaptive.test.ts`
- Create: `server/trading/paperSkipEvidence.ts`, `server/trading/paperSkipEvidence.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`, `server/trading/paperAutoExecutor.executionTime.test.ts`
- Modify: `docs/product/overview.md`, `docs/status/current-state.md`

- [x] 在完整计划回归中覆盖缺个股历史、insufficient-data、trend-deterioration、合法历史但无信号四种不同解释；保留无买单及旧规则。
- [x] 审计选择回归构造四持仓+九同原因信号阻塞+末尾一个金额阻塞，必须在八条内保留金额原因；稳定、上限、空输入、白名单及输入不变。
- [x] 实际Executor审计接入验证采样字段与计数，不仅测试纯函数；完整运行skippedOperations保持原序列，无订单副作用。
- [x] 目标回归通过后运行完整服务端、TS/Vite；未改前端契约不声称重跑前端，更新产品与状态说明，独立提交推送部署核验。

## 原因

UTC18:26：四个完整计划反例与一个实际Executor反例旧版均失败（选择器旧文件不存在）；实现后目标116项与TS/Vite通过，完整后端检查中。前端/Python无行为改动，决策0080保存取样与不回填边界。

UTC18:29：完整171文件2600服务端项通过（两worker），TS/Vite通过；双域可信HTTPS健康200。准备提交部署，经济摘要仍按动态前后核验。

UTC18:35：`2e82bd0218f60da6680c413b0df170330bbce756`部署核验713归档文件/三健康/健康200/匿名业务401，Paper+AkShare/认证开/真实执行关闭；双域可信HTTPS200。经济摘要与检查点逐字保持：现金13992、3持仓、5单。上一0471b5a的709源码/三镜像/私有导出独立匹配，exportVerified/overwriteRefused均true。直连多次超时后，通过临时SSH代理、当次DNS美国入口、schannel且保留TLS校验推送成功；未改全局DNS或git配置。

今天30次有合格新股却无法整手，审计只保留前八条，大量持仓hold和其他候选未命中挤掉了具体限制；旧记录无法补造。当前候选没有历史也被统一解释为“无合格信号”，不能区分未研究和已研究失败。本模块补未来诊断证据，不回填今天缺失事实或调整策略门槛。
