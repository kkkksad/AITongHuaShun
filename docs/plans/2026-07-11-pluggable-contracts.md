# 可插拔架构 — 契约层实施计划

**状态：** 已完成（第一步）  
**日期：** 2026-07-11

## 目标

建立 `MarketDataProvider` 和 `TradingStore` 两个核心契约接口，使行情数据源和持久化后端可通过依赖注入替换，为后续接入真实数据和 PostgreSQL 打下基础。

## 实施内容

### MarketDataProvider 契约

- 文件：`server/contracts/MarketDataProvider.ts`
- 定义：`start()`, `stop()`, `tick()`, `getQuote()`, `getSnapshot()`, `on()`, `off()`
- MockMarket 实现该接口，通过 `implements MarketDataProvider` 声明
- 未来实现：AkShareProvider, TushareProvider, BrokerGatewayProvider

### TradingStore 契约

- 文件：`server/contracts/TradingStore.ts`
- 定义完整的交易数据持久化接口（账户 / 持仓 / 订单 / 审计四大领域）
- InMemoryTradingStore 实现该接口，通过 `implements TradingStore` 声明
- 未来实现：PostgresTradingStore, SQLiteTradingStore

### 依赖注入重构

- `PaperBroker` 构造函数参数类型从具体类改为契约接口
- `createTradingSystem()` 返回类型使用契约接口
- 各模块不再直接依赖具体实现类

### 契约一致性测试

- 文件：`server/contracts/contracts.test.ts` (18 tests)
- 验证 MockMarket 满足 MarketDataProvider 全部约定
- 验证 InMemoryTradingStore 满足 TradingStore 全部约定
- 验证 PaperBroker 通过契约接口组合工作

## 验证结果

```text
npm test
5 test files passed
42 tests passed

npm run build
TypeScript build passed
Vite production build passed
```

## 架构变化

```
Before:                         After:
PaperBroker                     PaperBroker
├── MockMarket (concrete)       ├── MarketDataProvider (contract)
└── InMemoryTradingStore        └── TradingStore (contract)
    (concrete)                  
                                MockMarket implements MarketDataProvider
                                InMemoryTradingStore implements TradingStore
```

## 后续步骤

1. 实现 `NewsProvider` 契约（模式相同）
2. 实现 PostgreSQL `TradingStore` 适配器
3. 接入 AkShare 实现 `MarketDataProvider`
