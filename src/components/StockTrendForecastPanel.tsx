import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchStockTrendForecast,
  type StockTrendDirection,
  type StockTrendForecastReport,
  type StockTrendOutlook,
} from "../lib/tradingApi";
import {
  formatResearchDataTime,
  getResearchRefreshState,
} from "../lib/researchQueryPresentation";

const directionLabels: Record<StockTrendDirection, string> = {
  bullish: "偏强",
  "slightly-bullish": "震荡偏强",
  sideways: "区间震荡",
  "slightly-bearish": "震荡偏弱",
  bearish: "偏弱",
  "insufficient-data": "数据不足",
};

function directionClass(direction: StockTrendDirection): string {
  if (direction === "bullish" || direction === "slightly-bullish") return "gate-pass";
  if (direction === "bearish" || direction === "slightly-bearish") return "gate-blocked";
  return "gate-caution";
}

function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "样本不足";
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function quotePercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "未取得";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function TrendIcon({ direction }: { direction: StockTrendDirection }) {
  return direction === "bearish" || direction === "slightly-bearish"
    ? <TrendingDown size={17} />
    : <TrendingUp size={17} />;
}

function HorizonItem({ item }: { item: StockTrendOutlook }) {
  const upProbability = item.validation.empiricalUpProbability ?? 0;
  const downProbability = item.validation.empiricalDownProbability ?? 0;
  const flatProbability = item.validation.empiricalFlatProbability ?? 0;
  return (
    <article className="stock-trend-horizon-item">
      <div className="stock-trend-horizon-heading">
        <span>{item.horizon} 个交易日</span>
        <span className={`rank-badge ${directionClass(item.direction)}`}>
          <TrendIcon direction={item.direction} />
          {directionLabels[item.direction]}
        </span>
      </div>
      <div className="stock-trend-score-row">
        <strong>{item.score.toFixed(0)}</strong>
        <span>/ 100 规则分</span>
      </div>
      <div className="stock-trend-probabilities">
        <div>
          <span>经验上涨概率</span>
          <strong className="positive">{percent(item.validation.empiricalUpProbability)}</strong>
        </div>
        <div>
          <span>经验下跌概率</span>
          <strong className="negative">{percent(item.validation.empiricalDownProbability)}</strong>
        </div>
        <div>
          <span>震荡概率</span>
          <strong>{percent(item.validation.empiricalFlatProbability)}</strong>
        </div>
      </div>
      {item.validation.samples > 0 && (
        <div className="stock-trend-probability-bar" aria-label="历史经验涨跌概率分布">
          <span className="up" style={{ width: `${upProbability * 100}%` }} />
          <span className="flat" style={{ width: `${flatProbability * 100}%` }} />
          <span className="down" style={{ width: `${downProbability * 100}%` }} />
        </div>
      )}
      <dl className="stock-trend-horizon-stats">
        <div>
          <dt>信号强度</dt>
          <dd>{item.signalStrength.toFixed(0)} / 100</dd>
        </div>
        <div>
          <dt>历史命中</dt>
          <dd>{percent(item.validation.directionalHitRate)}</dd>
        </div>
        <div>
          <dt>同向样本</dt>
          <dd>{item.validation.samples}</dd>
        </div>
        <div>
          <dt>平均后续</dt>
          <dd className={(item.validation.averageForwardReturn ?? 0) >= 0 ? "positive" : "negative"}>
            {item.validation.averageForwardReturn === null
              ? "样本不足"
              : signedPercent(item.validation.averageForwardReturn)}
          </dd>
        </div>
      </dl>
      <div className="stock-trend-turning-grid">
        <div>
          <TrendingUp size={14} />
          <span>阶段高点</span>
          <strong>
            {item.validation.medianPeakTradingDay === null
              ? "样本不足"
              : `约第 ${item.validation.medianPeakTradingDay} 个交易日`}
          </strong>
          <small>
            {item.validation.medianPeakReturn === null
              ? "中位幅度未取得"
              : `中位幅度 ${signedPercent(item.validation.medianPeakReturn)}`}
          </small>
        </div>
        <div>
          <TrendingDown size={14} />
          <span>阶段低点</span>
          <strong>
            {item.validation.medianTroughTradingDay === null
              ? "样本不足"
              : `约第 ${item.validation.medianTroughTradingDay} 个交易日`}
          </strong>
          <small>
            {item.validation.medianTroughReturn === null
              ? "中位幅度未取得"
              : `中位幅度 ${signedPercent(item.validation.medianTroughReturn)}`}
          </small>
        </div>
      </div>
      <div className="stock-trend-band">
        波动参考 ±{percent(item.volatilityReferencePercent)}
      </div>
    </article>
  );
}

