# 有界逐股历史身份的实施计划

> 使用writing-plans制定，以executing-plans在现有隔离工作树逐步实施。

**Goal:** 让后续自然运行保留最多12只历史选择、响应身份、校验接纳和足够日线身份，补上只有数量无法复盘的缺口。

**Architecture:** 在现有marketRegimeResearch实际分析入口生成可选stockHistoryCoverage，沿原ResearchInputDiagnostics进入已有自动运行审计。携带原历史asOf，缓存复用不伪装当前抓取；旧记录/未进入研究/禁用/超时外层回退保持缺字段。只存六位代码和有限集合，不保存名称、原始响应、URL或供应商错误。长期Python压缩归档本项不扩展，不能声称已永久保留。

**Tech Stack:** TypeScript、Vitest、现有校验器、核心缓存与Paper审计。

## 合同与文件

- 新建server/research/stockHistoryCoverage.ts：scope=regime-stock-history、规范UTC asOf、selectedSymbols/returnedSymbols/acceptedSymbols/usableSymbols，每组≤12、唯一六位代码。returned只表示AkShare响应中出现请求内身份，重复/坏来源/复权仍可能不被accepted；accepted复用现有校验后的序列，可不足61根；usable使用实际非insufficient-data结果。所有集合按原选择顺序，严格嵌套，空列表为已观察无匹配身份，缺字段为未知。超过容量或输入身份非法不截断冒充完整选择，省略可选证据。
- 修改marketRegimeResearch.ts：可选合同及分析返回；不更改sourceStatus、排序、警告、历史请求或路由。非AkShare/外层回退不填证据。
- 修改researchInputDiagnostics.ts：只复制经严格校验的可选证据，丢弃附加任意字段；旧最简调用结果保持。
- 新建stockHistoryCoverage.test.ts；扩展marketRegimeResearch.historyEvidence.test.ts、scheduling.test.ts、researchInputDiagnostics.test.ts、paperTradingPlanService.scheduling.test.ts及paperAutoExecutor.test.ts/executionTime.test.ts。验证实际选择与部分返回、缓存时间、审计签名/JSON流转，不调用生产策略。
- 更新docs/decisions/0107-stock-history-identity-evidence.md、system-overview、安全边界、current-state与总流水。

## 顺序与验收

- [x] 先写分析入口反例，运行旧版确认缺逐股证据；覆盖部分返回、请求外/重复/错误来源复权、未来/未完成导致不足、零返回和禁用未知。未选标的不得被加进记录。
- [x] 实现最小纯投影与验证复制；检查≤12/唯一/子集/规范时间、旧记录未知、源数据和返回副本不相互污染、无任意字段泄露。
- [x] 验证真实异步入口只使用冻结选择、行业历史优先和原请求数；核心缓存复用时证据asOf仍是原起点，不能写新抓取时间。既有资金/路由决策保持。
- [x] 一次一个Vitest跑目标、完整server和src、TS/Vite。固定216组两次及独立逐笔控制保持（如本项不影响对应研究入口，明确其覆盖边界）。Python无改继承177/36。
- [x] 独立提交推送部署，实际API镜像禁网隔离全套、SHA/归档/三健康/可信HTTPS/匿名401/动态经济与完整风险摘要/上一发布材料。发布文档回执并确认已测三容器保持后再开始下一代码模块。

UTC20:03登记。上一ba87d48研究发布820文件及全部保护/已测三容器已核验。截止UTC23:40冻结/00:00结束与现有heartbeat保持；本项不增加交易、并发或期货执行。

UTC20:12：b413183研究回执821文件及全部保护/已测三容器保持核验后实施。首批九业务控制旧版八失败/一超容量兼容；最终身份入口/严格复制/缓存原时点/零单审计流转通过，目标252（末加两报告时点控制待全套包含）与完整188文件3069后端通过。首轮新增测试清空共享Map导致15失败，夹具改为先复制Map后原业务断言保持；首轮TS暴露空数组never[]推断，补显式测试类型后通过，未放宽生产合同。当前前端完整及最终构建/冻结研究控制在途，未发布或声称收益改变。

UTC20:16本地最终验证：34新增包含在完整3069后端内，63文件439前端及最终TS/Vite通过。新证据是纯投影：固定真实12股历史的0/60/61/180/500根×完整/部分/错供应方/重复/请求外/错复权/仅未来共35组，去掉新增可选字段后与b413183的原分析完整报告相同；原始响应未变、诊断身份一致。runtime/2026-11-12-history-identity-projection-controls.json SHA=53c83432c69fc8fe2467191691910dab6b44016cb5393c392b2f74f9d98dbe08；该控制不重放完整行业/在线路由。

固定退出216组两次字节一致SHA=beb77ac47d2078f93a2cd91fa3ba1ca7b1dc9cd1e26cb52851fbdc0f1ac29307，全部结果/6024成交与时段修复基线相同，记录的研究运行源码哈希全保持。独立核验资金/实际费用/FIFO/T+1/库存/权益/观察回撤与72 native保持通过；该独立策略研究不调用新增在线投影，不能替代前述35组与服务/执行器测试。Python177/36未改继承。准备独立提交推送部署及实际API镜像全套，生产验收尚未完成。

UTC20:22发布验收：485a00c3424b5d34d23b3e080ea2d135a3dba742已推送部署，824归档文件及实际字节哈希、三健康、可信双域HTTPS/匿名401、动态原账户经济摘要与完整风险检查点、上一b413183源码/三镜像和私有导出全部通过。实际生产API镜像禁网隔离188文件3069后端通过（93.91秒），无生产数据/凭据挂载。直连推送低速失败结束后经既有安全通道成功，再发布；未改全局网络设置或关闭TLS。

证据runtime/2026-11-12-history-identity-release-summary.json、history-identity-production-server.log及本计划前述本地材料。原账户动态观察12812现金/四仓六单仅为当时值，不作后续发布硬断言；没有手动触发生产策略或补造历史身份。文档回执部署时核对本次已测三容器保持，下一项[长期身份归档](2026-11-12-stock-history-identity-archive.md)先复现字段被压缩丢弃，再最小修复。
