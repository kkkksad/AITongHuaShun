# KAIROS Quant 文档地图

本目录是仓库知识的记录系统。`AGENTS.md` 负责导航，这里保存可以独立维护、核实和链接的真实信息。

## 权威文档

| 主题 | 文档 | 回答的问题 |
| --- | --- | --- |
| 当前状态 | [status/current-state.md](status/current-state.md) | 现在实际有哪些文件，哪些能力可运行？ |
| 产品范围 | [product/overview.md](product/overview.md) | 产品要解决什么问题，包含和不包含什么？ |
| 系统架构 | [architecture/system-overview.md](architecture/system-overview.md) | 模块如何划分，依赖方向是什么？ |
| 本地开发 | [operations/development.md](operations/development.md) | 如何安装、运行、测试和排错？ |
| 安全边界 | [safety/trading-boundaries.md](safety/trading-boundaries.md) | 数据和交易能力有哪些不可违反的约束？ |
| 路线图 | [roadmap.md](roadmap.md) | 外部能力按什么顺序接入？ |
| 决策记录 | [decisions/README.md](decisions/README.md) | 为什么采用当前长期方案？ |
| 执行计划 | [plans/README.md](plans/README.md) | 大型任务如何记录进度和验证结果？ |

## 信息归档原则

- 产品行为写入 `product/`。
- 稳定的系统边界写入 `architecture/`。
- 可重复执行的命令写入 `operations/`。
- 风险、权限和合规边界写入 `safety/`。
- 当前事实和临时缺口写入 `status/`。
- 不易逆转的选择写入 `decisions/`。
- 有起止时间的实施工作写入 `plans/`。

不要在多个文档中复制同一套规则。选择一个权威位置，其余文档链接过去。
