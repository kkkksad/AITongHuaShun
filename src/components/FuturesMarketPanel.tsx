import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, Minus, RefreshCw, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import {
  fetchCrossMarketStrategyContext,
  type CrossMarketRiskTone,
  type FuturesMarketResearchItem,
  type StrategyRobustnessFamily,
} from "../lib/tradingApi";
import { getResearchRefreshState } from "../lib/researchQueryPresentation";
import { ResearchQueryState } from "./ResearchQueryState";

const riskToneLabels: Record<CrossMarketRiskTone, string> = {
  "risk-on": "风险偏好",
  neutral: "中性分化",
  "risk-off": "风险规避",
  mixed: "信号冲突",
};
const postureLabels = { normal: "常规研究仓位", reduced: "降低新增仓位", "cash-only": "现金观望" } as const;
const familyLabels: Record<StrategyRobustnessFamily, string> = {
  trend: "趋势", pullback: "回踩", breakout: "突破", "mean-reversion": "均值回归", defensive: "防守",
};
const directionLabels = { bullish: "偏多", bearish: "偏空", range: "震荡", insufficient: "样本不足" } as const;
const structureLabels = { uptrend: "上行结构", downtrend: "下行结构", range: "区间结构", unknown: "结构待确认" } as const;

function signedPercent(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}
function quotePercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function unsignedPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function statusClass(tone: CrossMarketRiskTone): string {
  return tone === "risk-on" ? "positive" : tone === "risk-off" || tone === "mixed" ? "negative" : "";
}
function directionClass(direction: FuturesMarketResearchItem["forecast"]["direction"]): string {
  return direction === "bullish" ? "positive" : direction === "bearish" ? "negative" : "";
}
function familyList(families: StrategyRobustnessFamily[]): string {
  return families.length > 0 ? families.map((family) => familyLabels[family]).join(" / ") : "无";
}
function forecastConviction(item: FuturesMarketResearchItem): number {
  return Math.abs((item.forecast.upFrequency ?? 0) - (item.forecast.downFrequency ?? 0)) + Math.min(item.forecast.sampleSize, 60) / 600;
}
function DirectionIcon({ direction }: { direction: FuturesMarketResearchItem["forecast"]["direction"] }) {
  if (direction === "bullish") return <TrendingUp size={15} />;
  if (direction === "bearish") return <TrendingDown size={15} />;
  return <Minus size={15} />;
}

function FuturesForecastRow({ item }: { item: FuturesMarketResearchItem }) {
  const forecast = item.forecast;
  return (
    <article className="futures-forecast-row">
      <div className="futures-forecast-heading">
        <div><span>{item.category} · {item.symbol}</span><strong>{item.name}</strong></div>
        <span className={`futures-direction ${directionClass(forecast.direction)}`}>
          <DirectionIcon direction={forecast.direction} />{directionLabels[forecast.direction]}
        </span>
      </div>
      <div className="futures-forecast-frequencies" aria-label={`${item.name}五日历史条件频率`}>
        <div><span>上涨频率</span><strong className="positive">{unsignedPercent(forecast.upFrequency)}</strong></div>
        <div><span>下跌频率</span><strong className="negative">{unsignedPercent(forecast.downFrequency)}</strong></div>
        <div><span>震荡频率</span><strong>{unsignedPercent(forecast.rangeFrequency)}</strong></div>
      </div>
      <div className="futures-forecast-stats">
        <span>{structureLabels[forecast.structure]}</span><span>{forecast.sampleSize} 个样本</span>
        <span>中位收益 {signedPercent(forecast.medianForwardReturn)}</span>
        <span>有利 / 不利 {signedPercent(forecast.medianMaxFavorableMove)} / {signedPercent(forecast.medianMaxAdverseMove)}</span>
      </div>
      <p>{forecast.invalidation}</p>
    </article>
  );
}

