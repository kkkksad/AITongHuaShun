# 决策记录

本目录记录影响多个模块、难以逆转或需要长期解释的决定。

## 索引

- [0112：冻结入场研究单位声明](0112-frozen-entry-volume-declaration.md)：显式手/股及原输入SHA绑定，防止归一化载荷重复乘100，声明不等于来源真实性证明。

- [0111：空历史正文继续回退](0111-empty-stock-history-provider-fallback.md)：主源None/零行尝试既有腾讯，逐股部分返回/警告与有界容量保持。

- [0110：发现快照成交量股单位](0110-discovery-spot-volume-in-shares.md)：东财手仅转换一次，新浪/腾讯保持，缺时点不可交易；日线另案。

- [0077：波动收缩突破实际持仓](0077-contraction-breakout-actual-holdings.md)：历史区间和量价门槛保持，按实际均价/可卖整手退出。
- [0076：量价突破实际持仓](0076-volume-price-breakout-actual-holdings.md)：拒单/T+1后重读，不混合股票历史，原放量/日内位置过滤保持。
- [0075：质量低波实际持仓](0075-quality-low-vol-actual-holdings.md)：拒单后重新评估，原暖机/趋势效率/波动过滤保持，实际均价阈值差异完整记录。

- [0074：洗盘恢复实际持仓](0074-washout-recovery-actual-holdings.md)：绑定单股，拒单/T+1后按实际均价与可卖整手评估，保留量比/趋势门槛。

- [0073：合成榜闭合样本分母](0073-synthetic-leaderboard-closed-samples.md)：未平仓/空榜/旧坏样本未知，盈利/闭合分母与成交单数分开，不改评分或排序。

- [0072：回测单根账户复用](0072-backtest-same-bar-account-reuse.md)：复用私有撮合后账户，空信号少重建，有信号仍重读，无跨bar缓存。

- [0071：北京时间日期键单槽复用](0071-beijing-date-key-bounded-reuse.md)：缓存不可变日期标签，保留非法/溢出/回拨语义，不缓存账户和风险。
- [0070：缩量回撤实际持仓](0070-quiet-pullback-actual-holdings.md)：拒单/T+1后重查实际持仓、成交均价和可卖整手，绑定单股。
- [0069：回测实际回放期限](0069-backtest-replay-bar-period.md)：初始资金基准不作额外交易日，保留252根日线/年假设。
- [0068：新标的漏斗归档](0068-new-position-funnel-archive.md)：Python/Node白名单及有界只读页面，旧记录未知、拟买不等于成交。
- [0067：强势回踩实际持仓](0067-pullback-actual-holdings.md)：信号意图与真实回测持仓分离，退出按成交均价和可卖数量。
- [0066：回测回调观察副本](0066-backtest-callback-observation-copies.md)：生命周期对象修改不污染引擎定量、估值和报告。
- [0065：行业快照结构隔离](0065-sector-snapshot-structure-isolation.md)：坏行业响应不丢独立股票研究，有效部分保留，结构不代替来源时间。

- [0064：历史提供者证据隔离](0064-historical-provider-evidence-isolation.md)：拥有输入副本，读出及事件不能污染历史；标量回放时钟避免复制报价。

- [0063：低波趋势实际持仓](0063-low-vol-trend-actual-holdings.md)：绑定单股，拒单/T+1后读取实际仓位，以滑点后均价和可卖整手判断。

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

最新补充：[0078：可买整手候选优先取得Paper历史名额](0078-affordable-lots-prioritize-paper-history.md)。

[0079：Paper辅助研究使用有界后台快照](0079-paper-auxiliary-background-snapshots.md)。

[0080：Paper逐股阻塞说明与有界审计取样](0080-paper-blocker-evidence-sampling.md)。

文件名使用 `NNNN-short-title.md`。

每份记录至少包含：

- 状态：提议、接受、取代或废弃。
- 日期。
- 背景。
- 决策。
- 结果与代价。
- 被取代关系。

只记录长期决策。一次性实施步骤应写入 `docs/plans/`。
