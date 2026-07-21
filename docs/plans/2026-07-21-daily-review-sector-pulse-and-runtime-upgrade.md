# 今日复盘、板块脉冲与运行可靠性升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 复盘 2026-07-21 本地 Paper 操作，补齐科技/强势板块快速回撤提醒，解释无买入原因，增加风险收缩修复观察策略，并修复自动执行重叠与运行态陈旧问题。

**架构：** 保留历史日线驱动的中期策略路由，新增只影响提醒和研究状态的有界盘中板块脉冲层；单日强反弹不能直接覆盖中期 `risk-off`。自动执行调度改为上一轮完成后再安排下一轮，避免研究请求超过间隔时产生并发空跑。所有新增能力只作用于本地 Paper 研究和 WxPusher 提醒。

**技术栈：** TypeScript、Fastify、Vitest、React、AkShare 只读桥、WxPusher、JSON Paper Store。

**状态：** 已完成（2026-07-21）。

---

## 已核实复盘事实

- 2026-07-21 共成交 2 笔：09:58 卖出包钢股份 100 股，09:59 卖出中国东航 100 股；成交额合计 573 元，手续费 10 元，没有买入和拒单。
- 两笔减仓都来自真实历史形态 `trend-deterioration (0.80)` 和中期 `risk-off` 路由，不是资金不足。
- 收盘账户现金 5935 元、权益 10262 元、仓位约 42.2%；当日盯市 Paper 盈亏约 -129 元，累计 Paper 盈亏约 +262 元，两者不得混用或描述成真实收益。
- 收盘观察池转为 `risk-on`：上涨 60、下跌 40、平均涨幅 2.23%；但中期板块 20/60 日收益和均线斜率仍弱，路由维持 `risk-off`、置信度 83%。这属于中期弱势与单日强反弹冲突，不应直接追涨，也不应继续只显示笼统的“市场不宜操作”。
- WxPusher 成功发送 5 条：09:31 数据降级、09:58 risk-off、10:30、13:30、14:50。当前提醒只展示历史评分靠前的 3 个板块，没有保存盘中板块高点，也没有科技板块回撤事件类型，所以无法识别“科技从盘中高位快速回落”。
- 自动执行使用 `setInterval` 每 60 秒触发；完整研究经常耗时 40 秒以上，偶发超过 60 秒后产生 `previous auto paper execution is still running` 空跑审计，增加桥接负载和本地 JSON 写入。
- 运行中的 API 是提交前启动的旧进程，访问新数字资产路由曾返回 404；源码已经包含该路由，完成升级后必须重启并验证运行版本。

## Task 1：板块脉冲检测与精准提醒

**文件：**
- 新建：`server/research/sectorPulse.ts`
- 新建：`server/research/sectorPulse.test.ts`
- 修改：`server/notifications/paperPlanNotifier.ts`
- 修改：`server/notifications/paperPlanNotifier.test.ts`
- 修改：`server/trading/paperAutoExecutor.ts`

- [x] 写失败测试：科技板块首次观察只建立日内高点，不发送回撤事件。
- [x] 写失败测试：科技板块从已观察高点回落至少 1.5 个百分点，或相邻有效快照回落至少 1 个百分点时，生成一次 `technology-pullback` 事件。
- [x] 写失败测试：数据降级、跨交易日、轻微波动和重复回撤不消耗额外提醒额度。
- [x] 实现有界日内 `SectorPulseTracker`，每个交易日最多保留 24 个板块，只保存名称、当前涨幅、日内观察高点和上次值，不写原始行情文件。
- [x] 在 WxPusher 重要事件和正文中展示板块名称、观察高点、当前涨幅和回撤百分点；审计只保存有界信号，不保存凭据。
- [x] 运行 `npx vitest run server/research/sectorPulse.test.ts server/notifications/paperPlanNotifier.test.ts --environment node`，预期全部通过。

## Task 2：风险收缩修复观察与新研究策略

**文件：**
- 修改：`server/research/adaptiveStrategyRouter.ts`
- 修改：`server/research/adaptiveStrategyRouter.test.ts`
- 修改：`server/backtest/strategies/KairosDefensiveStrategies.ts`
- 修改：`server/backtest/strategies/index.ts`
- 修改：`server/backtest/strategies.test.ts`
- 修改：`server/optimizer/index.ts`
- 修改：`src/lib/tradingApi.ts`
- 修改：`src/lib/adaptiveStrategyPresentation.ts`
- 修改：`src/lib/adaptiveStrategyPresentation.test.ts`

