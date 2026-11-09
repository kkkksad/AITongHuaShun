import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Database, RefreshCw, ShieldCheck } from "lucide-react";
import {
  fetchStrategyRobustness,
  type StrategyRobustnessFamily,
} from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

const familyLabels: Record<StrategyRobustnessFamily, string> = {
  trend: "趋势",
  pullback: "回踩",
  breakout: "突破",
  "mean-reversion": "均值回归",
  defensive: "防守",
};

const gateLabels = {
  pass: "通过",
  caution: "观察",
  blocked: "拦截",
} as const;

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function evidenceTone(score: number): "strong" | "medium" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 50) return "medium";
  return "weak";
}

export function StrategyRobustnessPanel() {
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const reportQuery = useQuery({
    queryKey: ["strategy-robustness", 12, 500],
    queryFn: ({ signal }) => fetchStrategyRobustness(12, 500, signal),
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
  const report = reportQuery.data;
  const allEntries = report?.entries ?? [];
  const symbols = [...new Map(allEntries.filter(e => e.evaluatedSymbol).map(e => [e.evaluatedSymbol!, e.evaluatedName || e.evaluatedSymbol!])).entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const currentSymbol = symbols.some(([symbol]) => symbol === selectedSymbol) ? selectedSymbol : symbols[0]?.[0];
  const entries = symbols.length > 0 ? allEntries.filter(e => e.evaluatedSymbol === currentSymbol) : allEntries;
  const strategyCount = new Set(allEntries.map(e => e.strategyKey)).size;
  const passCount = entries.filter((entry) => entry.stabilityGate === "pass").length;

  return (
    <section className="panel research-leaderboard">
      <div className="panel-header">
        <div>
          <span className="section-kicker">真实样本验证</span>
          <h2>A 股策略多窗口稳健性</h2>
        </div>
        <button
          aria-label="刷新真实历史稳健性验证"
          className="icon-button"
          disabled={reportQuery.isFetching}
          onClick={() => void reportQuery.refetch()}
          title="刷新真实历史稳健性验证"
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <ResearchQueryState
        dataUpdatedAt={reportQuery.dataUpdatedAt}
        hasData={Boolean(report)}
        isError={reportQuery.isError}
        isLoading={reportQuery.isLoading}
        loadingText="正在读取真实前复权日线并运行分窗回测..."
        unavailableText="真实历史稳健性验证暂时不可用，请检查后端与 AkShare 桥接。"
      />

      {report && (
        <>
          <div className="research-summary-grid">
            <article>
              <span>历史股票</span>
              <strong>{report.source.historySymbols}</strong>
              <small>请求 {report.source.requestedSymbols} 只 · 实际逐股测试 {report.source.testedSymbols ?? "未提供"} 只</small>
            </article>
            <article>
              <span>共同交易日</span>
              <strong>{report.source.alignedTradingDays}</strong>
              <small>最多请求 {report.source.requestedDays} 根前复权日线</small>
            </article>
            <article>
              <span>固定策略</span>
              <strong>{strategyCount}</strong>
              <small>每股每策略 {report.source.windowCount} 窗 · 合计 {report.source.symbolWindowTests ?? "未提供"} 次单股窗口验证</small>
            </article>
            <article>
              <span>当前股票稳健性通过</span>
              <strong className={passCount > 0 ? "positive" : "negative"}>{passCount}</strong>
              <small>不在当前验证样本上重新调参</small>
            </article>
          </div>

          <div className="research-alert">
            <ShieldCheck size={16} />
            <span>{report.methodology.stabilityMeaning} {report.methodology.evidenceScoreMeaning}</span>
          </div>

          {symbols.length > 0 ? (
            <label className="research-source-row robustness-stock-selection">
              <span>验证股票</span>
              <select aria-label="选择验证股票" value={currentSymbol} onChange={event => setSelectedSymbol(event.target.value)}>
                {symbols.map(([symbol, name]) => <option key={symbol} value={symbol}>{name} · {symbol}</option>)}
              </select>
              <span>每股独立研究账户；未平仓盈亏不进入闭合片段胜率，权益收益包含期末估值。</span>
            </label>
          ) : allEntries.length > 0 ? (
            <div className="research-alert">旧报告未提供逐股覆盖，不能把历史股票数当成实际测试股票数；刷新以读取新报告。</div>
          ) : null}

          {report.warnings.map((warning) => (
            <div className="research-alert" key={warning}>
              <AlertTriangle size={16} />
              <span>{warning}</span>
            </div>
          ))}

          {entries.length > 0 ? (
            <div className="compare-ranking-table-wrapper robustness-table-wrapper">
              <table className="data-table research-ranking-table robustness-table">
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>策略</th>
                    <th>盈利窗口</th>
                    <th>交易数</th>
                    <th>证据分</th>
                    <th>脆弱性</th>
                    <th>稳健门槛</th>
                    <th>中位收益</th>
                    <th>最差收益</th>
                    <th>平均回撤</th>
                    <th>最差回撤</th>
                    <th>闭合片段胜率</th>
                    <th>平均夏普</th>
                    <th>平均盈亏比</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={`${entry.evaluatedSymbol || "legacy"}:${entry.strategyKey}`}>
                      <td><span className={`rank-badge rank-${entry.rank}`}>{entry.rank}</span></td>
                      <td className="symbol-cell">
                        <strong>{entry.strategyName}</strong>
                        <span className="strategy-family-label">{familyLabels[entry.strategyFamily]}</span>
                      </td>
                      <td><strong>{entry.profitableWindows}/{entry.windows}</strong></td>
                      <td>{entry.totalTrades}</td>
                      <td>
                        <span className={`evidence-badge evidence-${evidenceTone(entry.evidenceScore)}`}>
                          {entry.evidenceScore}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`fragility-badge${entry.fragilityFlags.length > 0 ? " has-flags" : ""}`}
                          title={entry.fragilityFlags.length > 0 ? entry.fragilityFlags.join("；") : "未触发当前脆弱性规则"}
                        >
                          {entry.fragilityFlags.length > 0 ? `${entry.fragilityFlags.length} 项` : "无"}
                        </span>
                      </td>
                      <td>
                        <span className={`rank-badge gate-${entry.stabilityGate}`}>
                          {gateLabels[entry.stabilityGate]}
                        </span>
                      </td>
                      <td className={entry.medianReturn >= 0 ? "positive" : "negative"}>
                        {formatPercent(entry.medianReturn)}
                      </td>
                      <td className={entry.worstReturn >= 0 ? "positive" : "negative"}>
                        {formatPercent(entry.worstReturn)}
                      </td>
                      <td>{formatPercent(-entry.averageMaxDrawdown)}</td>
                      <td className="negative">{formatPercent(-entry.worstMaxDrawdown)}</td>
                      <td data-closed-match-rate>
                        {entry.closedMatchWinRate != null && entry.closedMatches != null && entry.closedMatches > 0
                          ? <>{(entry.closedMatchWinRate * 100).toFixed(2)}%<small className="robustness-closed-samples">盈利 {entry.winningMatches} / {entry.closedMatches}</small></>
                          : <>—<small className="robustness-closed-samples">{entry.closedMatches === 0 ? "无闭合样本" : "未提供闭合分母"}</small></>}
                      </td>
                      <td className={entry.averageSharpeRatio >= 0 ? "positive" : "negative"}>
                        {entry.averageSharpeRatio.toFixed(2)}
                      </td>
                      <td>{entry.averageProfitFactor === null ? "—" : entry.averageProfitFactor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="research-empty">
              当前没有可用真实历史结果。系统不会用合成 K 线补位。
            </div>
          )}

          <div className="research-source-row">
            <Database size={15} />
            <span>
              {report.source.historySource} · 前复权 · 生成时间 {new Date(report.generatedAt).toLocaleString("zh-CN")}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
