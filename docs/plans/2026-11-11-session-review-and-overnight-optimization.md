# 11月11日交易复盘与夜间优化执行计划

> **For agentic workers:** 使用 executing-plans 在当前工作树逐项执行；每个代码模块独立验证、提交、部署后再进入下一模块。

**Goal:** 查清11月11日Paper无新买入的实际原因，修复可复现缺陷并测量研究和页面等待，持续到北京时间2026年11月12日08:00。

**Architecture:** 从生产账本、审计和只读行情取得证据，隔离诊断不构造Broker或写入Store。策略改变先用固定历史和成本检验；研究/模拟结果与实际Paper成交分开记录。沿用现有JSON交易主账本和SQLite复盘副本。

**Tech Stack:** TypeScript/Node、React、Vitest、Vite、Python/AkShare、Docker Compose。

## 范围与时间

- 工作树：`C:/Users/kjq/.codex/worktrees/overnight-optimization/AI量化`。
- 分支：`codex/overnight-optimization-2026-11-05`；本轮基线：`2c2f4a01f815500e18025236bd192a838b94aea8`。
- 截止：北京时间11月12日08:00（UTC11月12日00:00）。UTC11月11日23:40起停止新复杂代码和新发布，保留最终核验时间。
- 当前账户：本金20000、现金13992、三只银行持仓、累计五笔成交；每次发布另取动态经济摘要，不使用旧空仓或昨日断言。
- 保留Paper模式、真实执行关闭、零固定现金预留及费用/整手/T+1/硬限额。不重置账户、不人为造单、不手动触发生产执行或测试通知。

## Task 1：完整复盘和只读根因证据

**Files:**
- Create: `runtime/read-nov11-diagnostics.py`（忽略目录，私有诊断）
- Create: `docs/research/2026-11-11-session-strategy-loading-review.md`
- Read: `server/research/paperTradingPlanService.ts`, `paperTradingPlan.ts`, `adaptiveCandidateStrategy.ts`, `marketRegimeResearch.ts`, `researchInputDiagnostics.ts`

- [x] 核对部署SHA、真实执行开关、账户世代和当天成交；11月11日唯一新成交为中国建筑500股4.55卖出，闭合周期含费损失80元。
- [ ] 从同一日全部保留审计计算单轮各阶段耗时、样本覆盖、连续记录间隔、新标的漏斗及市场路由分布；统计规则出现次数不能当拒单数。
- [ ] 通过只读研究接口核对警告类别、历史覆盖和候选优先级。诊断使用真实持仓和费用约束，不复用旧空账户facade。
- [ ] 写入复盘：区分已证实代码问题、策略不满足与数据缺口；一个闭合样本不能推断胜率。

执行：`node runtime/ssh-python.cjs runtime/read-nov11-diagnostics.py`。结果保存到忽略目录；公开文档仅包含白名单汇总，不包含凭据、原始供应商URL或完整账户标识。

## Task 2：修复已复现的交易链路问题

按Task 1证据建立单模块子计划。优先检查历史选择与候选排名覆盖、策略资格的不可达分支、来源警告的实际影响和观察/待确认原因。每个模块：

- [ ] 在对应`server/research/*.test.ts`中加入真实业务反例并先跑失败；策略例需保留市场条件、历史时间边界、报价、成本和整手限制。
- [ ] 最小修复并运行目标回归；不得通过降低风控或编造成交来使测试通过。
- [ ] 涉及共享契约/资金运行服务端与前端全套，单次仅一个Vitest，显式`--dir server --environment node`或`--dir src --environment jsdom`；运行TypeScript与Vite。
- [ ] 更新受影响权威文档，长期语义写入`docs/decisions/`。
- [ ] 独立提交、推送、部署，核对归档字节、SHA、三健康、可信HTTPS、匿名401、账户经济摘要与上一发布材料。

## Task 3：研究等待与页面性能

**Files:** 从Task 1耗时证据选择`server/research/paperTradingPlanService.ts`或实际慢路由及对应前端查询模块；单模块子计划明确文件。

