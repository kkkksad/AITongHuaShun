# 市场 UI、微信简报与期货研判升级执行计划

> **执行要求：** 按任务逐项更新复选框；每项先补验证，再做最小实现，最后运行对应测试。真实行情缺失时不得使用静态数据补位。

**目标：** 修正市场图表的数据语义，提升市场研究 UI 和微信简报可读性，增加真实主连历史驱动的期货研判，并扩大 A 股策略稳健性样本覆盖。

**架构：** 前端继续使用现有 React、TanStack Query、Recharts 和 CSS 设计体系；Fastify 研究层负责可复现的历史条件统计，AkShare 桥接保持只读。微信通知由 formatter 生成经过 HTML 转义的分区正文，WxPusher 客户端只负责发送协议。期货输出是主连连续历史的条件频率，不是校准概率或可交易合约建议。

**技术栈：** React 19、TypeScript、TanStack Query、Recharts、Fastify、Vitest、FastAPI/AkShare。

---

### 任务 1：真实指数日内区间图

**文件：**
- 修改：`src/components/MarketChart.tsx`
- 修改：`src/components/MarketChart.test.ts`
- 修改：`src/styles/index.css`

- [x] 测试真实快照会规范为昨收、开盘、最低、最新、最高和日内位置，不再构造伪时间序列。
- [x] 实现区间轨道、昨收/开盘/最新标记、涨跌状态、准确更新时间和紧凑关键指标。
- [x] 保留无后端数据时明确标注的静态演示图，不把演示数据描述成实时行情。
- [x] 运行 `npm run test:web -- src/components/MarketChart.test.ts`，3 项通过。

### 任务 2：精确、分层的微信 HTML 简报

**文件：**
- 修改：`server/notifications/paperPlanNotifier.ts`
- 修改：`server/notifications/paperPlanNotifier.test.ts`
- 修改：`server/notifications/wxPusherClient.ts`
- 修改：`server/notifications/wxPusherClient.test.ts`

- [x] 测试 `contentType=2`，并验证标题、今日结论、精确动作、动作依据、账户、有效市场证据、数据质量和边界声明分区。
- [x] 导出纯 formatter，统一 HTML 转义；只把真实有效板块放入正文，空值、重复警告和“暂不可用”集中到数据质量区。
- [x] 动作区逐条包含标的、数量、参考价、预计金额和计划原因；无动作时明确给出继续观察原因。
- [x] 通知相关 Vitest 共 13 项通过，SPT 不进入错误或审计内容。

### 任务 3：真实历史驱动的独立期货研判

**文件：**
- 修改：`server/research/crossMarketStrategyContext.ts`
- 修改：`server/research/crossMarketStrategyContext.test.ts`
- 修改：`src/lib/tradingApi.ts`
- 修改：`src/components/FuturesMarketPanel.tsx`
- 修改：`src/components/MarketResearchWorkspace.tsx`
- 修改：`src/styles/index.css`

- [ ] 为每个主连序列测试时间安全的 5 日条件统计：结构、相似样本数、上涨/下跌/震荡频率、中位收益、最大有利/不利幅度和失效条件。
- [ ] 把请求扩大到受控上限 16 个品种和 500 日；样本少于 20 时返回 `insufficient`，不得虚构频率。
- [ ] 将页签升级为“期货研判”，先展示可用研判摘要，再展示完整行情表；空单元格使用 `—`，缺失原因集中显示。
- [ ] 明示主连连续序列、历史条件频率、只读研究、不读取期货账户和不生成订单。
- [ ] 运行服务端研究测试和前端构建，预期通过。

### 任务 4：扩大真实策略验证覆盖

**文件：**
- 修改：`server/research/strategyRobustness.ts`
- 修改：`server/research/strategyRobustness.test.ts`
- 修改：`server/app.ts`
- 修改：`server/app.test.ts`
- 修改：`src/lib/tradingApi.ts`
- 修改：`src/lib/tradingApi.test.ts`
- 修改：`src/components/StrategyRobustnessPanel.tsx`

- [ ] 将真实前复权验证池从最多 8 只扩为 12 只、历史保持 500 日。
- [ ] 在现有 10 个固定参数策略之外增加 MACD、A 股强势回踩、网格和定投四种独立逻辑，共 14 种；仍在三个不重叠窗口验证。
- [ ] 更新 Fastify 查询边界、前端请求和契约测试，并在 UI 显示策略数、标的数和总验证窗口数。
- [ ] 运行策略稳健性、API 契约和客户端测试，预期通过。

### 任务 5：连接恢复状态与 UI 收尾

**文件：**
- 修改：`src/main.tsx`
- 修改：`src/components/FuturesMarketPanel.tsx`
- 修改：`src/styles/index.css`
- 修改：`docs/status/current-state.md`

- [ ] 查询只对网络错误和 5xx 做两次短退避重试，4xx 和认证失败不重试。
- [ ] 刷新失败但已有数据时保留上次成功结果，显示“缓存数据 + 更新时间”，不让整个模块消失。
- [ ] 优化指数卡、页签、研究摘要和移动端表格布局，保证 1440×900 与 390×844 无页面级横向溢出。
- [ ] 运行 `npm test`、`npm run build` 和 Python 测试；浏览器检查市场页桌面与手机截图、控制台和请求状态。
- [ ] 在 `docs/status/current-state.md` 记录当前实现、数据边界和本轮验证结果。
