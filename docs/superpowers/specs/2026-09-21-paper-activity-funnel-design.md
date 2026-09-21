# Paper 活跃度与交易漏斗设计

**状态：** 已批准，第一阶段实施中  
**日期：** 2026-09-21  
**范围：** 本地 Paper 研究和模拟执行链路

## 背景

当前系统已经有候选扫描、真实历史验证、自适应策略路由、Paper 计划和自动执行器，但交易频率仍然难以解释。候选池、可负担候选、策略命中、计划、提交和成交分散在不同对象中，阻塞原因也同时存在原始规则文本和执行器跳过文本。生产模板还把单笔 Paper 金额限制在 2500 元，普通历史研究池只覆盖 6 只股票，容易让“候选少”“买不起一手”“没有策略信号”和“执行节奏已用完”混在一起。

## 目标

- 为每次 Paper 计划提供稳定的交易漏斗：观察候选、可负担、历史覆盖、策略合格、计划、提交、成交。
- 为阻塞原因提供有限的标准分类，同时保留原始规则文本供复盘。
- 将漏斗数据同时暴露在 Paper 计划、自动执行快照和研究管线中。
- 将普通模式核心历史研究池从 6 只提高到 8 只，活动模式继续最多 12 只。
- 保持 Paper-only 边界和全部硬风控不变。

## 非目标

- 不接入真实券商、同花顺真实账户或浏览器自动下单。
- 不降低 T+1、费用、现金储备、仓位、阶段额度、熔断或每日订单上限。
- 不把 Paper 成交目标描述成成交保证、胜率或收益承诺。
- 不在本阶段改变生产环境的 2500 元单笔风险预算。

## 设计

### 交易漏斗

`PaperActivityFunnel` 放在共享交易契约中，包含：

- `observedCandidates`
- `affordableCandidates`
- `historyCoveredCandidates`
- `strategyQualifiedCandidates`
- `plannedOrders`
- `plannedBuyOrders`
- `plannedSellOrders`
- `submittedOrders`
- `filledOrders`
- `blockedCandidates`
- `blockerCounts`

计划生成时提交数和成交数为 0；自动执行完成后，执行器快照用真实提交和成交结果更新这两个字段。

### 阻塞码

阻塞码只允许有限集合：`market-data`、`history`、`strategy`、`affordability`、`fees`、`cash`、`position`、`phase`、`risk`、`duplicate`、`execution`、`other`。分类依据是现有 `ruleChecks` 和原因文本，原始文本继续保存，不做事后推断。

### 历史覆盖

普通 Paper 研究使用 8 只核心股票，活动目标开启时使用 12 只。候选仍先经过受控股票池、真实历史来源、超时和降级检查；增加覆盖只增加可观察机会，不改变策略准入。

### 数据流

```text
候选扫描 + 优质股扫描
          │
          ▼
      Paper 计划
          │  activityFunnel（提交/成交暂为 0）
          ▼
   自动执行器 preflight
          │
          ▼
PaperBroker 订单结果
          │
          ▼
执行快照 activityFunnel（提交/成交已更新）
```

## 文件边界

- `shared/trading.ts`：共享漏斗与阻塞码契约。
- `server/trading/paperActivityFunnel.ts`：分类和漏斗计算纯函数。
- `server/research/paperTradingPlan.ts`：将计划候选和操作接入漏斗。
- `server/trading/paperAutoExecutor.ts`：将实际提交、成交结果回填到执行快照。
- `server/research/paperTradingPlanService.ts`：调整普通/活动历史覆盖上限。
- `src/lib/tradingApi.ts`：镜像 API 类型。
- `src/components/LearningPipeline.tsx`：展示漏斗和标准阻塞原因。

## 验证

- 纯函数测试覆盖阻塞码分类、空漏斗、计划漏斗和执行结果回填。
- Paper 计划测试验证真实接口返回漏斗字段。
- 自动执行测试验证快照能区分计划、提交和成交数量。
- 运行 `npm test`、`npm run build`、`git diff --check`。

## 后续阶段

下一阶段再基于漏斗实际数据决定是否引入动态候选池、分层 Paper 档位或独立探索账户；本设计不凭主观目标直接放宽交易门槛。
