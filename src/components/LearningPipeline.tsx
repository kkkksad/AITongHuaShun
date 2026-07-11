import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Eye, LockKeyhole, RefreshCw, Sparkles } from "lucide-react";
import { pipelineStages } from "../data/mockData";
import { fetchDailyCandidates, fetchStrategyLeaderboard } from "../lib/tradingApi";

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

  const topStrategy = leaderboardQuery.data?.entries[0];
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

      <aside className="panel governance-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">\u6CBB\u7406\u8FB9\u754C</span>
            <h2>研究管线状态</h2>
          </div>
          <button
            aria-label="刷新研究管线"
            className="icon-button"
            disabled={leaderboardQuery.isFetching || candidatesQuery.isFetching}
            onClick={() => {
              void leaderboardQuery.refetch();
              void candidatesQuery.refetch();
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
          <li className="done">
            <Check size={15} />
            订单执行仍保持 paper-only 隔离
          </li>
          <li>
            <Clock3 size={15} />
            授权历史行情缓存待接入
          </li>
          <li>
            <LockKeyhole size={15} />
            真实下单必须保留人工审批
          </li>
        </ul>
        <button className="primary-button full-width" type="button">
          查看人工复核清单
        </button>
      </aside>
    </div>
  );
}
