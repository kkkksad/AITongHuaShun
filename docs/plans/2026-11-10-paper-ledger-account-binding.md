# 模块26：Paper账本账户身份绑定

> 使用writing-plans规划、executing-plans逐项实施；沿用用户持续升级与逐模块部署授权，不新增工作线程。

**Goal:** 拒绝把另一账户或身份缺失的JSON账本载入现有A股账户，避免多市场扩展或恢复文件放错路径时发生资金串账。

**Architecture:** JsonFileTradingStore当前只支持PAPER-CN-01。载入版本检查后、任何账户字段赋值、历史裁剪或旧世代迁移前，严格验证持久accountId与该Store固定身份一致。错误时不创建新账户、不修复/覆盖文件，保留人工恢复材料。

**Tech Stack:** TypeScript、真实文件系统fixture、Vitest；不新增数据库、服务或配置。

## 已核实事实

server/store/jsonFileTradingStore.ts与inMemoryTradingStore.ts固定账户PAPER-CN-01；JSON保存accountId但load从不检查或采用它。load对缺accountEpoch或过期历史会flush，将错误账户文件重写为当前账户身份，因此不只是界面显示不一致。当前生产仍是单A股账户；此修复不创建期货资金或撮合。

## 实施与验收

- [x] 在server/store/jsonFileTradingStore.accountIdentity.test.ts用真实Store创建有挂单/审计/账户控制的账本，再替换accountId为期货账户、其他股票账户、大小写不同、空格、空值、数字、对象或缺失；删除epoch和加入过期审计，让旧版执行自动保存路径。修复后断言构造抛固定身份错误、原始文件逐字节保持且没有新增文件。
- [x] 新测试旧版九项未拒绝而失败、一项正常控制通过；修复后合法PAPER-CN-01重新载入使用不同startingCash仍保留原资金、挂单、序号/控制与epoch，既有无epoch合法账本迁移通过。
- [x] 在server/store/jsonFileTradingStore.ts版本检查后增加严格accountId比较，失败抛固定错误，不输出不受信任身份内容，不提供自动改名或宽松回退。
- [x] 目标Store/原子/epoch/执行边界四文件63项、完整145服务端文件2173项、55前端文件366项与TypeScript/Vite通过。生产私有副本兼容与实际Linux镜像验证待发布后执行。
- [ ] 记录0046、状态/架构/安全边界与主计划；独立提交、推送/网络失败如实记录、同SHA归档部署；核验原资金/检查点/归档世代/HTTPS/上一版本。

目标命令使用node node_modules/vitest/vitest.mjs run --dir server --environment node --maxWorkers=1 --minWorkers=1，显式选择accountIdentity/atomic/epoch/controlBoundary。完整服务端与前端Vitest串行，不同时运行。

## 限制

此处是单账户存储身份校验，不构成多账户数据库隔离；订单契约仍没有账户/市场键。后续多市场必须显式路由独立Store/账户权限，并迁移复合身份与独立资金/风险/幂等域。缺身份旧文件需依据可信备份核对，不能为了让启动成功自动猜身份。