function AmbiguousMatches({
  report,
  onSelect,
}: {
  report: StockTrendForecastReport;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="stock-trend-match-list" aria-label="匹配股票">
      {report.matches.map((match) => (
        <button key={match.symbol} onClick={() => onSelect(match.symbol)} type="button">
          <span>
            <strong>{match.name}</strong>
            <small>{match.symbol}</small>
          </span>
          <span className={match.changePercent >= 0 ? "positive" : "negative"}>
            {quotePercent(match.changePercent)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function StockTrendForecastPanel() {
  const [input, setInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const trendQuery = useQuery({
    queryKey: ["stock-trend-forecast", submittedQuery, 360],
    queryFn: () => fetchStockTrendForecast(submittedQuery, 360),
    enabled: submittedQuery.length > 0,
    staleTime: 10 * 60_000,
  });
  const report = trendQuery.data;
  const refreshState = getResearchRefreshState({
    hasData: Boolean(report),
    isError: trendQuery.isError,
  });

  function runQuery(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    setInput(normalized);
    setSubmittedQuery(normalized);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runQuery(input);
  }

  return (
    <section className="panel stock-trend-panel">
      <div className="panel-header stock-trend-header">
        <div>
          <span className="section-kicker">真实前复权日线</span>
          <h2>个股未来趋势研判</h2>
        </div>
        {submittedQuery && (
          <button
            aria-label="刷新个股趋势研究"
            className="icon-button"
            disabled={trendQuery.isFetching}
            onClick={() => void trendQuery.refetch()}
            title="刷新"
            type="button"
          >
            <RefreshCw className={trendQuery.isFetching ? "spin" : ""} size={17} />
          </button>
        )}
      </div>

      <form className="stock-trend-search" onSubmit={submit}>
        <div className="stock-trend-search-input">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="股票名称或代码"
            autoComplete="off"
            maxLength={40}
            onChange={(event) => setInput(event.target.value)}
            placeholder="股票名称或 6 位代码"
            spellCheck={false}
            value={input}
          />
        </div>
        <button disabled={!input.trim() || trendQuery.isFetching} type="submit">
          <Search size={16} />
          {trendQuery.isFetching ? "分析中" : "分析趋势"}
        </button>
      </form>

      {trendQuery.isLoading && (
        <div className="research-empty">正在读取真实行情与历史日线…</div>
      )}

      {refreshState.showBlockingError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>{trendQuery.error instanceof Error ? trendQuery.error.message : "趋势研究暂不可用。"}</span>
        </div>
      )}

      {refreshState.showStaleWarning && (
        <div className="research-alert regime-warning">
          <Clock3 size={16} />
          <span>
            本次刷新失败，继续显示缓存数据 · 上次成功更新 {formatResearchDataTime(trendQuery.dataUpdatedAt)}
          </span>
        </div>
      )}

      {report?.resolution === "ambiguous" && (
        <AmbiguousMatches onSelect={runQuery} report={report} />
      )}

      {report?.resolution === "not-found" && (
        <div className="research-empty">没有找到与“{report.query}”匹配的 A 股。</div>
      )}

      {report?.resolution === "mock-disabled" && (
        <div className="research-alert">
          <ShieldAlert size={16} />
          <span>{report.warnings[0]}</span>
        </div>
      )}

      {report?.resolution === "degraded" && !report.latest && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>{report.warnings[0] ?? "真实行情源暂不可用。"}</span>
        </div>
      )}

      {report?.selected && report.latest && (
        <div className="stock-trend-results">
          <div className="stock-trend-identity">
            <div>
              <span>{report.selected.symbol} · {report.latest.date}</span>
              <h3>{report.selected.name}</h3>
            </div>
            <div className="stock-trend-quote">
              <strong>{formatPrice(report.selected.price)}</strong>
              <span className={report.selected.changePercent >= 0 ? "positive" : "negative"}>
                {quotePercent(report.selected.changePercent)}
              </span>
            </div>
          </div>

          {report.warnings.length > 0 && (
            <div className="research-alert stock-trend-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings[0]}</span>
            </div>
          )}

          <div className="stock-trend-source-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "部分降级"}</strong>
            </div>
            <div>
              <span>历史样本</span>
              <strong>{report.source.barCount} 根</strong>
            </div>
            <div>
              <span>复权方式</span>
              <strong>前复权</strong>
            </div>
            <div>
              <span>20 日支撑</span>
              <strong>{report.supportResistance ? formatPrice(report.supportResistance.support20) : "未取得"}</strong>
            </div>
            <div>
              <span>20 日压力</span>
              <strong>{report.supportResistance ? formatPrice(report.supportResistance.resistance20) : "未取得"}</strong>
            </div>
          </div>

          {report.chart.length > 0 && (
            <div className="stock-trend-chart" aria-label={`${report.selected.name} 真实历史走势`}>
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={report.chart} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-light)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="date"
                    minTickGap={28}
                    tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                    tickFormatter={(value: string) => value.slice(5)}
                    tickLine={false}
                  />
                  <YAxis
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                    tickFormatter={(value: number) => value.toFixed(0)}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-default)",
                      borderRadius: 6,
                    }}
                    formatter={(value: number, name: string) => [
                      value.toFixed(2),
                      name === "close" ? "收盘" : name === "ma20" ? "MA20" : "MA60",
                    ]}
                    labelFormatter={(label) => `交易日 ${label}`}
                  />
                  <Line dataKey="close" dot={false} name="close" stroke="#2563eb" strokeWidth={2.2} type="monotone" />
                  <Line dataKey="ma20" dot={false} name="ma20" stroke="#0f9f8f" strokeWidth={1.5} type="monotone" />
                  <Line dataKey="ma60" dot={false} name="ma60" stroke="#d97706" strokeWidth={1.5} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="stock-trend-horizons">
            {report.horizons.map((item) => <HorizonItem item={item} key={item.horizon} />)}
          </div>

          {report.factors && (
            <div className="stock-trend-factors">
              <div><span>5 日动量</span><strong className={report.factors.return5d >= 0 ? "positive" : "negative"}>{signedPercent(report.factors.return5d)}</strong></div>
              <div><span>20 日动量</span><strong className={report.factors.return20d >= 0 ? "positive" : "negative"}>{signedPercent(report.factors.return20d)}</strong></div>
              <div><span>60 日动量</span><strong className={report.factors.return60d >= 0 ? "positive" : "negative"}>{signedPercent(report.factors.return60d)}</strong></div>
              <div><span>RSI14</span><strong>{report.factors.rsi14.toFixed(1)}</strong></div>
              <div><span>20 日波动</span><strong>{percent(report.factors.annualizedVolatility20d)}</strong></div>
              <div><span>量能比</span><strong>{report.factors.volumeRatio5d.toFixed(2)}x</strong></div>
            </div>
          )}

          <div className="stock-trend-notes">
            <div>
              <strong><CheckCircle2 size={15} />当前依据</strong>
              <ul>{report.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <strong><ShieldAlert size={15} />主要风险</strong>
              <ul>{report.risks.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>

          <div className="research-alert regime-source-ok stock-trend-methodology">
            <CheckCircle2 size={16} />
            <span>{report.methodology.scoreMeaning} 经验涨跌概率与高低点时间来自历史同方向样本频率和中位数，不是校准后的未来概率或保证日期。</span>
          </div>
          <div className="research-source-row">
            <span>{report.source.historySource}</span>
            <span>·</span>
            <span>更新 {formatDateTime(report.source.fetchedAt)}</span>
            <span>·</span>
            <span>只读研究，不连接订单</span>
          </div>
        </div>
      )}
    </section>
  );
}
