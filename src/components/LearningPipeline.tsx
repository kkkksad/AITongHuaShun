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
import { pipelineStages } from "../data/mockData";
import {
  adaptivePostureLabel,
  adaptiveRegimeLabel,
} from "../lib/adaptiveStrategyPresentation";
import {
  fetchDailyCandidates,
  fetchDailyMarketReview,
  fetchLearningState,
  fetchPaperTradingPlan,
  fetchSelfOptimizationStatus,
  fetchStrategyLeaderboard,
} from "../lib/tradingApi";

const stageIcons = {
  done: Check,
  running: Sparkles,
  pending: Clock3,
  review: Eye,
};

export default function LearningPipeline() {
  const leaderboardQuery = useQuery({
    queryKey: ["strategy-leaderboard", "pipeline", 120],
    queryFn: () => fetchStrategyLeaderboard(120),
    staleTime: 60_000,
  });
  const candidatesQuery = useQuery({
    queryKey: ["daily-candidates", "pipeline", 24],
    queryFn: () => fetchDailyCandidates(24),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const learningStateQuery = useQuery({
    queryKey: ["learning-state"],
    queryFn: fetchLearningState,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const paperPlanQuery = useQuery({
    queryKey: ["paper-trading-plan"],
    queryFn: fetchPaperTradingPlan,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const dailyReviewQuery = useQuery({
    queryKey: ["daily-market-review"],
    queryFn: fetchDailyMarketReview,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const selfOptimizationQuery = useQuery({
    queryKey: ["self-optimization-status"],
    queryFn: fetchSelfOptimizationStatus,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const topStrategy = leaderboardQuery.data?.entries[0];
  const learningState = learningStateQuery.data;
  const paperPlan = paperPlanQuery.data;
  const paperPlanQuality = paperPlan?.qualitySummary;
  const dailyReview = dailyReviewQuery.data;
  const selfOptimization = selfOptimizationQuery.data;
  const paperBuyCount =
    candidatesQuery.data?.candidates.filter((candidate) => candidate.action === "paper-buy").length ?? 0;
  const researchScore = Math.min(
    100,
    Math.round(
      (leaderboardQuery.data?.dataQuality.score.overall ?? 65) * 0.45 +
        (topStrategy?.qualityGate === "pass" ? 30 : topStrategy?.qualityGate === "caution" ? 18 : 8) +
        Math.min(paperBuyCount * 5, 20),
    ),
  );

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
              {candidatesQuery.data?.candidates.length ?? 0} 个实时候选
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

        <section className="panel learning-memory-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">研究记忆</span>
              <h2>样本积累状态</h2>
            </div>
            <Database size={19} />
          </div>
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
              <span className="section-kicker">每日复盘</span>
              <h2>盘面与 Paper 交易</h2>
            </div>
            <span className="sample-badge">
              {dailyReview?.tradingDate ?? "等待收盘"}
            </span>
          </div>
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
                当日 paper {dailyReview?.account.dailyPnlPercent !== undefined
                  ? `${(dailyReview.account.dailyPnlPercent * 100).toFixed(2)}%`
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
                手续费 ¥{dailyReview.trades.commission.toFixed(2)} · 现金比例 {(dailyReview.account.cashRatio * 100).toFixed(1)}% · T+1 锁定 {dailyReview.account.t1LockedPositions} 只
              </span>
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
              <p className="empty-copy">今日尚无本地 paper 订单。</p>
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
              <h2>今日 1 万资金计划</h2>
            </div>
            <span className="sample-badge">
              {paperPlan?.operations.length ?? 0} 条记录
            </span>
          </div>
          <div className="learning-memory-grid">
            <article>
              <span>交易日</span>
              <strong>{paperPlan?.tradingDate ?? "等待"}</strong>
              <small>{paperPlan?.provider ?? "provider"}</small>
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
              selfOptimizationQuery.isFetching
            }
            onClick={() => {
              void leaderboardQuery.refetch();
              void candidatesQuery.refetch();
              void learningStateQuery.refetch();
              void paperPlanQuery.refetch();
              void dailyReviewQuery.refetch();
              void selfOptimizationQuery.refetch();
            }}
            type="button"
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="governance-score">
          <div className="score-ring">
            <strong>{researchScore}</strong>
            <span>/ 100</span>
          </div>
          <div>
            <strong>{topStrategy?.strategyName ?? "等待策略排行榜"}</strong>
            <p>
              {topStrategy
                ? `胜率 ${(topStrategy.metrics.winRate * 100).toFixed(1)}% · ${topStrategy.metrics.totalTrades} 次模拟交易`
                : "后端启动后自动拉取策略排行榜。"}
            </p>
          </div>
        </div>
        <ul className="check-list">
          <li className={leaderboardQuery.data ? "done" : ""}>
            <Check size={15} />
            策略排行榜自动刷新已接入
          </li>
          <li className={candidatesQuery.data ? "done" : ""}>
            <Check size={15} />
            今日候选扫描每 60 秒更新
          </li>
          <li className={learningState ? "done" : ""}>
            <Check size={15} />
            研究运行样本开始累计
          </li>
          <li className={paperPlan ? "done" : ""}>
            <Check size={15} />
            A 股 T+1 纸面计划已生成
          </li>
          <li className={dailyReview ? "done" : ""}>
            <Check size={15} />
            每日盘面与交易复盘已生成
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
            <Check size={15} />
            自优化与存储控制策略已声明
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
