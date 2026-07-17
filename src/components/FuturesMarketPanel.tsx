import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  fetchCrossMarketStrategyContext,
  type CrossMarketRiskTone,
  type StrategyRobustnessFamily,
} from "../lib/tradingApi";

const riskToneLabels: Record<CrossMarketRiskTone, string> = {
  "risk-on": "风险偏好",
  neutral: "中性分化",
  "risk-off": "风险规避",
  mixed: "信号冲突",
};

const postureLabels = {
  normal: "常规研究仓位",
  reduced: "降低新增仓位",
  "cash-only": "现金观望",
} as const;

const familyLabels: Record<StrategyRobustnessFamily, string> = {
  trend: "趋势",
  pullback: "回踩",
  breakout: "突破",
  "mean-reversion": "均值回归",
  defensive: "防守",
};

function signedPercent(value: number | null): string {
  if (value === null) return "未取得";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function quotePercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function unsignedPercent(value: number | null): string {
  return value === null ? "未取得" : `${(value * 100).toFixed(1)}%`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function statusClass(tone: CrossMarketRiskTone): string {
  if (tone === "risk-on") return "positive";
  if (tone === "risk-off" || tone === "mixed") return "negative";
  return "";
}

function familyList(families: StrategyRobustnessFamily[]): string {
  return families.length > 0
    ? families.map((family) => familyLabels[family]).join(" / ")
    : "无";
}

export function FuturesMarketPanel() {
  const query = useQuery({
    queryKey: ["cross-market-strategy-context", 12, 180],
    queryFn: () => fetchCrossMarketStrategyContext(12, 180),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;

  return (
    <section className="panel futures-market-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">国内主连 · 跨市场状态</span>
          <h2>期货观察</h2>
        </div>
        <button
          aria-label="刷新期货与跨市场研究"
          className="icon-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          title="刷新"
          type="button"
        >
          <RefreshCw className={query.isFetching ? "spin" : ""} size={17} />
        </button>
      </div>

      {query.isLoading && (
        <div className="research-empty">正在读取全球指数与国内期货主连...</div>
      )}
      {query.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>期货跨市场研究暂不可用，请检查后端与 AkShare 桥接。</span>
        </div>
      )}

      {report && (
        <>
          <div className="regime-meta-strip hk-meta-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "降级"}</strong>
            </div>
            <div>
              <span>市场基调</span>
              <strong className={statusClass(report.riskTone)}>
                {riskToneLabels[report.riskTone]}
              </strong>
            </div>
            <div>
              <span>仓位姿态</span>
              <strong>{postureLabels[report.positionPosture]}</strong>
            </div>
            <div>
              <span>期货快照</span>
              <strong>{report.source.futuresQuoteCount}</strong>
            </div>
            <div>
              <span>连续历史</span>
              <strong>{report.source.futuresHistoryCount}</strong>
            </div>
          </div>

          <div className="futures-strategy-context">
            <div>
              <span>优先研究策略族</span>
              <strong>{familyList(report.preferredStrategyFamilies)}</strong>
              <small>{report.preferredStrategyKeys.join(" / ") || "信号不足时不启用新增仓位策略"}</small>
            </div>
            <div>
              <span>降权策略族</span>
              <strong>{familyList(report.deweightedStrategyFamilies)}</strong>
              <small>{report.evidence[0]}</small>
            </div>
          </div>

          <div className="research-alert regime-source-ok">
            <ShieldCheck size={16} />
            <span>{report.guardrails[0]}</span>
          </div>

          {report.warnings.length > 0 && (
            <div className="research-alert regime-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings[0]}</span>
            </div>
          )}

          <div className="regime-table-wrap">
            {report.futures.length === 0 ? (
              <div className="research-empty">当前没有取得可用期货主连行情。</div>
            ) : (
              <table className="data-table futures-table">
                <thead>
                  <tr>
                    <th>品种</th>
                    <th>主连</th>
                    <th>最新 / 涨跌</th>
                    <th>5 / 20 / 60 日</th>
                    <th>波动 / 回撤</th>
                    <th>成交 / 持仓</th>
                    <th>历史</th>
                  </tr>
                </thead>
                <tbody>
                  {report.futures.map((item) => (
                    <tr key={item.symbol}>
                      <td>
                        <span className="rank-badge gate-caution">{item.category}</span>
                      </td>
                      <td className="symbol-cell">
                        <strong>{item.name}</strong>
                        <span className="table-subline">{item.symbol}</span>
                      </td>
                      <td className={item.changePercent >= 0 ? "positive" : "negative"}>
                        <strong>{item.price.toFixed(2)}</strong>
                        <span className="table-subline">{quotePercent(item.changePercent)}</span>
                      </td>
                      <td>
                        {signedPercent(item.history.return5d)} / {signedPercent(item.history.return20d)}
                        <span className="table-subline">60 日 {signedPercent(item.history.return60d)}</span>
                      </td>
                      <td>
                        年化 {unsignedPercent(item.history.annualizedVolatility20d)}
                        <span className="table-subline negative">
                          高点回撤 {signedPercent(item.history.drawdownFrom60DayHigh)}
                        </span>
                      </td>
                      <td>
                        {compactNumber(item.volume)}
                        <span className="table-subline">持仓 {compactNumber(item.openInterest)}</span>
                      </td>
                      <td>
                        {item.history.barCount} 根
                        <span className="table-subline">{item.history.latestDate ?? "未取得"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="research-source-row">
            <Activity size={15} />
            <span>
              {report.source.globalSource} + {report.source.futuresQuoteSource} + {report.source.futuresHistorySource}
              {" · "}主连连续 · 只读研究 · 不读取期货账户
            </span>
          </div>
        </>
      )}
    </section>
  );
}
