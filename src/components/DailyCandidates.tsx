import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { fetchDailyCandidates } from "../lib/tradingApi";
import type { DailyCandidate, DailyCandidateAction } from "../lib/tradingApi";

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function actionLabel(action: DailyCandidateAction): string {
  if (action === "paper-buy") return "模拟买入";
  if (action === "watch") return "观察";
  return "回避";
}

function actionClass(action: DailyCandidateAction): string {
  if (action === "paper-buy") return "gate-pass";
  if (action === "watch") return "gate-caution";
  return "gate-blocked";
}

function candidateReason(candidate: DailyCandidate): string {
  return candidate.reasons[0] ?? candidate.riskFlags[0] ?? "等待更多行情确认。";
}

export function DailyCandidates() {
  const candidatesQuery = useQuery({
    queryKey: ["daily-candidates", 24],
    queryFn: () => fetchDailyCandidates(24),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const report = candidatesQuery.data;
  const candidates = report?.candidates ?? [];

  return (
    <section className="panel daily-candidates">
      <div className="panel-header">
        <div>
          <span className="section-kicker">今日候选扫描</span>
          <h2>A 股强势回踩确认</h2>
        </div>
        <button
          aria-label="刷新今日候选"
          className="icon-button"
          disabled={candidatesQuery.isFetching}
          onClick={() => void candidatesQuery.refetch()}
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      {candidatesQuery.isLoading && (
        <div className="research-empty">正在扫描当前行情候选…</div>
      )}

      {candidatesQuery.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>今日候选暂时不可用，请确认交易后端和行情桥接已启动。</span>
        </div>
      )}

      {report && (
        <>
          <div className="research-summary-grid">
            <article>
              <span>候选策略</span>
              <strong>{report.strategyName}</strong>
              <small>{report.source.provider} · {report.mode}</small>
            </article>
            <article>
              <span>候选数量</span>
              <strong>{candidates.length}</strong>
              <small>{report.source.tradableCount} 个可交易标的</small>
            </article>
            <article>
              <span>模拟可买</span>
              <strong>{candidates.filter((item) => item.action === "paper-buy").length}</strong>
              <small>只代表 paper 验证，不是实盘指令</small>
            </article>
            <article>
              <span>自动更新</span>
              <strong>60s</strong>
              <small>也可手动刷新候选</small>
            </article>
          </div>

          <div className="research-alert">
            <ShieldCheck size={16} />
            <span>{report.guardrails[0]}</span>
          </div>

          <div className="compare-ranking-table-wrapper">
            <table className="data-table research-ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>标的</th>
                  <th>现价</th>
                  <th>涨跌幅</th>
                  <th>评分</th>
                  <th>动作</th>
                  <th>模拟仓位</th>
                  <th>止盈/止损</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.symbol}>
                    <td>
                      <span className={`rank-badge rank-${candidate.rank}`}>
                        {candidate.rank}
                      </span>
                    </td>
                    <td className="symbol-cell">
                      <strong>{candidate.name}</strong>
                      <span className="table-subline">{candidate.symbol}</span>
                    </td>
                    <td>{formatPrice(candidate.price)}</td>
                    <td className={candidate.changePercent >= 0 ? "positive" : "negative"}>
                      {formatPercent(candidate.changePercent / 100)}
                    </td>
                    <td>
                      <strong>{candidate.score.toFixed(1)}</strong>
                      <span className="table-subline">
                        置信度 {(candidate.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className={`rank-badge ${actionClass(candidate.action)}`}>
                        {candidate.action === "paper-buy" && <Target size={13} />}
                        {actionLabel(candidate.action)}
                      </span>
                    </td>
                    <td>{formatPercent(candidate.suggestedPositionWeight)}</td>
                    <td>
                      <span className="table-subline">
                        止盈 {formatPercent(candidate.takeProfitPercent)}
                      </span>
                      <span className="table-subline">
                        止损 -{(candidate.stopLossPercent * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="research-params">
                      {candidateReason(candidate)}
                      {candidate.riskFlags.length > 0 && (
                        <span className="table-subline negative">
                          {candidate.riskFlags[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="research-source-row">
            <Target size={15} />
            <span>
              生成时间 {new Date(report.generatedAt).toLocaleString("zh-CN")} ·
              快照序号 {report.source.snapshotSequence} · {report.autoUpdate.researchRefresh}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
