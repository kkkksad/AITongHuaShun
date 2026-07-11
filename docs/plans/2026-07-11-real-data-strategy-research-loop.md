# 真实数据与策略研究闭环

**日期：** 2026-07-11
**状态：首轮完成，继续迭代**

## 目标

把 KAIROS Quant 推进为可以读取真实 A 股行情、生成可复现策略排行榜、最终接入同花顺模拟账户的研究工作台。当前阶段只做只读行情和纸面研究，不开启真实交易。

## 范围

- 使用 AkShare 只读行情作为当前真实 A 股数据入口。
- 基于当前行情快照生成确定性研究样本，运行内置策略参数搜索并产出排行榜。
- 在前端策略页展示“收益率优先”的研究排名，同时明确结果不是实盘收益。
- 记录 Hermes 持续任务模板，让后续任务可以按小步循环推进。

## 不在本阶段

- 不接入真实资金账户。
- 不通过浏览器 Token 或本地脚本绕过券商风控。
- 不把当前合成历史样本等同于授权历史行情。
- 不自动下单到同花顺或任何真实券商。

## 相关文件

- `akshare-bridge/main.py`
- `server/market/AkShareProvider.ts`
- `server/research/strategyLeaderboard.ts`
- `server/app.ts`
- `src/components/StrategyLeaderboard.tsx`
- `src/lib/tradingApi.ts`
- `docs/safety/trading-boundaries.md`
- `docs/status/current-state.md`
- `docs/operations/development.md`

## 前置条件和约束

- `MARKET_MODE=paper`
- `REAL_TRADING_ENABLED=false`
- 行情读取和订单执行保持独立权限域。
- 任何真实或模拟券商凭据只能放在服务端环境变量或受控密钥服务中，不得进入源码、提交记录、浏览器存储或 `VITE_*` 环境变量。
- 策略排名必须同时保留成本、滑点、回撤和样本来源，不能只看收益率。

## 实施步骤

- [x] 确认现有 AkShare 只读行情桥接和 MarketDataProvider 边界。
- [x] 新增后端策略研究排行榜端点。
- [x] 使用当前行情快照生成确定性研究样本，避免不可复现随机结果。
- [x] 前端策略页展示排行榜、样本来源和非实盘收益提示。
- [ ] 接入授权历史行情缓存，替换当前快照生成样本。
- [ ] 增加滚动样本内/样本外验证。
- [ ] 增加数据质量评分：新鲜度、缺失率、停牌、涨跌停和复权语义。
- [ ] 设计同花顺模拟账户适配器，只允许 `paper` 或 `sandbox` 语义。
- [ ] 在同花顺模拟适配器前增加独立审批入口、额度限制、幂等键和审计日志。

## 关键决策

- 当前排行榜先排序模拟总收益，再使用多目标评分辅助稳定性判断；这样符合“先找收益最高策略”的用户目标，但不会丢掉回撤和夏普信息。
- 当前没有授权历史行情，因此研究样本标记为 `synthetic-from-current-snapshot`。这能先打通端到端工作流，但后续必须替换为真实历史数据缓存。
- 同花顺接入先设计为模拟账户适配器，不复用真实交易开关，不把浏览器登录态作为下单凭据。

## Hermes 持续任务模板

可以把下面这段交给 Hermes，让它持续唤起 Codex 小步推进：

```text
请持续推进 C:\Users\kjq\Desktop\AI量化 的 KAIROS Quant 项目，但保持真实交易关闭。

工作循环：
1. 先读取 AGENTS.md 和 docs/status/current-state.md。
2. 从 docs/plans/ 中选择优先级最高且未完成的计划。
3. 每次只推进一个可验证的小目标，例如真实行情质量、历史数据缓存、策略回测排名、模拟交易适配器或风控检查。
4. 改代码前先补/更新计划或测试。
5. 运行 npm test、npm run build；如果改了 AkShare 桥，也运行 python -m pytest akshare-bridge/test_bridge.py -q。
6. 更新 docs/status/current-state.md 和相关专题文档。
7. 用中文 commit message 提交。
8. 不开启真实交易，不提交 token，不把模拟收益说成真实收益。

当前优先级：
先完善 A 股真实数据读取和质量监控，再做可复现策略优化排行榜，再做同花顺模拟账户适配层。
```

## 验证命令和实际结果

```powershell
npm test
25 test files passed
462 tests passed

npm run build
TypeScript checks and Vite production build passed
```

若后续修改 AkShare 桥接：

```powershell
python -m pytest akshare-bridge/test_bridge.py -q
```

## 遗留问题

- 当前排行榜使用确定性合成样本，不是授权历史行情。
- 还没有持久化实验记录和数据版本号。
- 还没有同花顺模拟账户适配器。
- 还没有 NewsProvider 或资金流真实数据源。
