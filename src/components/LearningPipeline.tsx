import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Check,
  ClipboardCheck,
  Clock3,
  Database,
  Eye,
  LockKeyhole,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { PipelineStage } from "../types";
import { ResearchQueryState } from "./ResearchQueryState";
import {
  adaptivePostureLabel,
  adaptiveRegimeLabel,
  formatAdaptiveCapitalPacing,
} from "../lib/adaptiveStrategyPresentation";
import {
  fetchLearningState,
  fetchSelfOptimizationStatus,
  type WeeklyPaperReviewWindow,
} from "../lib/tradingApi";
import {
  dailyCandidatesQueryOptions,
  dailyMarketReviewQueryOptions,
  paperTradingPlanQueryOptions,
  strategyLeaderboardQueryOptions,
  weeklyPaperReviewQueryOptions,
} from "../lib/researchQueries";

const stageIcons = {
  done: Check,
  running: Sparkles,
  pending: Clock3,
  review: Eye,
};

const adaptiveStrategyLabels: Record<string, string> = {
  kairosLowVolTrend: "低波趋势",
  kairosTrendHealth: "趋势健康",
  momentum: "动量确认",
  movingAverageCross: "均线交叉",
  macd: "MACD确认",
  turtle: "海龟突破",
  kairosQuietPullback: "安静回踩",
  kairosWashoutRecovery: "洗盘恢复",
  aSharePullback: "强势回踩",
  rsi: "RSI回归",
  bollingerBands: "布林下沿",
  kairosRiskOffRecovery: "风险修复",
  kairosCapitalShield: "资金盾牌",
  kairosRangeRotation: "区间轮动",
  kairosQualifiedProbe: "合格样本验证",
  kairosValidationBasket: "验证篮子",
};

const weeklySizingConstraintLabels: Record<string, string> = {
  "configured-cap": "配置单笔上限",
  "cash-or-reserve": "现金/现金缓冲",
  "phase-budget": "阶段订单额度",
  "lot-size": "一手/金额不足",
  "strategy-or-signal": "策略/信号门槛",
  "sample-or-signal": "成交样本/信号约束",
  "not-observed": "暂无成交样本",
};

const weeklyHistoryCoverageLabels: Record<string, string> = {
  "within-retention": "在留存窗口内",
  "may-be-pruned": "可能已被清理",
  unknown: "留存状态未知",
};

function adaptiveStrategyLabel(key: string): string {
  return adaptiveStrategyLabels[key] ?? key;
}

