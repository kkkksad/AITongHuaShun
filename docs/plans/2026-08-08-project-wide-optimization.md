# KAIROS Quant 全局优化执行计划

**状态：** 已完成
**日期：** 2026-08-08
**范围：** 策略研究证据、代码可维护性、总览加载性能与验证部署

## 背景与取舍

本轮参考聚宽社区中多因子排序、换手率甜蜜区、持仓纪律、动态风控和策略轮动等研究主题，只迁移可解释的研究方法，不复制社区代码或收益宣传。系统继续保持 Paper-only；不会为了增加每日交易次数而放宽市场状态、T+1、现金、费用、仓位、节奏、熔断或人工边界。

一小时迭代优先完成三个可独立验收的改动：

1. 每日优质股将宽平台式换手率评分改为有界、非线性的健康换手区评分，并明确低换手、高换手和字段缺失原因。
2. 真实历史多窗口稳健性报告补充平均夏普、平均盈亏比、证据分和脆弱性标记；证据分只衡量样本完整性、一致性和尾部风险，不作为未来收益概率。
3. 总览页把首屏下方的回测图表、资金流和新闻放到接近视口时再挂载，延迟 Recharts 大包和新闻请求，并保留稳定占位高度。

## 实施步骤

### 1. 策略评分

- 在 `server/research/dailyQualityStocks.test.ts` 增加换手率甜蜜区、过低/过热风险和未知字段测试。
- 在 `server/research/dailyQualityStocks.ts` 实现确定性非线性换手评分，升级方法版本并更新可解释文案。
- 保持综合权重、候选数量和下游 Paper 历史/风险闸门不变。

### 2. 稳健性证据

- 扩展 `server/research/strategyRobustness.test.ts`，覆盖新增指标、证据分边界和低样本脆弱性。
- 在 `server/research/strategyRobustness.ts` 聚合现有回测指标，生成 0-100 的确定性证据分和脆弱性标记。
- 同步 `src/lib/tradingApi.ts` 类型与 `src/components/StrategyRobustnessPanel.tsx` 紧凑展示。
- 更新方法说明，明确证据分不是盈利概率。

### 3. 首屏性能

- 新增 `src/components/ViewportDeferred.tsx` 与测试，使用 `IntersectionObserver` 在接近视口时一次性挂载内容；不支持该 API 时立即显示。
- 在 `src/App.tsx` 延迟总览下方的 `BacktestResults`、`FlowPanel` 和 `NewsPanel`。
- 在 `src/styles/index.css` 增加稳定占位和稳健性标签样式，确保移动端宽表仍只在模块内横向滚动。

### 4. 验证与交付

- 运行新增聚焦测试、完整 Server/Web Vitest、Python pytest、`tsc -b` 和 Vite production build。
- 对比构建分块并用浏览器检查桌面与 390px 手机视口，确认无页面级横向溢出、延迟模块能正常出现。
- 运行 `git diff --check` 和凭据模式扫描，更新 `docs/status/current-state.md` 与本计划验证结果。
- 提交并推送功能分支，合并到生产分支，等待部署工作流并复核健康端点。

## 验收标准

- 评分在相同快照下完全确定，健康换手区分数高于极低和过热区。
- 稳健性条目包含证据分与脆弱原因，低于 3 个窗口或 6 笔交易不能被描述为充分证据。
- 初次打开总览时，视口之外的三个模块不挂载；接近视口后只挂载一次。
- 所有测试与构建通过，Paper-only 和现有风险边界未改变。

## 验证结果

- Server Vitest: 55 files, 825 tests passed.
- Web Vitest: 30 files, 103 tests passed.
- Python pytest: 109 tests passed；保留 1 条 FastAPI/httpx 弃用警告和 1 条本地 pytest 缓存权限警告。
- `tsc -b` 通过；Vite production build 通过，2,321 个模块转换。
- 浏览器桌面与 390x844 检查通过：总览首屏三个延迟模块均未挂载，快速滚动后三个模块均挂载，页面横向溢出为 0，图表挂载后存在非空 SVG；稳健性界面显示证据分、平均夏普、平均盈亏比和脆弱性标签。
- 本地 API 重启后健康端口恢复监听并完成真实稳健性接口联动。
- 生产服务器通过受限部署入口完成构建与容器替换；AkShare、Fastify 和 Nginx 三个容器均为 healthy。公网 HTTP 自动跳转 HTTPS，`/healthz`、HTTPS 首页和 `/api/health` 返回 200；健康信息确认 `paper + akshare`、认证开启、真实交易关闭。
- GitHub HTTPS、浏览器和本地 SSH 写入链路均受当前网络或密钥授权限制，远端分支推送未完成；生产部署不依赖该未完成项。
