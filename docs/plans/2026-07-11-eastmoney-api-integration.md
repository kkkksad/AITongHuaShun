# 东方财富只读行情与纸面适配器

**日期：** 2026-07-11
**状态：** 已完成安全收敛

## 目标

1. 使用东方财富公开行情接口实现只读 `MarketDataProvider`。
2. 提供仅维护本地模拟账户的纸面 `BrokerAdapter` 演示。
3. 不读取真实券商凭据，不发送真实订单，不提供实盘开关。

## 架构

```text
server/broker/eastmoney/
├── EastMoneyMarketProvider.ts   # 只读公开行情适配器
├── EastMoneyBrokerAdapter.ts    # 本地纸面账户演示
├── eastMoneyApi.ts              # 公开行情 HTTP 客户端
└── eastmoney.test.ts            # 离线单元测试
```

## 行情数据

东方财富公开行情接口不需要账户认证，但仍必须记录来源、抓取时间、市场时区、更新频率和供应商使用条款。该提供器当前未接入默认 `createTradingSystem`，本地系统仍使用 `MockMarket`。

## 纸面交易

- `EastMoneyBrokerAdapter` 只维护本地模拟现金、持仓和订单。
- `tradingEnabled=true` 或 `environment=live` 会在构造阶段直接失败。
- 源码中不包含 `/order/submit`、券商授权头或真实账户 Token。
- 该适配器不代表东方财富官方交易接口，也不能用于真实资金。

## 安全约束

- 默认系统继续使用 `PaperBroker` 和 `RiskEngine`。
- 真实执行必须由独立项目、独立部署、密钥管理、账户白名单、逐笔审批和审计体系实现。
- 浏览器、MCP 或研究智能体不得直接获得订单执行权限。

## 验证

- [x] `eastMoneyApi.ts` 公开行情客户端。
- [x] `EastMoneyMarketProvider.ts` 只读行情提供器。
- [x] `EastMoneyBrokerAdapter.ts` 删除真实订单 HTTP 分支。
- [x] `eastmoney.test.ts` 验证 paper 行为与 live 拒绝。