- [ ] 先分开核心研究、辅助研究、通知、执行与HTTP日志耗时，保留样本范围和缺失值。
- [ ] 对确认的串行等待、重复请求或阻塞写受控计时回归，再实施修复；失败来源和降级证据必须保留。
- [ ] 同一环境比较前后，避免把热缓存或不同样本称为整体提速；完成独立验证/部署流程。

## Task 4：跨市况策略验证与剩余缺陷

- [ ] 检查CapitalShield/RiskOffRecovery/TrendHealth等状态是否绑定真实成交，拒单不得形成虚拟持仓；分别复现而非批量改动。
- [ ] 固定历史、严格时间切片、手续费/滑点/整手检验震荡与恢复策略，记录全样本与失败策略；回测收益不能作为真实收益或承诺胜率。
- [ ] 多市场独立资金目前仍为设计，只有达到合约、保证金、结算、隔离账本验收后才能标记已实现。

## 每模块发布命令

运行目标测试后：

```powershell
node node_modules/vitest/vitest.mjs run --dir server --environment node
node node_modules/vitest/vitest.mjs run --dir src --environment jsdom
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build --config config/vite.app.config.js --configLoader runner
node runtime/ssh-python.cjs runtime/read-session-preservation.py
node runtime/deploy-release.cjs
node runtime/verify-release.cjs
```

Node使用已配置的bundled runtime；生产前后经济摘要单独保存并比较，保留上一发布的源码/三镜像/私有导出核验结果。

## 进度流水

- UTC15:27：确认工作树干净、基线部署`2c2f4a0`；本轮目标active。原`kairos`心跳已更新到11月12日截止并启用，每20分钟接续当前聊天。
- 当前证据：保留254次运行，其中225次open；178 blocked、46 watch-only、1 actionable；224次open带provider-warning，但历史可用6/6或12/12，不能推断为接口熔断。新标的资格在已读样本为零，待全日统计。
- UTC15:34：全日224份漏斗中，193次无合格新标的；31次有合格新标的，其中30次无法形成整手，1次可整手但641元本金的往返最低佣金超过1%。单轮中位4067.036ms、p95 8958.923ms，研究中位4064.364ms；保留记录间隔中位64.092秒（排除>=300秒间隔）。盘后只读研究未重现警告，不能猜测盘中原始警告。首个模块见[可买整手历史优先计划](2026-11-11-affordable-history-priority.md)。
- UTC16:52：模块1 `715c96076dbd45fdb728cb011b403262f5975f6c`已推送部署，705归档文件匹配/三健康/健康200/匿名业务401，Paper+AkShare/认证开/真实执行关闭；经济摘要与检查点严格保持（现金13992、3持仓、5单）。上一版本2c2f4a0的701源码文件/三镜像与私有导出独立匹配，exportVerified与overwriteRefused均true。目标54、完整2583服务端、TS/Vite通过；前端/Python未改。下一模块拆分核心/辅助阶段只读计时，检查非关键辅助数据的等待。
- UTC18:13：模块2 `0471b5a6a29ec1a78db5cee05b5e8ec013a0137c`已部署，709文件/三健康/健康200/匿名401及原账户经济摘要和检查点保持；上一715c960的705源码/三镜像/私有导出匹配。完整2593后端在本地及无网络生产镜像+候选公开源码挂载均通过，目标78、TS/Vite通过。GitHub默认亚洲入口重置、临时服务器隧道也失败；UTC18:17使用DNS服务当次解析的美国入口、显式schannel和保留证书校验后推送成功。没有修改全局git/DNS、凭据或证书校验。

## 最终交付

- [ ] UTC23:40冻结新复杂改动/新发布；收口在途验证与必要回滚。
- [ ] 核对当前SHA、公开HTTPS、匿名保护、原账户、数据源与定时归档/证书续期，记录真实上线模块和未完成项。
- [ ] 保存最终交付记录并暂停`kairos`心跳；截止前不提前标记目标完成。
