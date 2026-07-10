# EastMoney API 对接

**日期：** 2026-07-11
**状态：开发中**

## 目标

实现东方财富 API 对接，分两步：
1. **行情数据提供者** — 实现 MarketDataProvider 契约，获取 A 股实时行情
2. **券商适配器** — 实现 BrokerAdapter 契约，对接东方财富交易接口

## 架构

```
server/broker/eastmoney/
├── EastMoneyMarketProvider.ts   # MarketDataProvider 实现
├── EastMoneyBrokerAdapter.ts    # BrokerAdapter 实现
├── eastMoneyApi.ts              # 底层 HTTP API 客户端
├── eastMoney.test.ts            # 测试
```

## 行情数据

使用东方财富公开行情 API（无需认证）：
- 实时行情：`push2.eastmoney.com/api/qt/stock/get`
- 板块列表：`push2.eastmoney.com/api/qt/clist/get`
- 支持沪深两市全部 A 股

## 交易接口

东方财富券商交易接口（需认证）：
- 使用 BrokerAdapter 契约接口
- 支持市价单/限价单
- 支持订单查询、持仓查询、账户查询
- 初始版本使用模拟模式（mock 响应），真实连接需配置凭证

## 安全约束

- 默认仅行情读取，不下单
- 真实交易需显式设置 `EASTMONEY_TRADING_ENABLED=true`
- 所有 API 调用记录审计日志
- 请求频率限制，防止被封 IP

## 进度

- [ ] eastMoneyApi.ts - HTTP API 客户端
- [ ] EastMoneyMarketProvider.ts - 行情数据提供者
- [ ] EastMoneyBrokerAdapter.ts - 券商适配器
- [ ] eastMoney.test.ts - 测试
