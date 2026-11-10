import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, RefreshCw, ShieldCheck, Target, Trophy } from "lucide-react";
import { ResearchQueryState } from "./ResearchQueryState";
import type { StrategyLeaderboardEntry } from "../lib/tradingApi";
import { strategyLeaderboardQueryOptions } from "../lib/researchQueries";

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

function bestBySuccessRate(entries: StrategyLeaderboardEntry[]): StrategyLeaderboardEntry | undefined {
  return [...entries].sort((a, b) => {
    if (a.qualityGate !== b.qualityGate) {
      const gateRank = { pass: 0, caution: 1, blocked: 2 };
      return gateRank[a.qualityGate] - gateRank[b.qualityGate];
    }
    if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
    if (b.metrics.totalTrades !== a.metrics.totalTrades) return b.metrics.totalTrades - a.metrics.totalTrades;
    return b.metrics.totalReturn - a.metrics.totalReturn;
  })[0];
}

function qualityColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "#eab308";
  if (score >= 50) return "#f97316";
  return "#ef4444";
}

function closedMatchEvidence(entry?: StrategyLeaderboardEntry): { rate: number | null; note: string } {
  if (!entry) return { rate: null, note: "暂无策略样本" };
  const { winningMatches: wins, closedMatches: total, winRate } = entry.metrics;
  if (wins === undefined || total === undefined) return { rate: null, note: "未提供闭合分母" };
  if (!Number.isSafeInteger(wins) || !Number.isSafeInteger(total) || wins < 0 || total < 0 || wins > total ||
      !Number.isFinite(winRate) || winRate < 0 || winRate > 1 || (total === 0 ? winRate !== 0 : winRate !== wins / total)) {
    return { rate: null, note: "闭合样本不可核对" };
  }
  return total === 0 ? { rate: null, note: "无闭合样本" }
    : { rate: winRate, note: `盈利 ${wins} / ${total}` };
}

function ClosedMatchRate({ entry }: { entry: StrategyLeaderboardEntry }) {
  const evidence = closedMatchEvidence(entry);
  return <td data-closed-match-rate>
    <strong>{evidence.rate === null ? "—" : `${(evidence.rate * 100).toFixed(2)}%`}</strong>
    <span className="table-subline">{evidence.note}</span>
    <span className="table-subline">成交 {entry.metrics.totalTrades} 单</span>
  </td>;
}

export function StrategyLeaderboard() {
  const leaderboardQuery = useQuery(strategyLeaderboardQueryOptions(120));

  const report = leaderboardQuery.data;
  const entries = report?.entries ?? [];
  const topStrategy = bestBySuccessRate(entries);
  const topEvidence = closedMatchEvidence(topStrategy);

  return (
    <section className="panel research-leaderboard">
      <div className="panel-header">
        <div>
          <span className="section-kicker">研究排行榜</span>
          <h2>合成回测策略搜索</h2>
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

      <ResearchQueryState
        dataUpdatedAt={leaderboardQuery.dataUpdatedAt}
        hasData={Boolean(report)}
        isError={leaderboardQuery.isError}
        isLoading={leaderboardQuery.isLoading}
        loadingText="正在运行策略参数搜索…"
        unavailableText="策略排行榜暂时不可用，请确认后端服务已启动。"
      />

      {report && (
        <>
          <div className="research-summary-grid">
            <article>
              <span>当前第一</span>
              <strong>{topStrategy?.strategyName ?? "暂无"}</strong>
              <small>按胜率、交易次数和风控约束排序</small>
            </article>
            <article>
              <span>闭合片段胜率</span>
              <strong data-summary-closed-rate className={topEvidence.rate === null ? undefined : topEvidence.rate >= 0.5 ? "positive" : "negative"}>
                {topEvidence.rate === null ? "—" : `${(topEvidence.rate * 100).toFixed(2)}%`}
              </strong>
              <small>{topEvidence.note} · 成交 {topStrategy?.metrics.totalTrades ?? 0} 单</small>
            </article>
            <article>
              <span>数据质量</span>
              <strong style={{ color: qualityColor(report.dataQuality.score.overall) }}>
                {report.dataQuality.score.overall}分
              </strong>
              <small>{report.dataQuality.summary}</small>
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

          <div className="research-alert">
            <ShieldCheck size={16} />
            <span>胜率按费用后已闭合 FIFO 买卖匹配片段计算；未平仓不计入分母，成交单数另列。合成研究不是未来胜率或真实收益；年化假设每年 252 根日线。</span>
          </div>

          {report.dataQuality.score.overall < 70 && (
            <div className="research-alert" style={{ borderLeftColor: "#f97316" }}>
              <ShieldCheck size={16} />
              <span>
                数据质量偏低（{report.dataQuality.score.overall}分），排行榜结果仅供参考。
                {report.dataQuality.score.adjustmentWarningCount > 0 &&
                  ` ${report.dataQuality.score.adjustmentWarningCount}个标的存在复权缺口。`}
                {report.dataQuality.score.anomalyPriceCount > 0 &&
                  ` ${report.dataQuality.score.anomalyPriceCount}个标的价格异常。`}
              </span>
            </div>
          )}

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
                  <th>闭合片段胜率</th>
                  <th>约束</th>
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
                    <ClosedMatchRate entry={entry} />
                    <td>
                      <span className={`rank-badge gate-${entry.qualityGate}`}>
                        {entry.qualityGate === "pass" && <Target size={13} />}
                        {entry.qualityGate === "pass"
                          ? "通过"
                          : entry.qualityGate === "caution"
                            ? "观察"
                            : "拦截"}
                      </span>
                    </td>
                    <td className="research-params">{formatParams(entry.bestParams)}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td className="empty-copy" colSpan={9}>
                      {report.dataQuality.summary}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="research-source-row">
            <BarChart3 size={15} />
            <span>
              生成时间 {new Date(report.generatedAt).toLocaleString("zh-CN")} · 快照序号{" "}
              {report.source.snapshotSequence} · 种子 {report.seed}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
