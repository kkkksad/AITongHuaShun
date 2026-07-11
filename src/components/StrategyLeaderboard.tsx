import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, RefreshCw, Trophy } from "lucide-react";
import { fetchStrategyLeaderboard } from "../lib/tradingApi";
import type { StrategyLeaderboardEntry } from "../lib/tradingApi";

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toFixed(2);
}

function formatParams(params: Record<string, number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${Number.isInteger(value) ? value : value.toFixed(2)}`)
    .join(" · ");
}

function bestByReturn(entries: StrategyLeaderboardEntry[]): StrategyLeaderboardEntry | undefined {
  return [...entries].sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn)[0];
}

export function StrategyLeaderboard() {
  const leaderboardQuery = useQuery({
    queryKey: ["strategy-leaderboard", 90],
    queryFn: () => fetchStrategyLeaderboard(90),
    staleTime: 60_000,
  });

  const report = leaderboardQuery.data;
  const entries = report?.entries ?? [];
  const topReturn = bestByReturn(entries);

  return (
    <section className="panel research-leaderboard">
      <div className="panel-header">
        <div>
          <span className="section-kicker">研究排行榜</span>
          <h2>收益率优先策略搜索</h2>
        </div>
        <button
          aria-label="刷新策略排行榜"
          className="icon-button"
          disabled={leaderboardQuery.isFetching}
          onClick={() => void leaderboardQuery.refetch()}
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      {leaderboardQuery.isLoading && (
        <div className="research-empty">正在运行策略参数搜索…</div>
      )}

      {leaderboardQuery.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>策略排行榜暂时不可用，请确认后端服务已启动。</span>
        </div>
      )}

      {report && (
        <>
          <div className="research-summary-grid">
            <article>
              <span>当前第一</span>
              <strong>{topReturn?.strategyName ?? "暂无"}</strong>
              <small>按模拟总收益排序</small>
            </article>
            <article>
              <span>模拟收益</span>
              <strong className={topReturn && topReturn.metrics.totalReturn >= 0 ? "positive" : "negative"}>
                {topReturn ? formatPercent(topReturn.metrics.totalReturn) : "0.00%"}
              </strong>
              <small>非真实收益</small>
            </article>
            <article>
              <span>样本来源</span>
              <strong>{report.source.provider}</strong>
              <small>{report.source.sampleType === "synthetic-from-current-snapshot" ? "快照生成样本" : "研究样本"}</small>
            </article>
            <article>
              <span>搜索规模</span>
              <strong>{entries.reduce((sum, entry) => sum + entry.trialCount, 0)}</strong>
              <small>{report.source.bars} bars · {report.source.tradableSymbols.length} 标的</small>
            </article>
          </div>

          <div className="research-alert">
            <AlertTriangle size={16} />
            <span>{report.guardrails[0]}</span>
          </div>

          <div className="compare-ranking-table-wrapper">
            <table className="data-table research-ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>策略</th>
                  <th>总收益</th>
                  <th>年化收益</th>
                  <th>夏普</th>
                  <th>最大回撤</th>
                  <th>胜率</th>
                  <th>最佳参数</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.strategyKey}>
                    <td>
                      <span className={`rank-badge rank-${entry.rank}`}>
                        {entry.rank === 1 ? <Trophy size={13} /> : entry.rank}
                      </span>
                    </td>
                    <td className="symbol-cell">
                      <strong>{entry.strategyName}</strong>
                      <span className="table-subline">{entry.trialCount} 次试验</span>
                    </td>
                    <td className={entry.metrics.totalReturn >= 0 ? "positive" : "negative"}>
                      <strong>{formatPercent(entry.metrics.totalReturn)}</strong>
                    </td>
                    <td>{formatPercent(entry.metrics.annualizedReturn)}</td>
                    <td>{formatNumber(entry.metrics.sharpeRatio)}</td>
                    <td className="negative">-{(entry.metrics.maxDrawdownPercent * 100).toFixed(2)}%</td>
                    <td>{formatPercent(entry.metrics.winRate)}</td>
                    <td className="research-params">{formatParams(entry.bestParams)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="research-source-row">
            <BarChart3 size={15} />
            <span>
              生成时间 {new Date(report.generatedAt).toLocaleString("zh-CN")} · 快照序号{" "}
              {report.source.snapshotSequence}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
