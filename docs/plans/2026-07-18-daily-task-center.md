# 每日任务中心与 Paper 列表分页实施计划

> **执行要求：** 按步骤持续更新勾选状态；实现采用可测试纯函数，完成后运行前端测试、类型检查、生产构建和桌面/手机浏览器验收。

**目标：** 在总览首页提供盘前、盘中和盘后都能直接理解的每日任务中心，并把 Paper 观察中的两张长表改为每页 8 条的可访问分页。

**架构：** 任务中心复用 `paper-trading-plan`、`daily-review` 和 `paper-auto-execution/status` 三个受保护只读接口，由独立纯函数生成稳定展示模型；组件只负责查询、加载状态和导航。分页同样由共享纯函数负责页码夹紧与切片，不改变后端请求上限、刷新频率或任何交易语义。

**技术栈：** React 19、TypeScript、TanStack Query、Vitest、Lucide React、现有 CSS 设计变量。

---

## 文件边界

- 新建 `src/lib/dailyTaskCenter.ts`：将三个 API DTO 归一化为阶段、状态、数字摘要、原因和下一步动作。
- 新建 `src/lib/dailyTaskCenter.test.ts`：覆盖盘前、开盘、盘后、周末以及计划被阻止的语义。
- 新建 `src/components/DailyTaskCenter.tsx`：查询已有接口、展示任务状态并提供到市场、订单和研究管线的导航。
- 新建 `src/lib/pagination.ts` 与 `src/lib/pagination.test.ts`：提供页数计算、非法页码夹紧和稳定切片。
- 修改 `src/components/DailyQualityStocks.tsx`：保留 30 条请求，每页只渲染 8 条。
- 修改 `src/components/DailyCandidates.tsx`：保留 24 条请求，每页只渲染 8 条。
- 修改 `src/App.tsx`：把任务中心放在总览核心指标之后，并注入页面导航回调。
- 修改 `src/styles/index.css`：补充任务中心布局、分页控件和手机端约束。
- 修改 `docs/status/current-state.md` 与 `docs/plans/2026-07-18-system-ux-overhaul.md`：记录当前已实现能力和验证结果。

## 任务 1：任务中心展示模型

- [x] 先写失败测试，固定 `pre-market/open/after-hours/weekend` 的中文阶段和下一步动作。
- [x] 固定 `actionable/watch-only/blocked`、`allowNewPositions` 和自动执行器状态的优先级。
- [x] 实现最小纯函数并运行聚焦测试。

验收命令：

```powershell
node.exe node_modules\vitest\vitest.mjs run src\lib\dailyTaskCenter.test.ts --environment jsdom
```

## 任务 2：共享分页逻辑

- [x] 先写失败测试，覆盖空列表、第一页、末页和数据缩短后的页码夹紧。
- [x] 实现 `paginateItems`，保证返回合法页码、总页数、当前切片和显示区间。
- [x] 运行聚焦测试。

验收命令：

```powershell
node.exe node_modules\vitest\vitest.mjs run src\lib\pagination.test.ts --environment jsdom
```

## 任务 3：首页每日任务中心

- [x] 使用三个现有 API 和共享 TanStack Query key，避免重复网络请求。
- [x] 展示当前阶段、执行器、计划质量、市场状态、资金与仓位、订单结果和下一步动作。
- [x] 某个接口失败时保留其余可用信息，明确标注数据不完整，不把缓存或 Paper 结果描述为真实收益。
- [x] 为市场研判、订单复核和研究管线提供明确导航入口。

## 任务 4：Paper 观察分页

- [x] 两张表各保留现有 bounded API 请求和 60 秒刷新。
- [x] 每页渲染 8 条，显示当前区间和总数。
- [x] 使用带 `aria-label` 的上一页/下一页图标按钮；首页和末页正确禁用。
- [x] 刷新后总数变少时，把页码夹紧到合法范围。

## 任务 5：验收与文档

- [x] 运行完整前端测试、TypeScript 和 Vite 生产构建。
- [x] 在 `1440x900` 和 `390x844` 检查总览任务中心与 Paper 观察分页。
- [x] 检查页面级横向溢出、按钮可操作性以及浏览器控制台错误。
- [x] 更新当前状态与总体验计划，记录准确的验证数量和限制。
- [ ] 使用中文提交信息提交并推送当前分支。

## 安全边界

- 真实交易继续关闭，任务中心不提供真实下单入口。
- 自动执行状态只代表本地 `PaperBroker`，不得描述为券商成交。
- 行情、计划或复盘接口不可用时显示未知，不用静态值补齐。
- 分页只改变展示范围，不改变候选评分、排序、请求数量或研究结论。

## 验证结果

- 任务中心与分页聚焦测试：2 个文件、9 项通过。
- 完整前端测试：20 个文件、62 项通过。
- TypeScript 项目检查通过。
- Vite 生产构建通过，转换 2,313 个模块。
- `1440x900` 与 `390x844` 均无页面级横向溢出；任务中心快捷按钮、两张分页表和优质股下一页交互通过。
- 干净首页控制台无 `error` 或 `warn`；三个数据源加载完成后显示 `3/3 数据就绪`。
- `git diff --check` 通过，仅保留 Windows 行尾转换提示。