- [x] 写失败测试：中期风险条件成立但当前板块上涨宽度明显恢复时，路由标为 `risk-off-recovery`，而不是普通 `risk-off`。
- [x] 保持 `risk-off-recovery` 默认禁止新增仓位，现金底线不低于 55%；只有历史趋势和候选规则后续共同转强才允许策略切换，单日反弹不能直接入场。
- [x] 新增确定性 `KAIROS风险收缩修复` 回测策略：放量收复短均线后仅使用小目标仓位，跌回确认线、固定止损或止盈时退出。
- [x] 将新策略加入优化器和修复观察路由的研究候选，但 Paper 买入仍服从 `allowNewPositions`、历史持续性、费用和一手规则。
- [x] 运行路由、策略与优化器聚焦测试，确认无未来数据和随机结果。

## Task 3：明确回答“为什么没有入场”

**文件：**
- 修改：`server/research/dailyMarketReview.ts`
- 修改：`server/research/dailyMarketReview.test.ts`
- 修改：`src/lib/tradingApi.ts`
- 修改：`src/components/LearningPipeline.tsx`
- 修改：`src/styles/index.css`

- [x] 写失败测试：有现金、无买单且最新路由为风险收缩时，复盘返回“策略风控阻止入场”，不得误写成资金不足。
- [x] 写失败测试：区分资金不足、没有合格候选、数据不可用、交易时段外和已经入场。
- [x] 新增 `entryReview`，返回状态、结论和可审计原因；界面在每日复盘首屏展示该结论。
- [x] 当收盘盘面转强而中期路由仍弱时，明确标注“单日反弹未完成中期修复确认”，并加入下一交易日复核条件。

## Task 4：自动执行调度与运行 Bug 修复

**文件：**
- 修改：`server/trading/paperAutoExecutor.ts`
- 修改：`server/trading/paperAutoExecutor.test.ts`
- 修改：`server/app.test.ts`

- [x] 用可注入调度器写失败测试，证明长任务未结束时不会再次触发定时运行。
- [x] 用递归 `setTimeout` 替换 `setInterval`；下一轮从本轮完成后计时，`stop()` 必须取消待执行计时器。
- [x] 非可执行 `hold/observe` 的审计原因改成用户可读的正常观望理由，不再显示为类似错误的 `operation is not executable`。
- [x] 验证 `/api/research/crypto-market`、每日复盘、Paper 计划和自动执行状态路由均存在且受登录保护。

## Task 5：文档、全量验证、重启与提交

**文件：**
- 修改：`docs/status/current-state.md`
- 修改：`docs/product/overview.md`
- 修改：`docs/architecture/system-overview.md`
- 修改：`docs/operations/development.md`
- 修改：`docs/plans/README.md`
- 修改：本计划

- [x] 运行服务端与前端 Vitest、Python pytest、`npm run build` 和 `git diff --check`。
- [x] 确认差异不含 `.env.local`、`data/`、日志、SPT、UID 或登录密码。
- [x] 重启 API 并保留已预热的 4173/8800 服务，验证三个端口、登录、数字资产路由、每日复盘和 Paper-only 能力声明。
- [x] 更新本计划的完成状态和验证结果，以中文提交信息创建 Git 提交；除非用户另行要求，不推送远程。

## 实际结果

- 服务端 Vitest 52 个文件、796 项通过；前端 Vitest 27 个文件、90 项通过；Python 桥接 94 项通过，只有 FastAPI/httpx 依赖弃用警告；TypeScript 与 2,318 模块生产构建通过。
- 运行态复盘返回 `risk-blocked / risk-off / watch-only`：0 笔买入、2 笔卖出、现金 5935 元、权益 10262 元，交易日盯市结果 -129 元，账户重置以来累计结果 +262 元。
- 额外修复较新的盘后 `not-run` 覆盖盘中 `watch-only` 的复盘 Bug；统一把历史 `dailyPnl` 字段的用户文案改为累计收益，并新增显式 Vitest automatic JSX 配置，避免依赖布局改变测试语义。
- 1280×720 与 390×844 研究管线无页面级横向溢出，入场诊断可见，浏览器控制台无 warning/error。
- BTC/ETH 公开源在 5 秒桥接上限内仍不可用，模块明确降级且不使用静态价格；该辅助源不阻止 A 股核心行情、复盘或 Paper 计划。

## 完成标准

- 科技或强势板块发生达到阈值的盘中回撤时，每天最多发送一次包含具体幅度的提醒；轻微波动和重复事件不浪费额度。
- 复盘能直接回答当日为什么买、卖或不入场，并把中期风险与日内反弹冲突讲清楚。
- 新策略只进入确定性研究和 Paper 候选，不绕过真实历史、费用、T+1、整手、现金、仓位、幂等和人工边界。
- 自动执行不再产生由定时器重叠导致的空跑，运行中的 API 与当前源码版本一致。