export default function LearningPipeline() {
  const [weeklyPeriod, setWeeklyPeriod] = useState<WeeklyPaperReviewWindow>("previous");
  const weeklyPeriodLabel = weeklyPeriod === "previous" ? "上周" : "本周";
  const leaderboardQuery = useQuery(strategyLeaderboardQueryOptions(120));
  const candidatesQuery = useQuery(dailyCandidatesQueryOptions(24));
  const learningStateQuery = useQuery({
    queryKey: ["learning-state"],
    queryFn: ({ signal }) => fetchLearningState(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const researchFoundationReady =
    leaderboardQuery.isFetched && candidatesQuery.isFetched;
  const paperPlanQuery = useQuery({
    ...paperTradingPlanQueryOptions(),
    enabled: researchFoundationReady,
  });
  const dailyReviewQuery = useQuery({
    ...dailyMarketReviewQueryOptions(),
    enabled: researchFoundationReady,
  });
  const weeklyPaperReviewQuery = useQuery(weeklyPaperReviewQueryOptions(weeklyPeriod));
  const selfOptimizationQuery = useQuery({
    queryKey: ["self-optimization-status"],
    queryFn: ({ signal }) => fetchSelfOptimizationStatus(signal),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const topStrategy = leaderboardQuery.data?.entries[0];
  const learningState = learningStateQuery.data;
  const paperPlan = paperPlanQuery.data;
  const paperPlanQuality = paperPlan?.qualitySummary;
  const dailyReview = dailyReviewQuery.data;
  const weeklyPaperReview = weeklyPaperReviewQuery.data;
  const weeklyHistoryCoverage = weeklyPaperReview?.sample.historyCoverage;
  const weeklyPlanSnapshotDays = weeklyPaperReview?.sample.planSnapshotDays ?? 0;
  const weeklyPlannedBuyNotional = weeklyPaperReview?.capital.plannedBuyNotional ?? 0;
  const weeklyPlannedSellNotional = weeklyPaperReview?.capital.plannedSellNotional ?? 0;
  const weeklyPlannedBuyCapitalRatio = weeklyPaperReview?.capital.plannedBuyCapitalRatio ?? 0;
  const weeklyAutomaticFilledBuyNotional = weeklyPaperReview?.capital.automaticFilledBuyNotional ?? 0;
  const weeklyPlanRealizationRatio = weeklyPaperReview?.capital.planRealizationRatio ?? null;
  const weeklyMaxDailyPlannedBuyNotional = weeklyPaperReview?.capital.maxDailyPlannedBuyNotional ?? 0;
  const weeklyDailyReconciliation = weeklyPaperReview?.daily.filter((day) =>
    day.submitted > 0 ||
    (day.plannedBuyNotional ?? 0) > 0 ||
    (day.plannedSellNotional ?? 0) > 0,
  ) ?? [];
  const selfOptimization = selfOptimizationQuery.data;
  const paperBuyCount =
    candidatesQuery.data?.candidates.filter((candidate) => candidate.action === "paper-buy").length ?? 0;
  const researchScore = leaderboardQuery.data && candidatesQuery.data ? Math.min(
    100,
    Math.round(
      leaderboardQuery.data.dataQuality.score.overall * 0.45 +
        (topStrategy?.qualityGate === "pass" ? 30 : topStrategy?.qualityGate === "caution" ? 18 : 8) +
        Math.min(paperBuyCount * 5, 20),
    ),
  ) : null;
  const pipelineStages: PipelineStage[] = [
    {
      name: "候选扫描",
      description: "当前观察池与合格 Paper 买入候选。",
      status: candidatesQuery.data ? "done" : candidatesQuery.isFetching ? "running" : "pending",
      detail: candidatesQuery.data
        ? `${candidatesQuery.data.candidates.length} 个候选 / ${paperBuyCount} 个买入观察`
        : candidatesQuery.isError ? "扫描暂不可用" : "等待扫描结果",
    },
    {
      name: "合成样本初筛",
      description: "合成序列评分，不代表真实历史或样本外验证。",
      status: leaderboardQuery.data ? "done" : leaderboardQuery.isFetching ? "running" : "pending",
      detail: leaderboardQuery.data
        ? `门槛通过 ${leaderboardQuery.data.entries.filter((entry) => entry.qualityGate === "pass").length} / ${leaderboardQuery.data.entries.length}`
        : leaderboardQuery.isError ? "榜单暂不可用" : "等待策略榜单",
    },
    {
      name: "Paper 成交观察",
      description: "已成交订单与扣费后闭合样本。",
      status: weeklyPaperReview?.sample.filledOrderCount ? "running" : "pending",
      detail: weeklyPaperReview
        ? `${weeklyPeriodLabel}成交 ${weeklyPaperReview.sample.filledOrderCount} 笔 / 闭合 ${weeklyPaperReview.performance.closedTrades} 笔`
        : weeklyPaperReviewQuery.isError ? "复盘暂不可用" : "等待成交复盘",
    },
    {
      name: "风险人工审批",
      description: "真实交易关闭，研究结果不构成执行授权。",
      status: "review",
      detail: "未接入真实交易",
    },
  ];

  return (
    <div className="learning-layout">
      <div className="learning-main-column">
        <section className="panel pipeline-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">受控研究流程</span>
              <h2>候选策略验证</h2>
            </div>
            <span className="sample-badge">
              {candidatesQuery.data?.candidates.length ?? 0} 个候选
            </span>
          </div>

          <div className="pipeline-list">
            {pipelineStages.map((stage, index) => {
              const Icon = stageIcons[stage.status];
              return (
                <article className={`pipeline-stage ${stage.status}`} key={stage.name}>
                  <div className="stage-marker">
                    <Icon size={17} />
                  </div>
                  <div className="stage-copy">
                    <div>
                      <span>阶段 {index + 1}</span>
                      <strong>{stage.name}</strong>
                    </div>
                    <p>{stage.description}</p>
                  </div>
                  <span className="stage-detail">{stage.detail}</span>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel learning-memory-panel weekly-paper-review">
          <div className="panel-header">
            <div>
              <span className="section-kicker">{weeklyPeriodLabel} Paper 复盘</span>
              <h2>资金使用与闭合成交</h2>
            </div>
            <div className="weekly-review-controls">
              <div className="regime-tabs weekly-period-switch" role="group" aria-label="复盘周期">
                {(["previous", "current"] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    aria-label={`${period === "previous" ? "上周" : "本周"} Paper 复盘`}
                    aria-pressed={weeklyPeriod === period}
                    className={weeklyPeriod === period ? "active" : ""}
                    onClick={() => setWeeklyPeriod(period)}
                  >
                    {period === "previous" ? "上周" : "本周"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`刷新${weeklyPeriodLabel} Paper 复盘`}
                title={`刷新${weeklyPeriodLabel} Paper 复盘`}
                disabled={weeklyPaperReviewQuery.isFetching}
                onClick={() => void weeklyPaperReviewQuery.refetch()}
              >
                <RefreshCw size={16} className={weeklyPaperReviewQuery.isFetching ? "spin" : undefined} />
              </button>
            </div>
          </div>
          <div className="weekly-review-period" aria-live="polite">
            {weeklyPaperReview
              ? `${weeklyPaperReview.period.startDate} - ${weeklyPaperReview.period.endDate}`
              : `${weeklyPeriodLabel} · 等待复盘`}
          </div>
          <ResearchQueryState
            dataUpdatedAt={weeklyPaperReviewQuery.dataUpdatedAt}
            hasData={Boolean(weeklyPaperReview)}
            isError={weeklyPaperReviewQuery.isError}
            isLoading={weeklyPaperReviewQuery.isLoading}
            loadingText={`正在汇总${weeklyPeriodLabel} Paper 记录…`}
            unavailableText={`${weeklyPeriodLabel} Paper 复盘暂不可用，当前其它研究结果仍可使用。`}
          />
          {weeklyPaperReview && (
            <>
              <div className="learning-memory-grid">
                <article>
                  <span>买入成交额</span>
                  <strong>¥{weeklyPaperReview.capital.grossBuyNotional.toLocaleString("zh-CN")}</strong>
                  <small>占初始资金 {(weeklyPaperReview.capital.buyCapitalRatio * 100).toFixed(1)}%</small>
                </article>
                <article>
                  <span>计划买入额</span>
                  <strong>¥{weeklyPlannedBuyNotional.toLocaleString("zh-CN")}</strong>
                  <small>
                    计划快照 {weeklyPlanSnapshotDays} 天 · 占初始资金 {(weeklyPlannedBuyCapitalRatio * 100).toFixed(1)}%
                  </small>
                </article>
                <article>
                  <span>自动成交买入</span>
                  <strong>¥{weeklyAutomaticFilledBuyNotional.toLocaleString("zh-CN")}</strong>
                  <small>
                    日峰值计划 ¥{weeklyMaxDailyPlannedBuyNotional.toLocaleString("zh-CN")}
                  </small>
                </article>
                <article>
                  <span>计划落地率</span>
                  <strong>
                    {weeklyPlanRealizationRatio === null
                      ? "暂无"
                      : `${(weeklyPlanRealizationRatio * 100).toFixed(1)}%`}
                  </strong>
                  <small>
                    计划卖出 ¥{weeklyPlannedSellNotional.toLocaleString("zh-CN")}
                  </small>
                </article>
                <article>
                  <span>初始资金</span>
                  <strong>¥{weeklyPaperReview.capital.initialCapital.toLocaleString("zh-CN")}</strong>
                  <small>当前权益 ¥{weeklyPaperReview.capital.currentEquity.toLocaleString("zh-CN")}</small>
                </article>
                <article>
                  <span>平均单笔</span>
                  <strong>¥{weeklyPaperReview.capital.averageFilledOrderNotional.toLocaleString("zh-CN")}</strong>
                  <small>成交 {weeklyPaperReview.sample.filledOrderCount} 笔</small>
                </article>
                <article>
                  <span>有效单笔上限</span>
                  <strong>¥{weeklyPaperReview.capital.maxSingleOrderNotional.toLocaleString("zh-CN")}</strong>
                  <small>占初始资金 {(weeklyPaperReview.capital.maxOrderCapitalRatio * 100).toFixed(1)}%</small>
                </article>
                <article>
                  <span>闭合胜率</span>
                  <strong>
                    {weeklyPaperReview.performance.winRate === null
                      ? "样本不足"
                      : `${(weeklyPaperReview.performance.winRate * 100).toFixed(1)}%`}
                  </strong>
                  <small>
                    闭合 {weeklyPaperReview.performance.closedTrades} 笔 · 仅已成交 FIFO
                  </small>
                </article>
              </div>
              <div className="learning-plan-summary">
                <strong>{weeklyPaperReview.diagnosis.summary}</strong>
                <p>{weeklyPaperReview.capital.summary}</p>
                <span>
                  资金约束 {weeklySizingConstraintLabels[weeklyPaperReview.capital.sizingConstraint] ?? weeklyPaperReview.capital.sizingConstraint} ·
                  上限占比 {(weeklyPaperReview.capital.maxOrderCapitalRatio * 100).toFixed(1)}% ·
                  当前仓位 {(weeklyPaperReview.capital.currentDeployedRatio * 100).toFixed(1)}% ·
                  当前现金 {(weeklyPaperReview.capital.currentCashRatio * 100).toFixed(1)}% ·
                  已闭合盈亏 {weeklyPaperReview.performance.realizedPnl >= 0 ? "+" : ""}
                  ¥{weeklyPaperReview.performance.realizedPnl.toFixed(2)} ·
                  手续费 ¥{weeklyPaperReview.performance.commission.toFixed(2)} ·
                  计划落地率 {weeklyPlanRealizationRatio === null
                    ? "暂无"
                    : `${(weeklyPlanRealizationRatio * 100).toFixed(1)}%`}
                </span>
                {weeklyHistoryCoverage && (
                  <span>
                    历史证据 {weeklyHistoryCoverageLabels[weeklyHistoryCoverage.status] ?? weeklyHistoryCoverage.status} ·
                    {weeklyHistoryCoverage.summary}
                  </span>
                )}
              </div>
              <div className="weekly-daily-reconciliation">
                <strong>每日金额对账</strong>
                <div className="weekly-daily-list">
                  {weeklyDailyReconciliation.map((day) => {
                    const dayPlanRealizationRatio = day.planRealizationRatio ?? null;
                    return (
                      <article key={day.date}>
                        <span>{day.date}</span>
                        <strong>
                          计划买入 ¥{(day.plannedBuyNotional ?? 0).toLocaleString("zh-CN")}
                        </strong>
                        <small>
                          自动成交 ¥{(day.automaticFilledBuyNotional ?? 0).toLocaleString("zh-CN")} ·
                          落地 {dayPlanRealizationRatio === null
                            ? "暂无"
                            : `${(dayPlanRealizationRatio * 100).toFixed(1)}%`} ·
                          提交 {day.submitted} / 成交 {day.filled} / 拒绝 {day.rejected}
                        </small>
                      </article>
                    );
                  })}
                  {!weeklyDailyReconciliation.length && (
                    <p className="empty-copy">该周期没有计划或订单金额对账记录。</p>
                  )}
                </div>
              </div>
              <div className="weekly-review-columns">
                <div>
                  <strong>主要发现</strong>
                  <ul>
                    {weeklyPaperReview.diagnosis.findings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>下一轮改进</strong>
                  <ul>
                    {weeklyPaperReview.diagnosis.nextActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="weekly-review-details">
                <div>
                  <strong>策略成交分布</strong>
                  <div className="learning-run-list">
                    {weeklyPaperReview.strategyBreakdown.slice(0, 5).map((strategy) => (
                      <article key={strategy.strategyKey}>
                        <BarChart3 size={15} />
                        <div>
                          <strong>{strategy.strategyName}</strong>
                          <span>
                            成交 {strategy.filledOrders} 笔 · 金额 ¥{strategy.filledNotional.toLocaleString("zh-CN")} ·
                            闭合 {strategy.closedTrades} 笔 · 胜率 {strategy.winRate === null
                              ? "样本不足"
                              : `${(strategy.winRate * 100).toFixed(1)}%`} ·
                            盈亏 {strategy.realizedPnl >= 0 ? "+" : ""}
                            ¥{strategy.realizedPnl.toFixed(2)}
                          </span>
                        </div>
                      </article>
                    ))}
                    {!weeklyPaperReview.strategyBreakdown.length && (
                      <p className="empty-copy">该周期没有可拆分的策略成交记录。</p>
                    )}
                  </div>
                </div>
                <div>
                  <strong>主要阻塞原因</strong>
                  <div className="weekly-blocker-list">
                    {weeklyPaperReview.blockers.slice(0, 4).map((blocker) => (
                      <article key={blocker.code}>
                        <span>{blocker.label}</span>
                        <strong>{blocker.count} 次</strong>
                        <small>
                          记录估算金额 ¥{(blocker.estimatedNotional ?? 0).toLocaleString("zh-CN")} · {blocker.examples[0]}
                        </small>
                      </article>
                    ))}
                    {!weeklyPaperReview.blockers.length && (
                      <p className="empty-copy">该周期没有记录到阻塞原因。</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel learning-memory-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">研究记忆</span>
              <h2>样本积累状态</h2>
            </div>
            <Database size={19} />
          </div>
          <ResearchQueryState
            hasData={Boolean(learningState)}
            isLoading={learningStateQuery.isLoading}
            isError={learningStateQuery.isError}
            dataUpdatedAt={learningStateQuery.dataUpdatedAt}
            loadingText="正在加载研究记忆…"
            unavailableText="研究记忆暂不可用，请稍后重试。"
          />
          <div className="learning-memory-grid">
            <article>
              <span>行情样本</span>
              <strong>{learningState?.dataMemory.marketSnapshotSamples ?? 0}</strong>
              <small>{learningState?.dataMemory.storage ?? "in-memory"}</small>
            </article>
            <article>
              <span>研究运行</span>
              <strong>{learningState?.dataMemory.researchRuns ?? 0}</strong>
              <small>榜单/候选/优质股</small>
            </article>
            <article>
              <span>覆盖标的</span>
              <strong>{learningState?.dataMemory.symbolsSeen ?? 0}</strong>
              <small>{learningState?.dataMemory.providersSeen.join(" / ") || "等待采样"}</small>
            </article>
          </div>
          <div className="learning-run-list">
            {(learningState?.researchLoop.latestRuns ?? []).map((run) => (
              <article key={`${run.kind}-${run.recordedAt}`}>
                <BarChart3 size={15} />
                <div>
                  <strong>{run.summary}</strong>
                  <span>
                    {run.kind} · {run.itemCount} 项 · 快照 {run.snapshotSequence}
                  </span>
                </div>
              </article>
            ))}
            {!learningState?.researchLoop.latestRuns.length && (
              <p className="empty-copy">调用研究接口后，这里会开始显示累计样本。</p>
            )}
          </div>
        </section>

        <section className="panel learning-memory-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">
                {dailyReview?.dateBasis !== "current-weekday"
                  ? "最近交易日复盘"
                  : "每日复盘"}
              </span>
              <h2>盘面与 Paper 交易</h2>
            </div>
            <span className="sample-badge">
              {dailyReview?.tradingDate ?? "等待收盘"}
            </span>
          </div>
          <ResearchQueryState
            dataUpdatedAt={dailyReviewQuery.dataUpdatedAt}
            hasData={Boolean(dailyReview)}
            isError={dailyReviewQuery.isError}
            isLoading={dailyReviewQuery.isLoading}
            loadingText="正在生成盘面复盘…"
            unavailableText="盘面复盘暂不可用，当前其它研究结果仍可使用。"
          />
          <div className="learning-memory-grid">
            <article>
              <span>盘面状态</span>
              <strong>
                {dailyReview?.market.tone === "risk-on"
                  ? "偏强"
                  : dailyReview?.market.tone === "risk-off"
                    ? "偏弱"
                    : dailyReview?.market.tone === "balanced"
                      ? "分化"
                      : "待确认"}
              </strong>
              <small>
                涨 {dailyReview?.market.breadth.advancers ?? 0} / 跌 {dailyReview?.market.breadth.decliners ?? 0}
              </small>
            </article>
            <article>
              <span>账户权益</span>
              <strong>¥{(dailyReview?.account.equity ?? 0).toLocaleString("zh-CN")}</strong>
              <small>
                复盘日 paper {dailyReview?.account.dailyPnlPercent != null
                  ? `${dailyReview.account.dailyPnlPercent >= 0 ? "+" : ""}${(dailyReview.account.dailyPnlPercent * 100).toFixed(2)}%`
                  : "--"}
              </small>
            </article>
            <article>
              <span>资金使用</span>
              <strong>{((dailyReview?.account.capitalDeployedPercent ?? 0) * 100).toFixed(1)}%</strong>
              <small>
                成交 {dailyReview?.trades.filled ?? 0} / 拒绝 {dailyReview?.trades.rejected ?? 0}
              </small>
            </article>
          </div>
          {dailyReview && (
            <div className="learning-plan-summary">
              <strong>{dailyReview.strategyReview.summary}</strong>
              <p>{dailyReview.market.summary}</p>
              <span>
                累计 paper {dailyReview.account.cumulativePnl >= 0 ? "+" : ""}¥{dailyReview.account.cumulativePnl.toFixed(2)} · 手续费 ¥{dailyReview.trades.commission.toFixed(2)} · 现金比例 {(dailyReview.account.cashRatio * 100).toFixed(1)}% · T+1 锁定 {dailyReview.account.t1LockedPositions} 只
              </span>
            </div>
          )}
          {dailyReview && (
            <div className={`daily-entry-review ${dailyReview.entryReview.status}`}>
              <span>为什么没有入场 / 为什么入场</span>
              <strong>{dailyReview.entryReview.summary}</strong>
              <ul>
                {dailyReview.entryReview.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="learning-run-list">
            {(dailyReview?.trades.items ?? []).map((trade) => (
              <article key={trade.orderId}>
                <ClipboardCheck size={15} />
                <div>
                  <strong>
                    {trade.symbol} {trade.name} · {trade.side === "buy" ? "买入" : "卖出"} · {trade.status}
                  </strong>
                  <span>
                    {trade.strategy} · {trade.quantity} 股 · ¥{trade.notional.toLocaleString("zh-CN")}
                  </span>
                  <span>{trade.reason}</span>
                </div>
              </article>
            ))}
            {!dailyReview?.trades.items.length && (
              <p className="empty-copy">
                {dailyReview?.tradingDate ?? "该复盘日"} 暂无本地 paper 订单。
              </p>
            )}
          </div>
          {dailyReview && (
            <div className="daily-review-findings">
              <div>
                <strong>发现问题</strong>
                <ul>
                  {dailyReview.strategyReview.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                  {!dailyReview.strategyReview.issues.length && <li>未发现明显执行纪律问题。</li>}
                </ul>
              </div>
              <div>
                <strong>下一步改进</strong>
                <ul>
                  {dailyReview.strategyReview.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <section className="panel learning-memory-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">纸面操作过程</span>
              <h2>今日 Paper 资金计划</h2>
            </div>
            <span className="sample-badge">
              {paperPlan?.operations.length ?? 0} 条记录
            </span>
          </div>
          <ResearchQueryState
            dataUpdatedAt={paperPlanQuery.dataUpdatedAt}
            hasData={Boolean(paperPlan)}
            isError={paperPlanQuery.isError}
            isLoading={paperPlanQuery.isLoading}
            loadingText="正在生成今日纸面计划…"
            unavailableText="纸面计划暂不可用，未生成任何模拟订单。"
          />
          <div className="learning-memory-grid">
            <article>
              <span>交易日</span>
              <strong>{paperPlan?.tradingDate ?? "等待"}</strong>
              <small>{paperPlan?.provider ?? "provider"}</small>
            </article>
            <article>
              <span>初始资金</span>
              <strong>¥{(paperPlan?.capitalPlan.initialCapital ?? 0).toLocaleString("zh-CN")}</strong>
              <small>当前权益 ¥{(paperPlan?.account.equity ?? 0).toLocaleString("zh-CN")}</small>
            </article>
            <article>
              <span>可用现金</span>
              <strong>¥{(paperPlan?.account.cash ?? 0).toLocaleString("zh-CN")}</strong>
              <small>paper-only</small>
            </article>
            <article>
              <span>单票上限</span>
              <strong>{((paperPlan?.capitalPlan.maxPositionWeight ?? 0) * 100).toFixed(1)}%</strong>
              <small>一手 {paperPlan?.capitalPlan.lotSize ?? 100} 股</small>
            </article>
          </div>
          {paperPlan?.strategyProfile && (
            <div className="learning-plan-summary">
              <strong>{paperPlan.strategyProfile.label}档位</strong>
              <p>{paperPlan.strategyProfile.summary}</p>
              <span>
                实际现金底线 {(paperPlan.strategyProfile.effectiveCashReserveRatio * 100).toFixed(0)}%
                {" · "}候选最低分 {paperPlan.strategyProfile.minDefensiveScore}
                {" · "}每轮最多新增 {paperPlan.strategyProfile.maxNewPositionsPerPlan} 只
                {" · "}{paperPlan.strategyProfile.allowNewPositions ? "允许继续筛选" : "当前停止新增仓位"}
              </span>
            </div>
          )}
          {paperPlan?.adaptiveRouting && (
            <div className="adaptive-routing-summary">
              <div className="adaptive-routing-stats">
                <span>
                  市场状态
                  <strong>{adaptiveRegimeLabel(paperPlan.adaptiveRouting.regime)}</strong>
                </span>
                <span>
                  路由置信度
                  <strong>{(paperPlan.adaptiveRouting.confidence * 100).toFixed(0)}%</strong>
                </span>
                <span>
                  仓位姿态
                  <strong>{adaptivePostureLabel(paperPlan.adaptiveRouting.positionPosture)}</strong>
                </span>
                <span>
                  现金储备
                  <strong>{(paperPlan.adaptiveRouting.cashReserveRatio * 100).toFixed(0)}%</strong>
                </span>
              </div>
              <p>{paperPlan.adaptiveRouting.evidence[0] ?? "等待真实历史状态确认。"}</p>
              <dl className="adaptive-routing-playbook">
                <div>
                  <dt>适用条件</dt>
                  <dd>{paperPlan.adaptiveRouting.strategyPlaybook.useWhen}</dd>
                </div>
                <div>
                  <dt>回避条件</dt>
                  <dd>{paperPlan.adaptiveRouting.strategyPlaybook.avoidWhen}</dd>
                </div>
                <div>
                  <dt>分时仓位上限</dt>
                  <dd>{formatAdaptiveCapitalPacing(paperPlan.adaptiveRouting.capitalPacing)}</dd>
                </div>
              </dl>
              <small>
                当前策略 {paperPlan.topStrategy?.strategyName ?? "资金盾牌"} · 允许策略{" "}
                {paperPlan.adaptiveRouting.eligibleStrategyKeys.length} 个 ·
                {paperPlan.adaptiveRouting.allowNewPositions ? " 可新增 paper 仓位" : " 停止新增仓位"}
              </small>
            </div>
          )}
          {paperPlanQuality && (
            <div className="learning-plan-summary">
              <strong>纸面计划诊断</strong>
              <p>{paperPlanQuality.summary}</p>
              <span>
                可买 {paperPlanQuality.affordableCandidateCount} / 候选 {paperPlanQuality.candidatePoolSize}
                ，拟投入 {(paperPlanQuality.cashDeploymentPercent * 100).toFixed(1)}%，拦截{" "}
                {paperPlanQuality.actionCounts.blocked}，持有 {paperPlanQuality.actionCounts.hold}
              </span>
              <span>
                策略命中 {paperPlanQuality.strategyCoverage.matchedCandidateCount} 个候选 · 覆盖{" "}
                {paperPlanQuality.strategyCoverage.matchedKeys.length > 0
                  ? paperPlanQuality.strategyCoverage.matchedKeys
                      .map(adaptiveStrategyLabel)
                      .join(" / ")
                  : "暂无"}
                {" · "}未匹配 {paperPlanQuality.strategyCoverage.unmatchedCandidateCount} 个
              </span>
              <span>
                主要拦截：{paperPlanQuality.strategyCoverage.dominantBlocker ?? "无"}
              </span>
              <span>
                当前允许 {paperPlanQuality.strategyCoverage.eligibleKeys.length} 个策略 ·
                已命中 {paperPlanQuality.strategyCoverage.matchedKeys.length} 个 ·
                主策略 {adaptiveStrategyLabel(paperPlanQuality.strategyCoverage.dominantStrategyKey ?? "暂无")}
              </span>
              <small>合格机会覆盖，不强制换手，不代表预期盈利。</small>
            </div>
          )}
          <div className="learning-run-list">
            {(paperPlan?.operations ?? []).slice(0, 8).map((operation) => (
              <article key={`${operation.timestamp}-${operation.symbol}-${operation.action}`}>
                <BarChart3 size={15} />
                <div>
                  <strong>
                    {operation.symbol} {operation.name} · {operation.action}
                  </strong>
                  <span>
                    {operation.strategy} · {operation.quantity} 股 · ¥{operation.estimatedNotional.toLocaleString("zh-CN")}
                  </span>
                  <span>{operation.reason}</span>
                </div>
              </article>
            ))}
            {!paperPlan?.operations.length && (
              <p className="empty-copy">等待后端生成今日纸面计划。</p>
            )}
          </div>
        </section>

        <section className="panel learning-memory-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">自动优化</span>
              <h2>策略训练与本地存储控制</h2>
            </div>
            <Database size={19} />
          </div>
          <div className="learning-memory-grid">
            <article>
              <span>缓存上限</span>
              <strong>{selfOptimization?.retention.maxCacheMb ?? 512} MB</strong>
              <small>{selfOptimization?.retention.dataDir ?? "./data/research"}</small>
            </article>
            <article>
              <span>历史窗口</span>
              <strong>{selfOptimization?.retention.historyDays ?? 756} 天</strong>
              <small>只保留紧凑日线/特征</small>
            </article>
            <article>
              <span>股票池上限</span>
              <strong>{selfOptimization?.retention.maxSymbols ?? 200}</strong>
              <small>默认不存原始新闻正文</small>
            </article>
          </div>
          <div className="learning-run-list">
            {(selfOptimization?.optimizer.objective ?? []).map((objective) => (
              <article key={objective}>
                <Sparkles size={15} />
                <div>
                  <strong>{objective}</strong>
                  <span>paper-only 自优化目标</span>
                </div>
              </article>
            ))}
            {!selfOptimization && (
              <p className="empty-copy">等待后端返回自优化与留存策略状态。</p>
            )}
          </div>
        </section>
      </div>

      <aside className="panel governance-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">治理边界</span>
            <h2>研究管线状态</h2>
          </div>
          <button
            aria-label="刷新研究管线"
            className="icon-button"
            disabled={
              leaderboardQuery.isFetching ||
              candidatesQuery.isFetching ||
              learningStateQuery.isFetching ||
              paperPlanQuery.isFetching ||
              dailyReviewQuery.isFetching ||
              weeklyPaperReviewQuery.isFetching ||
              selfOptimizationQuery.isFetching
            }
            onClick={() => {
              void leaderboardQuery.refetch();
              void candidatesQuery.refetch();
              void learningStateQuery.refetch();
              void paperPlanQuery.refetch();
              void dailyReviewQuery.refetch();
              void weeklyPaperReviewQuery.refetch();
              void selfOptimizationQuery.refetch();
            }}
            type="button"
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="governance-score">
          <div className="score-ring">
            <strong>{researchScore ?? "--"}</strong>
            <span>/ 100</span>
          </div>
          <div>
            <strong>{topStrategy?.strategyName ?? "等待策略排行榜"}</strong>
            <p>
              {topStrategy
                ? `合成样本胜率 ${(topStrategy.metrics.winRate * 100).toFixed(1)}% · ${topStrategy.metrics.totalTrades} 次模拟交易`
                : "后端启动后自动拉取策略排行榜。"}
            </p>
          </div>
        </div>
        <ul className="check-list">
          <li className={leaderboardQuery.data ? "done" : ""}>
            {leaderboardQuery.data ? <Check size={15} /> : <Clock3 size={15} />}
            {leaderboardQuery.data ? "策略初筛榜单已更新" : "等待策略初筛榜单"}
          </li>
          <li className={candidatesQuery.data ? "done" : ""}>
            {candidatesQuery.data ? <Check size={15} /> : <Clock3 size={15} />}
            {candidatesQuery.data ? "今日候选扫描已更新" : "等待今日候选扫描"}
          </li>
          <li className={learningState ? "done" : ""}>
            {learningState ? <Check size={15} /> : <Clock3 size={15} />}
            {learningState ? `研究运行样本 ${learningState.dataMemory.researchRuns} 次` : "等待研究样本统计"}
          </li>
          <li className={paperPlan ? "done" : ""}>
            {paperPlan ? <Check size={15} /> : <Clock3 size={15} />}
            {paperPlan ? "A 股 T+1 纸面计划已生成" : "等待 A 股 T+1 纸面计划"}
          </li>
          <li className={dailyReview ? "done" : ""}>
            {dailyReview ? <Check size={15} /> : <Clock3 size={15} />}
            {dailyReview ? "每日盘面与交易复盘已生成" : "等待每日盘面与交易复盘"}
          </li>
          <li className={weeklyPaperReview ? "done" : ""}>
            {weeklyPaperReview ? <Check size={15} /> : <Clock3 size={15} />}
            {weeklyPaperReview
              ? `${weeklyPeriodLabel}资金使用与闭合成交复盘已生成`
              : `等待${weeklyPeriodLabel}资金使用与闭合成交复盘`}
          </li>
          <li className="done">
            <Check size={15} />
            订单执行仍保持 paper-only 隔离
          </li>
          <li>
            <Clock3 size={15} />
            历史行情缓存受上限控制后再接入
          </li>
          <li className={selfOptimization ? "done" : ""}>
            {selfOptimization ? <Check size={15} /> : <Clock3 size={15} />}
            {selfOptimization ? "自优化与存储控制状态已获取" : "等待自优化与存储控制状态"}
          </li>
          <li>
            <LockKeyhole size={15} />
            真实下单必须保留人工审批
          </li>
        </ul>
        <div className="learning-next-data">
          <strong>下一批数据</strong>
          <p>{learningState?.nextDataNeeds[0] ?? "等待学习状态接口返回。"}</p>
          <p>
            缓存策略：最多 {selfOptimization?.retention.maxSymbols ?? 200} 只、
            {selfOptimization?.retention.historyDays ?? 756} 天、
            {selfOptimization?.retention.maxCacheMb ?? 512} MB。
          </p>
        </div>
        <button className="primary-button full-width" type="button">
          查看人工复核清单
        </button>
      </aside>
    </div>
  );
}
