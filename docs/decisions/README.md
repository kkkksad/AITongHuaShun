# 决策记录

本目录记录影响多个模块、难以逆转或需要长期解释的决定。

## 索引

- [0001：将代码仓库作为记录系统](0001-repository-as-record.md)
- [0002：采用 TypeScript 模拟交易后端栈](0002-simulation-backend-stack.md)
- [0003：真实行情只读接入与纸面执行隔离](0003-read-only-market-provider-boundary.md)
- [0004：东方财富只读行情与统一纸面执行边界](0004-eastmoney-read-only-paper-boundary.md)
- [0005：认证原型默认禁用与显式配置](0005-auth-prototype-fail-closed.md)
- [0006：强制服务端会话认证](0006-required-session-authentication.md)
- [0007：单用户部署允许八字符固定密码](0007-operator-defined-password-floor.md)
- [0008：手动 Paper 策略与市场路由解耦](0008-manual-paper-strategy-routing.md)
- [0009：多检查点 Paper 通知与事件额度](0009-multi-checkpoint-paper-notifications.md)
- [0010：Paper 账户取消固定比例现金预留](0010-no-fixed-paper-cash-reserve.md)
- [0011：回测胜率以已闭合FIFO配对为分母](0011-closed-fifo-backtest-win-rate.md)
- [0012：行情快照时间表示数据版本形成时间](0012-market-snapshot-version-time.md)
- [0013：域名证书独立签发与续期](0013-managed-domain-certificates.md)
- [0014：Paper 可用现金包含订单必要成本](0014-paper-execution-cash-costs.md)
- [0015：账户累计已实现盈亏采用净现金恒等式](0015-account-net-realized-pnl.md)
- [0016：初始化读取合并已接收的实时事件](0016-bootstrap-realtime-read-windows.md)
- [0017：Paper 待买暴露与费用后成交仓位](0017-paper-pending-buy-position-exposure.md)

- [0018：Service Worker只缓存公开静态资源](0018-service-worker-static-cache-boundary.md)

- [0020：Paper验证策略费用有效整手下限](0020-paper-probe-fee-efficient-lot-floor.md)

- [0021：Paper日亏损使用独立交易日权益基线](0021-paper-trading-day-risk-baseline.md)

- [0022：Paper挂单成交前重新核验统一风险](0022-paper-pending-order-risk-recheck.md)

- [0023：Paper新单与撮合按单票报价来源时间保护](0023-paper-quote-source-age-gate.md)

- [0024：Paper计划显式标记候选分区](0024-paper-candidate-tiers.md)

- [0025：同机SQLite旁路保存Paper长期复盘证据](0025-read-only-sqlite-paper-history.md)

- [0026：发布时复用相同运行内容的已验证镜像](0026-reuse-identical-runtime-images.md)

- [0027：核心研究先于辅助来源启动](0027-core-research-before-auxiliary.md)
- [0028：Paper完整持仓周期保存净成交结果](0028-paper-position-cycle-net-results.md)
- [0029：风险时钟与权益观察独立于交易计数](0029-risk-clock-and-equity-observation.md)
- [0030：主Paper风险按成交序列消费并保存检查点](0030-paper-risk-consumption-and-recovery.md)
- [0031：JSON账本单次变更统一提交与失败回退](0031-json-ledger-atomic-mutations.md)
- [0032：留存上一健康发布的源码和镜像材料](0032-retain-previous-healthy-release-assets.md)

## 新建格式

文件名使用 `NNNN-short-title.md`。

每份记录至少包含：

- 状态：提议、接受、取代或废弃。
- 日期。
- 背景。
- 决策。
- 结果与代价。
- 被取代关系。

只记录长期决策。一次性实施步骤应写入 `docs/plans/`。
