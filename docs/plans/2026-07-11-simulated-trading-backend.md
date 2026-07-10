# 模拟交易后端实施计划

**状态：** 已完成  
**日期：** 2026-07-11

## 目标

在 React + TypeScript 前端旁增加 Node.js + TypeScript 后端，形成模拟实时行情、模拟撮合、账户、风控、审计和 WebSocket 推送闭环，为后续真实数据和受控券商适配器建立边界。

## 技术方案

- Fastify：HTTP API 与插件边界。
- `@fastify/websocket`：实时行情和账户事件推送。
- Zod：环境变量和订单请求校验。
- `tsx`：服务端 TypeScript 开发运行。
- Vitest：前后端统一测试。
- React + Vite：展示和操作层。

## 实施结果

- [x] 安装后端、WebSocket、校验和开发运行依赖。
- [x] 建立共享交易契约、服务端 TypeScript 配置和环境变量模板。
- [x] 实现模拟行情、内存交易仓库、PaperBroker 和风险引擎。
- [x] 暴露 REST 与 WebSocket API。
- [x] 将 React 市场和账户页面接入后端，并保留断线降级状态。
- [x] 更新 VS Code 为前后端一键断点调试。
- [x] 增加风险、撮合和 API 测试。
- [x] 更新架构、开发、状态、路线图和技术决策文档。

## 验证结果

```text
npm test
4 test files passed
15 tests passed

npm run build
TypeScript build passed
Vite production build passed
```

## 保留边界

- `REAL_TRADING_ENABLED=false`。
- `MARKET_MODE=live` 会拒绝启动。
- Token 只允许存放在未提交的 `.env.local`。
- 后端只实现模拟成交，不包含真实券商下单代码。
- MCP 不作为订单执行入口。
