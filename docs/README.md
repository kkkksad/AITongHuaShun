# KAIROS Quant 文档地图

本目录是仓库知识的记录系统。`AGENTS.md` 负责导航，这里保存可以独立维护、核实和链接的真实信息。

## 权威文档

| 主题 | 文档 | 回答的问题 |
| --- | --- | --- |
| 当前状态 | [status/current-state.md](status/current-state.md) | 现在实际有哪些文件，哪些能力可运行？ |
| 固定分策略退出研究 | [research/2026-11-12-strategy-exit-lifecycle-review.md](research/2026-11-12-strategy-exit-lifecycle-review.md) | 216组共享资金/次开退出的费用、闭合分母、回撤及失败假设，哪些尚未上线？ |
| 11月11日夜间交付 | [research/2026-11-11-overnight-delivery.md](research/2026-11-11-overnight-delivery.md) | 最新上线的策略、性能、诊断与资金保留结果，以及仍未实现的事项？ |
| 最终固定策略复核 | [research/2026-11-11-final-fixed-strategy-review.md](research/2026-11-11-final-fixed-strategy-review.md) | 修复后代码的1224次固定真实历史实验与费用后闭合分母？ |
| 当前历史覆盖研究 | [research/2026-11-11-adaptive-coverage-and-bank-concentration.md](research/2026-11-11-adaptive-coverage-and-bank-concentration.md) | 模糊形态为何覆盖不足，银行相关性和固定策略的费用后证据如何？ |
| 11月10日夜间交付 | [research/2026-11-10-overnight-delivery.md](research/2026-11-10-overnight-delivery.md) | 本轮实际上线了什么、为什么仍需盘中验证、哪些仍未实现？ |
| 产品范围 | [product/overview.md](product/overview.md) | 产品要解决什么问题，包含和不包含什么？ |
| 未来优化蓝图 | [product/future-optimization.md](product/future-optimization.md) | 如何按市场状态选择策略，并逐步升级数据、风控、同花顺模拟接入和长期运行？ |
| 系统架构 | [architecture/system-overview.md](architecture/system-overview.md) | 模块如何划分，依赖方向是什么？ |
| 多市场独立资金 | [architecture/multi-market-paper-ledger.md](architecture/multi-market-paper-ledger.md) | 股票与期货如何分账、迁移和验收？哪些仍未实现？ |
| 本地开发 | [operations/development.md](operations/development.md) | 如何安装、运行、测试和排错？ |
| 服务器部署 | [operations/deployment.md](operations/deployment.md) | 如何用 HTTPS 和强制会话保护部署单实例？ |
| 长期复盘归档 | [operations/paper-history.md](operations/paper-history.md) | 如何运行同机SQLite采集、检查容量和核验备份？ |
| 安全边界 | [safety/trading-boundaries.md](safety/trading-boundaries.md) | 数据和交易能力有哪些不可违反的约束？ |
| 路线图 | [roadmap.md](roadmap.md) | 外部能力按什么顺序接入？ |
| 生产与交易复盘 | [research/](research/) | 最近 Paper 运行、成交与阻塞原因有哪些可核实事实？ |
| 决策记录 | [decisions/README.md](decisions/README.md) | 为什么采用当前长期方案？ |
| 执行计划 | [plans/README.md](plans/README.md) | 大型任务如何记录进度和验证结果？ |

## 信息归档原则

- 产品行为写入 `product/`。
- 稳定的系统边界写入 `architecture/`。
- 可重复执行的命令写入 `operations/`。
- 风险、权限和合规边界写入 `safety/`。
- 当前事实和临时缺口写入 `status/`。
- 不易逆转的选择写入 `decisions/`。
- 生产复盘与一次性研究结论写入 `research/`。
- 有起止时间的实施工作写入 `plans/`。

不要在多个文档中复制同一套规则。选择一个权威位置，其余文档链接过去。
