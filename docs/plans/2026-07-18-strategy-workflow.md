# 策略实验室阶段式工作流实施计划

> **执行要求：** 按任务逐项实施和验证；保持合成回测、真实历史固定策略组验证与本地 paper 观察的语义隔离。

**目标：** 把策略页从纵向报告堆叠改为“配置 → 回测 → 独立验证 → Paper 观察”的任务流程，让用户始终知道当前结果来自哪里、下一步该做什么。

**架构：** `App.tsx` 继续持有策略参数与已提交参数，新增当前阶段和首次回测完成状态。`StrategyWorkflow` 只负责阶段导航、来源说明和过期结果提示；各重型研究组件仅在对应阶段挂载，减少首屏请求与渲染。纯函数模块负责参数差异与阶段状态，使用 Vitest 固定行为。

**技术栈：** React 19、TypeScript、Lucide、Vitest、现有 CSS 设计系统。

---

## 文件边界

- 新建 `src/lib/strategyWorkflow.ts`：阶段类型、参数一致性和阶段状态计算。
- 新建 `src/lib/strategyWorkflow.test.ts`：运行前、运行后和参数变更后的确定性测试。
- 新建 `src/components/StrategyWorkflow.tsx`：阶段导航、上下文摘要、过期提示和阶段容器。
- 修改 `src/App.tsx`：编排阶段、回测完成跳转和按阶段懒加载。
- 修改 `src/styles/index.css`：桌面与手机阶段导航，不引入页面级横向滚动。
- 修改 `docs/product/overview.md`、`docs/status/current-state.md` 和总计划：同步已实现事实与验证结果。

## 任务 1：阶段状态纯函数

- [ ] 新增失败测试，断言：未运行时只有配置阶段完成；运行后回测阶段完成；修改任一参数后结果标记为过期；重新使用已提交参数后恢复最新状态。
- [ ] 运行 `node node_modules/vitest/vitest.mjs run src/lib/strategyWorkflow.test.ts --environment jsdom`，确认测试因实现缺失而失败。
- [ ] 实现以下稳定接口：

```ts
export type StrategyWorkflowStage = "configure" | "backtest" | "validate" | "observe";

export function strategyParametersEqual(
  left: StrategyParameters,
  right: StrategyParameters,
): boolean;

export function getStrategyWorkflowState(input: {
  hasRun: boolean;
  selectedStrategy: StrategyId;
  committedStrategy: StrategyId;
  parameters: StrategyParameters;
  committedParameters: StrategyParameters;
}): { hasPendingChanges: boolean; backtestReady: boolean };
```

- [ ] 重跑聚焦测试并确认通过。

## 任务 2：工作流导航组件

- [ ] 新建 `StrategyWorkflow.tsx`，以四个按钮展示“配置策略 / 合成回测 / 真实验证 / Paper 观察”，使用 `aria-current="step"` 标识当前阶段。
- [ ] 组件显示当前策略、固定种子 90 日合成样本、结果是否过期，以及真实验证不复用浏览器参数的边界说明。
- [ ] 运行前点击回测阶段时回到配置并聚焦“运行回测”；参数已修改时在结果阶段显示“结果基于上次已提交参数”。

组件契约：

```ts
interface StrategyWorkflowProps {
  activeStage: StrategyWorkflowStage;
  selectedStrategyName: string;
  committedStrategyName: string;
  hasRun: boolean;
  hasPendingChanges: boolean;
  onStageChange: (stage: StrategyWorkflowStage) => void;
  children: ReactNode;
}
```

## 任务 3：按阶段编排和加载

- [ ] 在 `App.tsx` 增加 `strategyStage` 与 `hasCompletedBacktest`；回测完成后自动进入 `backtest`。
- [ ] 配置阶段仅挂载 `StrategyLab`；回测阶段挂载 `BacktestResults + StrategyCompare`；真实验证阶段挂载 `StrategyLeaderboard + StrategyRobustnessPanel`；观察阶段挂载 `DailyQualityStocks + DailyCandidates` 和进入研究管线的明确入口。
- [ ] 未运行时不把默认参数生成的图表描述为用户已经完成的实验；真实历史报告继续声明固定策略组验证，不冒充当前参数结果。
- [ ] 运行 TypeScript、完整前端测试和生产构建。

## 任务 4：响应式和文档验收

- [ ] 在 1440×900 验证四阶段切换、运行后自动进入结果、修改参数后过期提示和真实验证来源说明。
- [ ] 在 390×844 验证阶段按钮为两列稳定网格，无页面级横向溢出，操作可达。
- [ ] 新开干净页面确认控制台无 `error` 或 `warn`。
- [ ] 更新总计划、产品范围和当前状态，记录测试、构建和浏览器结果。
