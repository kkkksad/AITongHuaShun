# 模块27：多市场独立资金与主账本迁移设计

> 使用writing-plans编写、executing-plans完成文档核对；本模块只交付设计与验收顺序，不激活数据库主账本或期货撮合。用户已授权持续升级，不需要再次确认这项可审核设计。

**Goal:** 明确股票与期货如何保持独立资金，并给出适合现有单机的事务账本、兼容迁移、合约规则及故障恢复方案。

**Architecture:** 行情读取共享，执行按账户/市场/世代隔离。目标单writer事务SQLite先通过驱动与离线迁移验收再替换JSON主账本；现有SQLite归档继续只读旁路。期货必须独立具体合约/保证金/夜盘/结算，研究主连不能直接撮合。

**Tech Stack:** 当前React/TypeScript/Fastify、Node20 Docker、Python标准库SQLite归档；新主账本驱动尚未选定或安装。

## 文件职责

- 新建docs/architecture/multi-market-paper-ledger.md：权威目标设计，区分当前事实/目标/阻塞，定义身份与资金原子性、迁移激活和回滚、期货准入与容量条件。
- 新建docs/decisions/0047-multi-market-paper-ledger-migration.md：记录单机事务账本方向、保留当前账户、无自动跨账户资金与先验证后激活。
- 修改docs/architecture/system-overview.md、docs/README.md、docs/roadmap.md：只链接权威设计，旧PostgreSQL泛化方向明确仍未落地。
- 修改docs/status/current-state.md、主夜间计划：精确标记设计完成、主账本/独立期货资金尚未实现，不把设计当上线交易。

## 步骤与验收

- [x] 核对shared/trading.ts、server/system.ts、两个Store、paperBroker与crossMarketStrategyContext、Python主连缓存及Docker Node版本；记录实际缺口。
- [x] 写出所有订单/资金/幂等/风险复合身份、隔离不变量与失败时原子结果；保留原PAPER-CN-01的20000资金和世代，不猜期货初始本金。
- [x] 写出有界单writer/锁期限/数据库位置与备份要求、驱动兼容门槛、资金数值兼容及活跃writer隔离；拒绝双写与错误回退丢交易。
- [x] 写出离线预检、静止源导入、两端对账、原子激活、激活前回退与有新交易后的前向修复；逐项给出验收条件。
- [x] 写出具体合约报价、规则版本、保证金/费用、多空/开平、交易日归属、每日结算及独立账户故障矩阵，未通过保持只读。
- [x] 自查状态一致性和七文档135个本地Markdown目标；无业务代码改动不增加实现镜像测试。沿用模块26完整测试，9743f73独立部署、UTC22:57核验625文件/三健康/可信HTTPS/原账户/检查点/归档世代及上一fe755a8材料；三个容器/实际镜像均保持。UTC22:59正常推送包含模块26和本模块。

## 发布边界

本模块不安装新的常驻服务、不暴露数据库端口、不修改生产资金或报价频率、不创建真实或模拟期货订单。后续实现按设计分成可独立验收的适配器、迁移工具、账户路由、具体合约撮合和结算模块；既有A股账户继续可用。

## 设计验证记录

实际核对shared/trading.ts、system.ts、双Store、paperBroker、crossMarketStrategyContext、Python期货缓存与Docker Node20；已实现/目标/缺口逐项区分。七份相关文档的135个本地Markdown目标均存在；无业务或配置改动，沿用模块26完整145服务端2173项、55前端366项及TS/Vite。未创建新资金、安装主账本驱动或触发订单，发布核验待完成。
