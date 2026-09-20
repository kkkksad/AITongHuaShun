# Paper Research Resilience and Rotation

**Date:** 2026-08-30
**Status:** Completed locally; not deployed

## Goal

继续优化 KAIROS Quant 的 Paper 研究链路，减少研究源暂时不可用时的页面错误，避免候选顺序抖动造成无效重算，并降低登录成功后的重复 bootstrap 请求。策略改动只服务于可解释的候选排序和 Paper 观察，不承诺成交、收益或胜率。

## Boundaries

- 仅使用本地 PaperBroker 和只读行情研究。
- 保持 `REAL_TRADING_ENABLED=false`，不连接真实券商，不读取、修改或输出生产凭据。
- 不绕过现金、手续费、仓位、T+1、熔断、阶段预算和每日 10 笔硬上限。
- 研究数据失败时返回降级证据，不用静态数据伪造行情或策略结果。

## Work Items

- [x] 让策略排行榜和 Paper 计划在无可交易快照时返回可解释的空研究结果。
- [x] 让 Paper 研究缓存键对同一标的集合的顺序变化保持稳定。
- [x] 移除登录成功后的重复交易 bootstrap 请求。
- [x] 为上述行为补充回归测试并完成全量验证。

## Verification

已完成（2026-08-30，本地）：Server Vitest 62 个文件、874 项通过；Web Vitest 31 个文件、116 项通过；`tsc -b`、Vite production build（2,322 个模块）和 `git diff --check` 均通过。`npx` 在当前 PowerShell 不在 PATH，本轮使用仓库已安装依赖和 Codex bundled Node 运行等价检查。代码尚未部署到服务器。
