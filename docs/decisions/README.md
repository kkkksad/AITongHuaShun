# 决策记录

本目录记录影响多个模块、难以逆转或需要长期解释的决定。

## 索引

- [0062：每日基线数值日界](0062-trading-day-baseline-numeric-membership.md)：一次UTC+8日界替代逐成交日期格式化，账务与风控结果保持，不缓存账户。

- [0061：布林带平价新仓边界](0061-bollinger-flat-entry-boundary.md)：完全平价或重合轨道不新买，原持仓退出纪律保持，真实微小变化不设任意门槛。

- [0060：RSI平价窗口中性约定](0060-neutral-rsi-flat-windows.md)：保留Cutler最近窗口公式，涨跌均零取50，防止已有持仓被错误视为超买。

- [0059：MACD增量回测状态](0059-incremental-macd-backtest-state.md)：逐根EMA保持数学/交易结果一致，移除全前缀重算，整体榜单未证明显著提速。

- [0058：实时客户端故障隔离](0058-websocket-client-transport-isolation.md)：传输异常不打断交易回调和其他客户端，重复注册幂等，90秒无pong实际清理。

- [0057：行业历史身份与时间](0057-sector-history-identity-and-time-boundary.md)：唯一请求行业、名称/代码一致、none复权及共享完整日线校验，冲突不覆盖。

- [0056：个股形态历史入口](0056-stock-regime-history-evidence-boundary.md)：真实交易先校验来源、前复权、请求股票和完整日线，Paper缓存按日线完成日期隔离。

- [0055：遗传搜索协作调度](0055-genetic-search-cooperative-scheduling.md)：正常、失败和缓存个体以及繁殖循环按单调切片放行宏任务，经济输出保持。

- [0054：合成初筛按需运行](0054-learning-pipeline-synthetic-research-on-demand.md)：研究管线进入与普通刷新不运行合成网格，保留缓存和显式研究。

- [0053：Paper计划审计时点](0053-paper-plan-audit-evidence-cutoff.md)：未来/无效时间不参与策略轮换与降级防守，单轮共用进入时证据快照。

- [0052：新增标的交易漏斗](0052-new-position-candidate-funnel.md)：分开持仓匹配、新股资格、初始独立金额与最终拟买，保留交易规则和旧响应兼容。

- [0051：Paper运行阶段耗时使用单调时钟](0051-paper-run-monotonic-stage-timing.md)

- [0050：真实行情Paper计划不等待合成参数榜](0050-real-paper-plans-independent-of-synthetic-ranking.md)

- [0049：历史调度的排队与工作耗时](0049-history-queue-and-work-timing.md)

- [0048：历史共享读取与调用方取消隔离](0048-history-shared-task-cancellation.md)

- [0047：多市场Paper独立资金与主账本迁移](0047-multi-market-paper-ledger-migration.md)

- [0046：单账户Paper账本必须匹配存储身份](0046-single-account-paper-ledger-binding.md)

- [0001：将代码仓库作为记录系统](0001-repository-as-record.md)
- [0002：采用 TypeScript 模拟交易后端栈](0002-simulation-backend-stack.md)
- [0003：真实行情只读接入与纸面执行隔离](0003-read-only-market-provider-boundary.md)
- [0004：东方财富只读行情与统一纸面执行边界](0004-eastmoney-read-only-paper-boundary.md)
- [0005：认证原型默认禁用与显式配置](0005-auth-prototype-fail-closed.md)
- [0006：强制服务端会话认证](0006-required-session-authentication.md)
- [0007：单用户部署允许八字符固定密码](0007-operator-defined-password-floor.md)
- [0008：手动 Paper 策略与市场路由解耦](0008-manual-paper-strategy-routing.md)
- [0009：多检查点 Paper 通知与事件额度](0009-multi-checkpoint-paper-notifications.md)
- [0010：Paper 账户取消固定比例现金预留](0010-no-fixed-paper-cash-reserve.md)
- [0011：回测胜率以已闭合FIFO配对为分母](0011-closed-fifo-backtest-win-rate.md)
- [0012：行情快照时间表示数据版本形成时间](0012-market-snapshot-version-time.md)
- [0013：域名证书独立签发与续期](0013-managed-domain-certificates.md)
- [0014：Paper 可用现金包含订单必要成本](0014-paper-execution-cash-costs.md)
- [0015：账户累计已实现盈亏采用净现金恒等式](0015-account-net-realized-pnl.md)
- [0016：初始化读取合并已接收的实时事件](0016-bootstrap-realtime-read-windows.md)
- [0017：Paper 待买暴露与费用后成交仓位](0017-paper-pending-buy-position-exposure.md)

