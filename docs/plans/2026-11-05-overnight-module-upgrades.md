# 夜间逐模块升级执行计划

> **For agentic workers:** 按 writing-plans 编写，使用本聊天子代理逐项实现、主代理复核。每个模块验证、提交、部署后才发布下一模块。

**Goal:** 在北京时间 2026-11-06 08:00 前逐模块改善资金比例解释、策略研究正确性、加载速度和键盘体验，每次代码提交对应一次服务器部署。

**Architecture:** 在独立工作树整合最新本地功能分支与远端 main 的生产分支规范。沿用现有 PaperBroker、风险引擎、查询缓存和懒加载机制，不新增真实执行权限。

**Tech Stack:** React 19、TypeScript、Vite、TanStack Query、Fastify、Vitest、Python/FastAPI、Docker Compose。

## 已确认约束与起点

- 截止为北京时间 2026-11-06 08:00，即 UTC 2026-11-06 00:00；到期停止新增修改，完成在途部署验证或回滚。
- 工作树：`C:/Users/kjq/.codex/worktrees/overnight-optimization/AI量化`；分支 `codex/overnight-optimization-2026-11-05`。
- 起点 `dfad497d38787a1d0e017681c572e6b666f0d8b6`，整合 `origin/main` 的 `5ec9d3b` 分支规范，不丢弃六检查点通知等后续功能。
- 原目录 main 陈旧且有用户未跟踪文件，保持原样。
- 服务器 `/opt/kairos` 是归档部署，没有 `.git`，不能根据 `git branch` 推断线上分支。部署前三个关键源码 SHA256 与 dfad497 一致；精确发布标识需本轮补记。
- 初始线上三个容器 healthy；health 明确 `paper + akshare`、`realTradingEnabled=false`、`authEnabled=true`。
- 用户新增明确授权：**直接取消固定比例现金预留，仅保留必要费用**。这是本次 Paper 配置变更；保留手续费、滑点、整手、实际可用现金、单笔/单股硬限额、T+1、阶段额度、日额度、熔断、幂等与既有手动策略。
- 线程续跑自动化 `kairos` 每 30 分钟检查，截止时间内继续未完成任务；依赖电脑和 Codex 可用。

## 发布协议（每轮）

1. 先记录预期行为、涉及文件和可验证结果，补必要的回归测试。
2. 定向测试通过后跑前后端全套 Vitest、TypeScript 与 Vite 生产构建；Python 发生修改时加桥接测试。
3. 主代理检查 diff、`git diff --check`，只提交该模块及相应文档。
4. 推送工作分支；用 `git archive HEAD` 生成二进制归档，通过既有受限 `deploy-upload <40位SHA>` SSH 入口部署。不得使用 PowerShell 文本管道传二进制。
5. 记录上一发布标识、部署输出；检查三容器 healthy、`/healthz`、`/api/health`、匿名账户/能力/自动执行接口 401 和源码哈希。保留原账户、订单、凭据。
6. 发布失败先回滚/修复，不堆叠下一轮。下一轮文档记录上一轮线上结果，避免为记一行状态再次发布。

## 模块 1：入口代码按需加载（进行中）

**Files:** `src/App.tsx`、`docs/status/current-state.md`、本计划。

- [x] 记录未改动构建入口包实际字节数：App 74,399 字节，gzip 23,957 字节；基础 index 199,170 字节。
- [x] 删除 `TradingStrategies`、`SystemMonitor` 同步 import，使用现有具备分块失败恢复的工具：

```tsx
const TradingStrategies = lazyNamed(() => import("./components/TradingStrategies"), "TradingStrategies");
const SystemMonitor = lazyNamed(() => import("./components/SystemMonitor"), "SystemMonitor");
```

