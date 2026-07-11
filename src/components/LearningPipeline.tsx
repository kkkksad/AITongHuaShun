import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Check,
  Clock3,
  Database,
  Eye,
  LockKeyhole,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { pipelineStages } from "../data/mockData";
import {
  fetchDailyCandidates,
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
    queryKey: ["strategy-leaderboard", "pipeline", 90],
    queryFn: () => fetchStrategyLeaderboard(90),
    staleTime: 60_000,
  });
  const candidatesQuery = useQuery({
    queryKey: ["daily-candidates", "pipeline", 8],
    queryFn: () => fetchDailyCandidates(8),
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
  const selfOptimizationQuery = useQuery({
    queryKey: ["self-optimization-status"],
    queryFn: fetchSelfOptimizationStatus,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const topStrategy = leaderboardQuery.data?.entries[0];
  const learningState = learningStateQuery.data;
  const paperPlan = paperPlanQuery.data;
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
              <span className="section-kicker">\u53D7\u63A7\u7814\u7A76\u6D41\u7A0B</span>
              <h2>\u5019\u9009\u7B56\u7565\u9A8C\u8BC1</h2>
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
                      <span>\u9636\u6BB5 {index + 1}</span>
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
            <span className="section-kicker">\u6CBB\u7406\u8FB9\u754C</span>
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
              selfOptimizationQuery.isFetching
            }
            onClick={() => {
              void leaderboardQuery.refetch();
              void candidatesQuery.refetch();
              void learningStateQuery.refetch();
              void paperPlanQuery.refetch();
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