- [0018：Service Worker只缓存公开静态资源](0018-service-worker-static-cache-boundary.md)

- [0020：Paper验证策略费用有效整手下限](0020-paper-probe-fee-efficient-lot-floor.md)

- [0021：Paper日亏损使用独立交易日权益基线](0021-paper-trading-day-risk-baseline.md)

- [0022：Paper挂单成交前重新核验统一风险](0022-paper-pending-order-risk-recheck.md)

- [0023：Paper新单与撮合按单票报价来源时间保护](0023-paper-quote-source-age-gate.md)

- [0024：Paper计划显式标记候选分区](0024-paper-candidate-tiers.md)

- [0025：同机SQLite旁路保存Paper长期复盘证据](0025-read-only-sqlite-paper-history.md)

- [0026：发布时复用相同运行内容的已验证镜像](0026-reuse-identical-runtime-images.md)

- [0027：核心研究先于辅助来源启动](0027-core-research-before-auxiliary.md)
- [0028：Paper完整持仓周期保存净成交结果](0028-paper-position-cycle-net-results.md)
- [0029：风险时钟与权益观察独立于交易计数](0029-risk-clock-and-equity-observation.md)
- [0030：主Paper风险按成交序列消费并保存检查点](0030-paper-risk-consumption-and-recovery.md)
- [0031：JSON账本单次变更统一提交与失败回退](0031-json-ledger-atomic-mutations.md)
- [0032：留存上一健康发布的源码和镜像材料](0032-retain-previous-healthy-release-assets.md)
- [0033：API运行镜像与前端静态产物分离](0033-separate-api-runtime-from-web-assets.md)
- [0034：Paper成交活动与委托提交分别按自身时间统计](0034-paper-fill-activity-time.md)
- [0035：发布前分别检查应用与Docker存储可用空间](0035-production-deployment-disk-preflight.md)
- [0036：真实策略验证先核对历史时点、股票和复权证据](0036-real-strategy-history-evidence-boundary.md)
- [0037：报价来源时间不得由抓取时间补齐](0037-quote-source-time-is-not-fetch-time.md)
- [0038：指定行情独立于全市场发现与历史研究](0038-requested-quotes-independent-of-discovery-and-history.md)
- [0039：稳健性证据逐股独立，胜率注明闭合分母](0039-strategy-evidence-is-per-symbol-and-closed-match.md)
- [0040：长期Paper归档通过有界只读摘要服务网站](0040-paper-history-bounded-read-model.md)
- [0041：按需采样API进程资源，区间与口径独立于主机容量](0041-api-process-resource-diagnostics.md)
- [0042：计划买单按统一执行成本和费用后权益选择整手](0042-paper-plan-post-cost-sizing.md)
- [0043：异步Paper计划绑定账户控制修订](0043-paper-execution-control-revision.md)
- [0044：研究缓存复用与实际读取预算分别有界](0044-bounded-research-admission.md)
- [0045：指定股票快照保留腾讯来源换手率](0045-requested-quote-turnover-percent.md)

## 新建格式

文件名使用 `NNNN-short-title.md`。

每份记录至少包含：

- 状态：提议、接受、取代或废弃。
- 日期。
- 背景。
- 决策。
- 结果与代价。
- 被取代关系。

只记录长期决策。一次性实施步骤应写入 `docs/plans/`。
