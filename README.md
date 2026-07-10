# KAIROS Quant

面向量化研究与模拟交易的渐进式工作台。

当前仓库已经恢复为可运行的 React + TypeScript 原型，包含策略参数、确定性回测、市场观察、新闻、模拟账户和研究审批视图。实际能力与验证结果见[当前状态](docs/status/current-state.md)。

## 快速入口

- [文档地图](docs/README.md)
- [产品范围](docs/product/overview.md)
- [系统架构](docs/architecture/system-overview.md)
- [本地开发](docs/operations/development.md)
- [交易安全边界](docs/safety/trading-boundaries.md)
- [路线图](docs/roadmap.md)

## 本地命令

```powershell
npm install
npm run dev -- --host 127.0.0.1
npm test
npm run build
```

上述测试和构建命令已在 2026-07-11 验证通过。具体预期和排错方法见[本地开发](docs/operations/development.md)。

## 重要声明

当前项目定位为研究原型和模拟交易工具。行情、资金流、新闻、账户及回测结果不得默认视为真实、实时或可用于投资决策的数据。

面向智能体的仓库导航请阅读 [AGENTS.md](AGENTS.md)。