- [x] 账户 `strategies` 与 `monitor` 内容分别包裹 `<Suspense fallback={<LazyFallback />}>`。
- [x] 精确暂存树隔离快照验证：65 个服务端文件/947 项、34 个前端文件/132 项测试全部通过；TypeScript 与 Vite 构建通过。App 58,814 字节（减少20.9%），gzip 19,435 字节（减少18.9%）；SystemMonitor 6,977 字节、TradingStrategies 8,667 字节独立加载。该结果仅为构建体积，不宣称线上耗时同比改善。
- [ ] 模块1提交、部署、验证。

## 模块 2：取消固定现金预留（优先）

**Files:** `server/config.ts`、`server/trading/paperStrategyProfile.ts`、`server/research/adaptiveStrategyRouter.ts`、`server/research/dailyMarketReview.ts`、`server/research/paperTradingPlan.ts`、`server/trading/paperAutoExecutor.ts`、各对应测试、`src/components/Settings.tsx`、`src/components/LearningPipeline.tsx`、`.env.example`、`deploy/production.env.example`、受影响专题文档。

- [ ] 复现叠加：有效预留原为 `max(配置10%, 档位20%至80%, 路由10%至70%)`；区分固定现金预留与其他风险限额，记录线上实际配置。
- [ ] 将固定预留来源统一取消：默认配置为 0、档位和路由固定 floor 为 0，计划与执行器一致；保留兼容字段及显式配置校验。
- [ ] 删除复盘的固定现金比例恢复要求；界面明确“无固定比例预留，仍按费用和实际风险额度计算可买金额”，不得承诺满仓或强制成交。
- [ ] 测试：低于旧20%/50%现金仍可对合格候选形成计划；同批买单累计扣费用；不足手续费不下单；风险禁止、T+1、硬限额和阶段限制仍生效。
- [ ] 检查并仅修改服务器 `PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO=0`；不输出或改动其他凭据配置，随代码部署验证生效。
- [ ] 定向与全套检查、提交、部署、状态记录。

## 模块 3：回测胜率统计正确性

**Files:** `server/backtest/backtestEngine.ts`、`server/backtest/backtestEngine.test.ts`、`shared/backtest.ts`、状态页和本计划。

- [ ] 添加盈利买卖、盈亏混合、未平仓、费用、部分平仓与重复运行回归。现有实现单笔盈利闭合显示50%。
- [ ] 保留现有 FIFO 闭合配对口径，只修分母：

```ts
winRate: tradePnls.length > 0 ? winCount / tradePnls.length : 0,
```

- [ ] 说明 `totalTrades` 为成交笔数、胜率只统计闭合 FIFO 配对；检查优化器和稳健性报告，不用调整门槛掩盖新统计。
- [ ] 定向测试引擎/优化器/稳健性，全套检查、提交、部署。

## 模块 4：快速导航键盘体验

**Files:** `src/lib/quickNavigation.ts`、`src/lib/quickNavigation.test.ts`、`src/components/AppShell.tsx`、`src/components/AppShell.interaction.test.tsx`、相关 CSS、状态页和本计划。

- [ ] 明确方向键移动、Enter 打开当前项、Esc 关闭、查询变化重置高亮的行为。
- [ ] 为已有 combobox/listbox 补选中状态、稳定 option id 和 `aria-activedescendant`；鼠标和键盘打开同一路由。
- [ ] 必要交互回归通过后全套检查、提交、部署。

## 后续候选（先证实，再建独立小计划）

- StrategyCompare 在不足两条结果时提前 return 发生在 useMemo 前，核对结果数量变化是否造成 Hooks 顺序错误。
- 依据服务端有界性能诊断挑选真实慢点，优先查询复用、取消无效请求和诚实降级；不无限抓取或盲目新增缓存。
- 资金比例页面逐层解释单笔、单股、阶段预算、费用及最终手数，先验证现有 sizingDiagnostics 是否足够，避免重复造字段。

## 验证与部署流水

模块1精确暂存快照已完成全套检查，准备发布；线上结果在发布完成后记录。
