# KAIROS Quant

面向量化研究与模拟交易的渐进式工作台。

当前仓库是可运行的 React + TypeScript + Fastify 量化研究原型，包含确定性回测、模拟实时行情、风险检查、模拟撮合、账户持仓、订单审计和研究审批视图。实际能力与验证结果见[当前状态](docs/status/current-state.md)。

## 功能特性

| 模块 | 功能 | 状态 |
|------|------|------|
| 📊 总览面板 | 组合权益、策略收益、夏普比率、最大回撤 | ✅ |
| 🧪 策略实验室 | 7种策略、参数优化（网格搜索+遗传算法）、策略对比 | ✅ |
| 📈 市场观察 | 指数行情、个股报价、资金流向、市场图表 | ✅ |
| 💼 模拟账户 | 持仓分析、模拟下单、订单历史、撤单管理 | ✅ |
| 🛡️ 风控引擎 | 熔断器、动态仓位缩放、实时风控状态追踪 | ✅ |
| 📋 交易策略 | 建仓计划、网格交易、定投策略（DCA） | ✅ |
| 🔬 研究管线 | 策略学习、候选验证、审批流程 | ✅ |
| 📡 系统监控 | Prometheus 指标端点、HTTP/WS/账户/订单指标 | ✅ |
| 🌓 暗色主题 | CSS变量驱动、平滑过渡、减少动画偏好适配 | ✅ |
| 🔌 行情对接 | 东方财富 + AkShare 行情桥接（只读） | ✅ |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 5.7 + Vite 6 + React Router 7 |
| 状态 | TanStack Query 5 + WebSocket 实时推送 |
| 图表 | Recharts 2 |
| 图标 | Lucide React |
| 后端 | Fastify 5 + TypeScript + WebSocket |
| 测试 | Vitest（228+ 测试通过） |
| 部署 | Docker + Docker Compose + CI/CD |
| 优化 | 路由级代码分割、vendor chunk 分离 |

## 快速开始

```powershell
npm install
npm run dev       # 同时启动 API 后端 (8787) 和前端 (4173)
npm test          # 运行全部测试
npm run build     # TypeScript 编译 + Vite 构建
```

使用 VS Code 时，可以直接选择 `KAIROS：全栈调试` 并按 `F5`，同时调试 Fastify 后端和 React 前端。

## 项目结构

```
├── src/                     # React 前端
│   ├── components/          # UI 组件（懒加载）
│   │   ├── AppShell.tsx     # 应用外壳布局
│   │   ├── TradingStrategies.tsx  # 建仓计划/网格交易/定投
│   │   ├── SystemMonitor.tsx      # Prometheus 监控面板
│   │   └── ...              # 其他组件
│   ├── hooks/               # 自定义 Hooks
│   ├── lib/                 # 工具库
│   ├── styles/              # 主题样式（亮/暗）
│   └── types/               # TypeScript 类型
├── server/                  # Fastify 后端
│   ├── backtest/            # 回测引擎 + 7种策略
│   │   └── strategies/      # 动量/MACD/网格/海龟/布林/RSI/均线
│   ├── broker/              # 券商适配器
│   │   └── eastmoney/       # 东方财富对接
│   ├── contracts/           # 契约接口（可插拔）
│   ├── market/              # 行情数据源（Mock + AkShare）
│   ├── optimizer/           # 参数优化器（网格+遗传）
│   ├── risk/                # 增强风控引擎
│   ├── metrics.ts           # Prometheus 指标收集
│   ├── metrics.test.ts      # 指标测试
│   └── index.ts             # 服务入口
├── shared/                  # 前后端共享类型
├── docker-compose.yml       # Docker 编排
├── Dockerfile               # 容器构建
└── docs/                    # 文档
    ├── architecture/        # 系统架构
    ├── product/             # 产品范围
    ├── operations/          # 开发运维
    ├── safety/              # 安全边界
    ├── decisions/           # 技术决策记录
    ├── status/              # 当前状态
    └── roadmap.md           # 路线图
```

## 可用 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/metrics` | Prometheus 指标 |
| GET | `/api/capabilities` | 系统能力边界 |
| GET | `/api/market/snapshot` | 市场快照 |
| GET | `/api/account` | 账户信息 |
| GET | `/api/positions` | 持仓列表 |
| GET | `/api/orders` | 订单列表 |
| GET | `/api/risk/limits` | 风控限额 |
| GET | `/api/risk/state` | 风控状态 |
| GET | `/api/audit` | 审计事件 |
| POST | `/api/orders` | 提交订单 |
| POST | `/api/risk/reset` | 重置熔断器 |
| POST | `/api/trading/pause` | 暂停交易 |
| POST | `/api/trading/resume` | 恢复交易 |
| DELETE | `/api/orders/:orderId` | 撤销订单 |
| WS | `/ws` | 实时行情推送 |

## Prometheus 指标

服务暴露 `/metrics` 端点，可被 Prometheus 采集：

- `http_requests_total` - HTTP 请求计数（按 method/route/status）
- `http_request_duration_seconds_total` - HTTP 请求耗时
- `ws_connections` - WebSocket 活跃连接数
- `orders_total` - 订单计数（按 side/status）
- `order_cancellations_total` - 撤单计数
- `account_equity` - 账户权益
- `account_cash` - 账户现金
- `account_positions_count` - 持仓数量
- `risk_circuit_breaker` - 熔断器状态（0/1）

## 文档入口

- [文档地图](docs/README.md)
- [产品范围](docs/product/overview.md)
- [系统架构](docs/architecture/system-overview.md)
- [本地开发](docs/operations/development.md)
- [交易安全边界](docs/safety/trading-boundaries.md)
- [路线图](docs/roadmap.md)

## 重要声明

当前项目定位为研究原型和模拟交易工具。行情、资金流、新闻、账户及回测结果均为模拟数据，不得视为真实收益或用于投资决策。真实交易保持硬关闭。

面向智能体的仓库导航请阅读 [AGENTS.md](AGENTS.md)。
