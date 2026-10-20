# 策略、通知与模块导航优化计划

**状态：** 已部署（手动部署与 GitHub 推送完成）
**日期：** 2026-10-21
**分支：** `codex/hourly-project-optimization`

## 目标

在不放宽 Paper 硬风控的前提下，修复 T+1 和成交审计缺口，增加可回测、可路由、可复盘的新策略，将通知收敛为每个交易日 09:35 一条中文执行简报，并让所有主页面与二级模块都能被搜索和深链接直接打开。

## 范围

- 修复历史持仓缺少 `availableQuantity` 时的 T+1 可卖数量推导。
- 为订单补充 `filledAt`、`strategy`、可选 `strategyKey`，自动计划订单写入真实策略来源。
- 新增 3 个确定性策略：波动收缩放量突破、量价突破确认、质量低波趋势；同步接入回测、优化器、排行榜、稳健性、路由、候选评分、手动选择与测试。
- 将盘中简报收敛为每个 A 股真实交易日仅 09:35 一条（09:35–10:29 可补发，10:30 后停止）；周末、法定节假日不发送，风险异常只写内部审计。正文突出今日结论、动作、原因、资金与限制、最近成交和 Paper 边界。
- 建立统一模块目录，支持主页面和二级模块搜索、Ctrl/Cmd+K、URL query 深链接。
- 复盘可核实的最近 Paper 成交及缺失字段，不推断未保存的收益或策略。
- 更新产品、架构、状态和操作文档，运行全量验证并部署生产。

## 约束

- 当前仍为 `paper + akshare`，真实交易保持关闭。
- 不重置、删除或改写生产 Paper 账户、持仓和订单。
- 不放宽历史样本、流动性、追高、费用、现金、仓位、T+1、熔断和幂等约束。
- 新策略只使用决策时点及之前的数据，固定参数可复现。
- 不提交未跟踪的 `pnpm-lock.yaml`、`pnpm-workspace.yaml`。

## 实施与验证步骤

- [x] 修复 T+1 兼容推导并补回归测试。
- [x] 扩展订单成交审计字段并在两个 Store 和自动执行器贯通。
- [x] 实现 3 个新策略并接入全部策略注册点。
- [x] 补充新策略的回测、路由、手动过滤与持久化测试。
- [x] 重写单日单次 09:35 通知正文、交易日门禁和回归测试；风险异常只写审计。
- [x] 建立模块目录、二级深链接、全模块搜索与快捷键。
- [x] 核对生产最近成交和阻塞原因并记录复盘。
- [x] 更新文档、运行前后端测试、生产构建、可用部分的桥接检查与差异检查。
- [x] 提交、推送、手动部署并核验生产健康与安全边界。

## 验证结果

- `node .\node_modules\typescript\bin\tsc -b --pretty false`：通过。
- `node .\node_modules\vite\bin\vite.js build --config config/vite.app.config.js --configLoader runner`：通过，Vite 转换 2,324 个模块并生成生产构建。
- 服务端 `vitest run --dir server --environment node`：65 个测试文件、934 项测试全部通过。
- 前端 `vitest run --dir src --environment jsdom`：34 个测试文件、132 项测试全部通过；仍有一条既有 WebSocket 端口占用噪音，退出码为 0。
- `git diff --check`：通过。
- Python 桥接测试：在已构建的 `kairos-akshare-bridge:production` 容器中以测试专用空 `AKSHARE_BRIDGE_TOKEN` 运行，114 项通过；仅有 1 条 FastAPI/httpx 依赖弃用警告。临时测试文件已从容器和服务器清理。
- 生产部署：SHA `b9a75f986a49a96ffc376c32d420f2cc4a0cef5b` 已于 2026-10-21 04:06（Asia/Shanghai）手动部署；AkShare、backend、web 三个容器均 `healthy`。
- 公网核验：`/healthz` 返回 200；`/api/health` 返回 `paper + akshare + realTradingEnabled=false`；匿名 `/api/trading/account` 返回 401。
- 数据保留：部署前备份位于 `/opt/kairos/runtime/backups/paper-data-20261020T200645Z.tar.gz`，SHA-256 为 `9586b463db9a3ef1f161c8f1733930d500da6c0e5255e0a81b92498d1f001619`。部署后 Paper 状态未重置，仍为现金 89,524 元、4 只持仓、1 笔订单、972 条审计事件，`auditSequence=6232`。
- GitHub：`codex/hourly-project-optimization` 已推送到 `b9a75f9`，远端同步完成。

## 关键决策

- 增加交易次数依赖更多策略覆盖、明确的手动策略选择和合格候选，不通过降低历史、流动性、追高、费用、现金、仓位、T+1、熔断、阶段预算、每日上限或幂等门槛来凑成交。
- 手动固定策略不再被市场自动路由的 `allowNewPositions` 或 `newPositionScale` 直接否决，但仍服从全部 Paper 硬风控；`auto` 继续由市场状态路由。
- 通知是审计的补充而不是替代品；风险和数据异常保留在内部审计中，不额外推送。
- 旧持仓和旧订单缺失字段只做安全的兼容读取，不伪造历史策略、成交时间或收益。

## 遗留问题

- 生产部署、容器健康和公网接口核验已完成；当前生产 `executionStrategy` 仍为旧版 `rsi`，用户需要在设置页重新选择固定策略。
- Python 桥接测试已在生产镜像中补跑并通过；后续仍应在 GitHub Actions 中保留独立测试步骤，避免手动部署绕过 CI。
- 当前生产订单历史不足以重建逐笔收益、策略胜率或完整回撤，需在后续持续保留有界审计并另行导出研究汇总。