export function FuturesMarketPanel() {
  const query = useQuery({
    queryKey: ["cross-market-strategy-context", 16, 500],
    queryFn: ({ signal }) => fetchCrossMarketStrategyContext(16, 500, signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;
  const refreshState = getResearchRefreshState({ hasData: Boolean(report), isError: query.isError });
  const forecastItems = [...(report?.futures ?? [])]
    .filter((item) => item.forecast.direction !== "insufficient")
    .sort((left, right) => forecastConviction(right) - forecastConviction(left))
    .slice(0, 6);
  const sourceState = refreshState.showStaleWarning ? "缓存" : report?.sourceStatus === "live-read-only" ? "真实只读" : report ? "降级" : "离线";

  return (
    <section className="panel futures-market-panel">
      <div className="panel-header research-panel-header">
        <div><span className="section-kicker">国内主连 · 500 日条件验证</span><h2>期货趋势研判</h2></div>
        <div className="research-panel-actions">
          <span className={`research-source-status ${sourceState === "真实只读" ? "live" : "degraded"}`}><Database size={14} />{sourceState}</span>
          <button aria-label="刷新期货与跨市场研究" className="icon-button" disabled={query.isFetching} onClick={() => void query.refetch()} title="刷新" type="button">
            <RefreshCw className={query.isFetching ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <ResearchQueryState
        dataUpdatedAt={query.dataUpdatedAt}
        hasData={Boolean(report)}
        isError={query.isError}
        isLoading={query.isLoading}
        loadingText="正在读取全球指数、国内期货主连与 500 日历史…"
        unavailableText="当前没有可保留的期货研究数据，请检查后端与 AkShare 桥接。"
      />

      {report && <>
        <div className="regime-meta-strip hk-meta-strip">
          <div><span>市场基调</span><strong className={statusClass(report.riskTone)}>{riskToneLabels[report.riskTone]}</strong></div>
          <div><span>仓位姿态</span><strong>{postureLabels[report.positionPosture]}</strong></div>
          <div><span>主连快照</span><strong>{report.source.futuresQuoteCount} / 16</strong></div>
          <div><span>历史序列</span><strong>{report.source.futuresHistoryCount}</strong></div>
          <div><span>数据时间</span><strong>{report.source.fetchedAt ? new Date(report.source.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></div>
        </div>

        <div className="futures-section-heading">
          <div><span className="section-kicker">未来 5 个交易日 · 历史条件频率</span><h3>方向研判</h3></div>
          <small>经验频率，不是校准后的获利概率</small>
        </div>
        {forecastItems.length > 0
          ? <div className="futures-forecast-board">{forecastItems.map((item) => <FuturesForecastRow item={item} key={item.symbol} />)}</div>
          : <div className="research-empty">当前主连历史均未达到 20 个相似条件样本，不输出方向频率。</div>}

        <div className="futures-strategy-context">
          <div><span>优先研究策略族</span><strong>{familyList(report.preferredStrategyFamilies)}</strong><small>{report.preferredStrategyKeys.join(" / ") || "信号不足时不启用新增仓位策略"}</small></div>
          <div><span>降权策略族</span><strong>{familyList(report.deweightedStrategyFamilies)}</strong><small>{report.evidence[0]}</small></div>
        </div>
        <div className="research-alert regime-source-ok"><ShieldCheck size={16} /><span>{report.guardrails[1]}</span></div>
        {report.warnings.length > 0 && <div className="research-alert regime-warning"><AlertTriangle size={16} /><span>数据质量：{report.warnings.slice(0, 3).join("；")}{report.warnings.length > 3 ? `；另 ${report.warnings.length - 3} 项` : ""}</span></div>}

        <div className="regime-table-wrap">
          {report.futures.length === 0 ? <div className="research-empty">当前没有取得可用期货主连行情。</div> : (
            <table className="data-table futures-table">
              <thead><tr><th>品种 / 主连</th><th>最新 / 涨跌</th><th>5 日研判</th><th>5 / 20 / 60 日</th><th>波动 / 回撤</th><th>成交 / 持仓</th><th>历史</th></tr></thead>
              <tbody>{report.futures.map((item) => <tr key={item.symbol}>
                <td className="symbol-cell"><strong>{item.name}</strong><span className="table-subline">{item.category} · {item.symbol}</span></td>
                <td className={item.changePercent >= 0 ? "positive" : "negative"}><strong>{item.price.toFixed(2)}</strong><span className="table-subline">{quotePercent(item.changePercent)}</span></td>
                <td><strong className={directionClass(item.forecast.direction)}>{directionLabels[item.forecast.direction]}</strong><span className="table-subline">样本 {item.forecast.sampleSize} · 中位 {signedPercent(item.forecast.medianForwardReturn)}</span></td>
                <td>{signedPercent(item.history.return5d)} / {signedPercent(item.history.return20d)}<span className="table-subline">60 日 {signedPercent(item.history.return60d)}</span></td>
                <td>年化 {unsignedPercent(item.history.annualizedVolatility20d)}<span className="table-subline negative">高点回撤 {signedPercent(item.history.drawdownFrom60DayHigh)}</span></td>
                <td>{compactNumber(item.volume)}<span className="table-subline">持仓 {compactNumber(item.openInterest)}</span></td>
                <td>{item.history.barCount} 根<span className="table-subline">{item.history.latestDate ?? "—"}</span></td>
              </tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="research-source-row"><Activity size={15} /><span>{report.source.globalSource} + {report.source.futuresQuoteSource} + {report.source.futuresHistorySource} · 主连连续 · 只读研究 · 不读取期货账户</span></div>
      </>}
    </section>
  );
}
