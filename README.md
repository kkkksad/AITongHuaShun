# KAIROS Quant

面向量化研究与模拟交易的渐进式工作台。

当前仓库是可运行的 React + TypeScript + Fastify 量化研究原型，包含确定性回测、模拟实时行情、风险检查、模拟撮合、账户持仓、订单审计和研究审批视图。实际能力与验证结果见[当前状态](docs/status/current-state.md)。

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
npm run dev
npm test
npm run build
```

上述测试和构建命令已在 2026-07-11 验证通过。具体预期和排错方法见[本地开发](docs/operations/development.md)。

使用 VS Code 时，可以直接选择 `KAIROS：全栈调试` 并按 `F5`，同时调试 Fastify 后端和 React 前端。

## 重要声明

当前项目定位为研究原型和模拟交易工具。行情、资金流、新闻、账户及回测结果均为模拟数据，不得视为真实收益或用于投资决策。真实交易保持硬关闭。

面向智能体的仓库导航请阅读 [AGENTS.md](AGENTS.md)。
