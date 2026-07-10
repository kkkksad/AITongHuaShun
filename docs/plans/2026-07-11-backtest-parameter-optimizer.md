# 回测参数优化器

**日期：** 2026-07-11
**状态：开发中**

## 目标

为现有7种策略提供自动化参数优化能力，支持：
1. 网格搜索（Grid Search）—— 对离散参数空间穷举搜索
2. 遗传算法（Genetic Algorithm）—— 对连续/大参数空间进化搜索
3. 多目标优化（夏普比率、总收益、卡尔玛比率、自定义加权）

## 架构

```
server/optimizer/
├── index.ts              # 统一导出
├── types.ts              # 类型定义（参数空间、试验结果等）
├── gridSearch.ts         # 网格搜索实现
├── geneticAlgorithm.ts   # 遗传算法实现
├── optimizer.test.ts     # 测试
```

## 设计

- 每种策略定义 `ParameterRange[]` 参数空间
- `StrategyFactory` 模式：从参数对象创建策略实例
- 优化器创建独立的 BacktestEngine 实例进行每次试验
- 结果按目标函数排序，支持自定义权重

## 进度

- [ ] types.ts - 类型定义
- [ ] gridSearch.ts - 网格搜索
- [ ] geneticAlgorithm.ts - 遗传算法
- [ ] index.ts - 导出+策略工厂
- [ ] optimizer.test.ts - 测试
