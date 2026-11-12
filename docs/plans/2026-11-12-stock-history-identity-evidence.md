# 有界逐股历史身份的实施计划

> 使用writing-plans制定，以executing-plans在现有隔离工作树逐步实施。

**Goal:** 让后续自然运行保留最多12只历史选择、响应身份、校验接纳和足够日线身份，补上只有数量无法复盘的缺口。

**Architecture:** 在现有marketRegimeResearch实际分析入口生成可选stockHistoryCoverage，沿原ResearchInputDiagnostics进入已有自动运行审计。携带原历史asOf，缓存复用不伪装当前抓取；旧记录/未进入研究/禁用/超时外层回退保持缺字段。只存六位代码和有限集合，不保存名称、原始响应、URL或供应商错误。长期Python压缩归档本项不扩展，不能声称已永久保留。

**Tech Stack:** TypeScript、Vitest、现有校验器、核心缓存与Paper审计。

## 合同与文件

- 新建server/research/stockHistoryCoverage.ts：scope=regime-stock-history、规范UTC asOf、selectedSymbols/returnedSymbols/acceptedSymbols/usableSymbols，每组≤12、唯一六位代码。returned只表示AkShare响应中出现请求内身份，重复/坏来源/复权仍可能不被accepted；accepted复用现有校验后的序列，可不足61根；usable使用实际非insufficient-data结果。所有集合按原选择顺序，严格嵌套，空列表为已观察无匹配身份，缺字段为未知。超过容量或输入身份非法不截断冒充完整选择，省略可选证据。
- 修改marketRegimeResearch.ts：可选合同及分析返回；不更改sourceStatus、排序、警告、历史请求或路由。非AkShare/外层回退不填证据。
- 修改researchInputDiagnostics.ts：只复制经严格校验的可选证据，丢弃附加任意字段；旧最简调用结果保持。
- 新建stockHistoryCoverage.test.ts；扩展marketRegimeResearch.historyEvidence.test.ts、scheduling.test.ts、researchInputDiagnostics.test.ts及paperAutoExecutor.test.ts。验证实际选择与部分返回、缓存时间、审计签名/JSON流转，不调用生产策略。
- 更新docs/decisions/0107-stock-history-identity-evidence.md、system-overview、安全边界、current-state与总流水。

## 顺序与验收

- [ ] 先写分析入口反例，运行旧版确认缺逐股证据；覆盖部分返回、请求外/重复/错误来源复权、未来/未完成导致不足、零返回和禁用未知。未选标的不得被加进记录。
- [ ] 实现最小纯投影与验证复制；检查≤12/唯一/子集/规范时间、旧记录未知、源数据和返回副本不相互污染、无任意字段泄露。
- [ ] 验证真实异步入口只使用冻结选择、行业历史优先和原请求数；核心缓存复用时证据asOf仍是原起点，不能写新抓取时间。既有资金/路由决策保持。
- [ ] 一次一个Vitest跑目标、完整server和src、TS/Vite。固定216组两次及独立逐笔控制保持（如本项不影响对应研究入口，明确其覆盖边界）。Python无改继承177/36。
- [ ] 独立提交推送部署，实际API镜像禁网隔离全套、SHA/归档/三健康/可信HTTPS/匿名401/动态经济与完整风险摘要/上一发布材料。发布文档回执并确认已测三容器保持后再开始下一代码模块。

UTC20:03登记。上一ba87d48研究发布820文件及全部保护/已测三容器已核验。截止UTC23:40冻结/00:00结束与现有heartbeat保持；本项不增加交易、并发或期货执行。
