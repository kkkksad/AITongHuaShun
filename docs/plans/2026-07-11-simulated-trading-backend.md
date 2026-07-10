# 模拟交易后端实施计划

**状态：** 进行中
**日期：** 2026-07-11

## 目标

在现有 React + TypeScript 前端旁增加可演进的 Node.js + TypeScript 后端，先形成模拟实时行情、模拟撮合、账户、风控、审计和 WebSocket 推送闭环，为后续接入真实行情和受控券商适配器建立边界。

## 技术方案

- Fastify：HTTP API 与插件边界。
- `@fastify/websocket`：实时行情和账户事件推送。
- Zod：环境变量和请求校验。
- `tsx`：后端 TypeScript 开发运行。
- Vitest：前后端统一测试。
- React + Vite：继续作为前端展示和操作层。

## 实施步骤

- [x] 安装后端、WebSocket、校验和开发运行依赖。
- [x] 建立共享交易契约、服务端 TypeScript 配置和环境变量模板。
- [ ] 实现模拟行情、内存交易仓库、PaperBroker 和风险引擎。
- [ ] 暴露 REST 与 WebSocket API。
- [ ] 将 React 市场和账户页面接入后端，并保留断线降级。
- [ ] 更新 VS Code 为前后端一键调试。
- [ ] 增加后端单元测试并运行完整测试、构建和页面检查。
- [ ] 使用中文提交信息创建独立提交。

## 不可突破的边界

- `REAL_TRADING_ENABLED` 默认且当前必须为 `false`。
- Token 只允许存在于未提交的 `.env.local`。
- 后端只实现模拟成交，不包含真实券商下单代码。
- MCP 不作为订单执行入口；未来只读查询工具必须复用同一风控和审计边界。
