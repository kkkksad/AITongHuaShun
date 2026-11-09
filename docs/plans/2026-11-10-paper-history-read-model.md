# 模块20：长期归档运行证据接入网站

> 使用writing-plans规划、executing-plans在当前工作树逐项实施。只接当前账户世代的只读证据；每模块完整检查后提交、推送、部署。

**Goal:** 网站能够读取SQLite旁路保存的长期运行证据，区分休市、盘中、未知会话和实际阻塞，不再只依赖会被裁剪的进程内记录。

**Architecture:** 原一分钟采集器在采集成功后，从SQLite只读快照构建当前账户世代最近七个北京时间日期的有界JSON摘要。API只读取该文件，不在请求中启动Python/SQL/行情/策略；目录只读挂载、会话保护、账户世代匹配，超过三分钟明确过期。交易主账本继续独立。

**Tech Stack:** Python标准库SQLite、TypeScript/Zod、现有Fastify认证与React Query；不新增常驻进程或第三方数据库。

## 文件职责

- 新增`scripts/paper_history_read_model.py`、`scripts/test_paper_history_read_model.py`：固定七日、最多20000运行/20最新明细，严格SQL账户/世代/时刻条件、白名单聚合、原子发布。
- 修改`scripts/paper_history.py`：只新增会话白名单与摘要发布调用，旧记录缺会话保留unknown；发布失败不破坏已采集数据库，摘要自然转旧。
- 新增`shared/paperHistory.ts`、`server/research/paperHistoryArchive.ts`及测试：有界单次文件读取、严格解码、未来/过期/跨世代检查；只返回固定原因代码，不泄露路径或原始异常。
- 修改`TradingStore`及双Store：只读取得当前账户世代，内存Store返回null，不扩展公开账户资金结构。JSON重置/失败回退语义保持。
- 修改`server/config.ts`、`server/app.ts`、`docker-compose.production.yml`与发布目录准备：默认禁用文件接入；生产只挂载`runtime/archive/read-model`目录，不把SQLite/凭据挂到浏览器。
- 新增`src/components/PaperHistoryArchivePanel.tsx`及行为测试，接入研究页；API方法及Query Key独立，会话退出和账户重置清缓存。

## 步骤与验收

- [x] Python先复现缺入口；真实临时SQLite验证跨世代隔离、七日北京时间边界、未来排除、缺会话不补造、重复采样幂等、未知类别/凭据不输出、最大扫描上限与原子发布失败保留旧份。
- [x] 实现聚合和采集器接线，离线全套Python通过，Linux无网络临时沙箱再次核验。
- [x] 服务端先写已认证/匿名保护、坏/过大文件、未来、过期、世代不符和账户重置测试；实现GET `/api/research/paper-history`。固定文件路径只来自服务端配置。

```ts
if (model.accountEpoch !== expectedEpoch) return { state: "waiting-for-account", data: null };
if (Date.parse(model.generatedAt) > now.getTime()) return { state: "unavailable", data: null };
const state = now.getTime() - Date.parse(model.generatedAt) > 180_000 ? "stale" : "ready";
```

- [x] 页面展示七日范围、盘中/未知覆盖、提交尝试/有效字段覆盖和已记录阻塞；没有盘中样本不能归因“策略无信号”。重复规则次数不是拒单数、运行持久化会合并无变化轮次，不声称每分钟均有一条运行。
- [x] 部署脚本先创建受控目录，保持已知服务/发布留存规则；Linux替身契约验证准备次序、符号链接拒绝与失败保护。生产挂载/读取随发布再核验，不触发生产策略或消息。
- [x] 完整服务端、受影响前端与TS/Vite，维护0040决策及权威运维文档；独立提交推送部署见末项发布验收。
- [x] 源码/三健康/HTTPS/匿名保护/原账户/检查点/归档世代及上一版材料核验；生产仅只读读取新摘要。

## 限制

旁路只能保存安装之后且采集间隔内仍存在的记录，不是逐笔事件日志。只展示归档已有字段，不从零成交推断代码原因，不计算真实胜率或当前市值收益；账户重置后等待新世代采集，旧世代不会冒充当前。原SQLite256MiB/保留期限/备份规则保持。

## 发布前验证

- 最初Python/TS/前端新模块测试因入口不存在而导入失败，属于缺功能检查，不把它描述成业务缺陷复现。发布器新增三项在旧发布器实际失败，最终Linux63项通过。
- Linux归档30项通过，包含真实临时SQLite、七日/账户世代、SQL上限、原子替换及main接线。生产账本私有副本的采集与备份恢复通过，未修改生产主账本。
- 完整服务端136文件2080项、前端55文件360项与TS/Vite通过。随后新增刷新失败回归在旧组件失败，修复仅保留服务器时效状态，刷新失败由已有查询状态说明；最终受影响四文件42项通过。
- 只读生产SQLite私有在线副本聚合204条运行、七日2026-11-04至11-10，约5828字节；TS实际解码ready且内部epoch未公开。204条会话均缺证据，不能补造为休市。
- 隔离Chrome实际组件/CSS，ready/stale/waiting三状态×390/479/1440px共九组合，无页面横溢、七行/等待无旧数据/刷新实点通过，窄表格内部滚动。亲自查看窄/宽/等待截图；不是生产完整App浏览器验证。
- 最终文案修复后TS/Vite再次通过；首次生产目录已在同一发布锁内由ubuntu检查路径归属/无链接并创建0700，只准备目录，未修改账本。

## 发布验收

`ad695b85644e4080ca7787f73035df3fc896554e`已正常推送并独立部署。UTC21:24核验597源码文件/三个healthy、可信HTTPS健康200和匿名业务401；原20000元/零持仓订单/growth/auto/未暂停保持。风险cursor0/normal/峰值20000、savedAt保持17:54:57.651Z，未推进检查点。

分钟采集`readModelStatus=published`，SQLite205运行/72账户样本/integrity ok、世代摘要保持。新增205中的一条已有会话，旧204条仍unknown。实际容器使用已安装只读函数解码真实挂载，ready/205运行/204未知/内部epoch不公开；目录挂载RW=false且API未挂SQLite/备份。匿名HTTPS新路由401。认证响应由隔离HTTP测试覆盖，未绕过生产认证或声称完整生产浏览器登录验证。

上一6eec50d的585文件/三镜像及不覆盖私有导出通过；本次按源码和挂载配置替换API/web，bridge保持。发布期间只读资源样本可用内存2290900992字节、磁盘6372417536字节，不能代替盘中容量测量。
