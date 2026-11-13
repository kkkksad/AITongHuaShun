# 真实历史稳健性表的闭合样本核对

当前聊天使用writing-plans、executing-plans、kairos-quant-validation和kairos-release-verification逐项实施。基线251eae4，0130及唯一回执已完成；UTC23:40停止新复杂代码及所有发布，UTC11月14日00:00截止，不顺延。

**目标：** 真实历史稳健性表不能将无盈利分子、非法分母、非有限或不一致比例显示为可信闭合片段胜率；合法旧报告、真实零和服务端四位小数保持。

**架构：** 在StrategyRobustnessPanel局部解析闭合证据，检查safe integer的0≤wins≤total、有限0至1比例及与服务端四位舍入的wins/total一致。零闭合仅wins=0且rate=null是合法无样本；缺分子/分母显示未提供，矛盾显示不可核对。只替换单元格，不重算排名/证据分/门槛或请求。

**技术：** React、TypeScript、Vitest/jsdom、既有TanStack缓存夹具、隔离浏览器及现有发布工具。

## 步骤

- [x] Extend src/components/StrategyRobustnessPanel.test.tsx：真实零闭合、全亏0%、全赢100%、1/3服务端0.3333舍入控制；缺wins/total、负数、小数、不安全整数、wins>total、NaN/Infinity、rate超范围及分子分母矛盾。只检查目标单元格，保证缓存旧响应不额外请求，不改原排名/交易数/逐股切换。
- [x] 旧版目标运行记录：`node node_modules/vitest/vitest.mjs run --dir src --environment jsdom src/components/StrategyRobustnessPanel.test.tsx --maxWorkers=2 --minWorkers=1`。真实失败必须是该单元格错误数字或无法区分坏分母，不是假定旧版报告真实存在。
- [x] Modify src/components/StrategyRobustnessPanel.tsx：导入entry类型、添加局部closedMatchEvidence，按实际服务端`Math.round((wins / total) * 10_000) / 10_000`合同核对比例。缺分母/分子/比例分别提示；矛盾显示不可核对。渲染未知破折号及固定提示；没有新网络、样本重建、策略参数或后台修改。
- [x] 目标及完整src单个Vitest、server/app TS/Vite；server3438/桥接308/归档41无改继承，不重跑。固定合法样本对照保持旧单元格输出与完整报告输入；以隔离浏览器检查有效/无样本/缺失/矛盾四状态，390/768/1440三个宽度，无外部fetch。
- [x] 更新0131决策、产品/状态和总计划，独立提交推送exit0且HEAD=upstream/干净树后部署。新鲜完整经济/风险、实际归档SHA/字节哈希、三健康、双域可信HTTPS/匿名401、上一251eae4源码/三镜像/私有导出与覆盖拒绝。确认后端/桥接容器及镜像保持，只更新网页。
- [ ] 源码验收后仅一次文档回执，核对三个已测容器严格保持，最终写runtime/handoff不递归。

## 边界

仅展示合同校验，未证明来源可信或样本独立，也不将100万元逐股研究等同当前2万元组合或未来成功率。当前合法后端按四位小数输出，不能用严格原始分数比较误伤1/3等有效比例。不改任何排名/证据分或交易默认。

## 流水

- UTC22:34前：代码确认真实表仅非null/total>0即展示，缺盈利数或坏分母仍可显示25%乃至NaN%；合成榜已有独立校验，真实表尚未接。先登记计划及针对性反例。

- UTC22:38前本地完成：33目标/旧版22失败11控制，完整67文件537前端（68.83秒）、server/app TS与Vite通过。35组实际组件完整HTML及完整报告输入保持；四状态×三宽度12浏览器无外部fetch、无页面横溢出，手机矛盾状态截图人工核查。证据runtime/2026-11-13-robustness-closed-sample-{old-tests,new-tests,src-tests,compatibility}.json和runtime/robustness-closed-browser-2e5400e103/result.json。尚待提交发布；后端3438/桥接308/归档41只继承。

- UTC22:43：源码9dd3d01393237791d7c8f9d67b90390d5f241662已push/deploy exit0，HEAD=upstream且干净。916实际归档文件、三健康、双域6项系统可信HTTPS/匿名401、完整经济/风险摘要和上一251eae4源码/三镜像/私有导出及覆盖拒绝全部通过；API/桥接容器及镜像严格保持，继承的真实生产API3438测试镜像身份再次匹配。仅web更新，稳健性新chunk实际容器字节与公网可信HTTPS逐字节/哈希一致。证据runtime/2026-11-13-robustness-closed-sample-release-summary.json和-production-web.json。当前为唯一文档回执，随后核对三已测容器严格保持，结果写runtime/handoff，不递归。
- 网络：MinGit两次直连push exit1，另一个公开读取超时；现有系统Git使用新官方元数据中已系统TLS验证的20.200.245.247命令级解析，先公开ls-remote exit0再认证push exit0。未改全局配置、TLS信任或搬运凭据；未创建SSH隧道。首次check-only在提交前被干净树保护拒绝，未部署；提交推送后正常通过。
