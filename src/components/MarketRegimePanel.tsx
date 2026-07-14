import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import {
  fetchMarketRegimeResearch,
  type SectorOutlookDirection,
  type StockRegime,
} from "../lib/tradingApi";

type RegimeView = "sectors" | "stocks";

const directionLabels: Record<SectorOutlookDirection, string> = {
  constructive: "偏强观察",
  neutral: "中性",
  cautious: "谨慎",
};

const regimeLabels: Record<StockRegime, string> = {
  "washout-candidate": "缩量洗盘候选",
  "trend-deterioration": "趋势恶化",
  "healthy-trend": "健康趋势",
  unclear: "信号不清",
  "insufficient-data": "数据不足",
};

function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "样本不足";
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function flowAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未取得";
  const absolute = Math.abs(value);
  const formatted =
    absolute >= 100_000_000
      ? `${(absolute / 100_000_000).toFixed(1)} 亿`
      : `${(absolute / 10_000).toFixed(0)} 万`;
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function directionClass(direction: SectorOutlookDirection): string {
  if (direction === "constructive") return "gate-pass";
  if (direction === "cautious") return "gate-blocked";
  return "gate-caution";
}

function regimeClass(regime: StockRegime): string {
  if (regime === "washout-candidate" || regime === "healthy-trend") return "gate-pass";
  if (regime === "trend-deterioration") return "gate-blocked";
  return "gate-caution";
}

export function MarketRegimePanel() {
  const [view, setView] = useState<RegimeView>("sectors");
  const regimeQuery = useQuery({
    queryKey: ["market-regime", 10, 8, 180],
    queryFn: () => fetchMarketRegimeResearch(10, 8, 180),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = regimeQuery.data;

  return (
    <section className="panel market-regime-panel">
      <div className="panel-header market-regime-header">
        <div>
          <span className="section-kicker">真实历史研究</span>
          <h2>板块展望与走势识别</h2>
        </div>
        <button
          aria-label="刷新板块与走势研究"
          className="icon-button"
          disabled={regimeQuery.isFetching}
          onClick={() => void regimeQuery.refetch()}
          title="刷新"
          type="button"
        >
          <RefreshCw className={regimeQuery.isFetching ? "spin" : ""} size={17} />
        </button>
      </div>

      <div className="regime-tabs" role="tablist" aria-label="研究视图">
        <button
          aria-selected={view === "sectors"}
          className={view === "sectors" ? "active" : ""}
          onClick={() => setView("sectors")}
          role="tab"
          type="button"
        >
          <BarChart3 size={15} />
          板块展望
        </button>
        <button
          aria-selected={view === "stocks"}
          className={view === "stocks" ? "active" : ""}
          onClick={() => setView("stocks")}
          role="tab"
          type="button"
        >
          <ScanSearch size={15} />
          形态识别
        </button>
      </div>

      {regimeQuery.isLoading && (
        <div className="research-empty">正在读取行业板块与 180 日历史行情…</div>
      )}

      {regimeQuery.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>真实历史研究暂不可用，请检查 API 与 AkShare 行情桥接。</span>
        </div>
      )}

      {report && (
        <>
          <div className="regime-meta-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "降级"}</strong>
            </div>
            <div>
              <span>历史窗口</span>
              <strong>{report.source.days} 日</strong>
            </div>
            <div>
              <span>板块样本</span>
              <strong>{report.source.sectorCount}</strong>
            </div>
            <div>
              <span>个股样本</span>
              <strong>{report.source.stockCount}</strong>
            </div>
            <div>
              <span>复权</span>
              <strong>个股前复权</strong>
            </div>
          </div>

          {report.warnings.length > 0 && (
            <div className="research-alert regime-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings[0]}</span>
            </div>
          )}

          {report.sourceStatus === "live-read-only" && (
            <div className="research-alert regime-source-ok">
              <ShieldCheck size={16} />
              <span>{report.methodology.probabilityMeaning}</span>
            </div>
          )}

          {view === "sectors" && (
            <div className="regime-table-wrap" role="tabpanel">
              {report.sectorOutlooks.length === 0 ? (
                <div className="research-empty">当前没有满足 61 根日线要求的板块样本。</div>
              ) : (
                <table className="data-table regime-table">
                  <thead>
                    <tr>
                      <th>板块</th>
                      <th>研判</th>
                      <th>3 日评分</th>
                      <th>5 日评分</th>
                      <th>20 日趋势</th>
                      <th>5 日验证</th>
                      <th>主力净流入</th>
                      <th>依据 / 风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sectorOutlooks.map((sector) => (
                      <tr key={sector.symbol}>
                        <td className="symbol-cell">
                          <strong>{sector.name}</strong>
                          <span className="table-subline">
                            {sector.barCount} 根 · {sector.latestDate}
                          </span>
                        </td>
                        <td>
                          <span className={`rank-badge ${directionClass(sector.direction)}`}>
                            {directionLabels[sector.direction]}
                          </span>
                        </td>
                        <td><strong>{sector.growthProbability3d.toFixed(0)}</strong> / 100</td>
                        <td><strong>{sector.growthProbability5d.toFixed(0)}</strong> / 100</td>
                        <td className={sector.factors.return20d >= 0 ? "positive" : "negative"}>
                          {signedPercent(sector.factors.return20d)}
                          <span className="table-subline">
                            60 日 {signedPercent(sector.factors.return60d)}
                          </span>
                        </td>
                        <td>
                          {percent(sector.validation.horizon5.directionalHitRate)}
                          <span className="table-subline">
                            {sector.validation.horizon5.samples} 个滚动样本
                          </span>
                        </td>
                        <td className={(sector.current.mainNetInflow ?? 0) >= 0 ? "positive" : "negative"}>
                          {flowAmount(sector.current.mainNetInflow)}
                        </td>
                        <td className="regime-reason-cell">
                          {sector.evidence[0]}
                          {sector.riskFlags[0] && (
                            <span className="table-subline negative">{sector.riskFlags[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {view === "stocks" && (
            <div className="regime-table-wrap" role="tabpanel">
              {report.stockRegimes.length === 0 ? (
                <div className="research-empty">当前没有取得候选股票历史日线。</div>
              ) : (
                <table className="data-table regime-table">
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>形态</th>
                      <th>置信度</th>
                      <th>20 日趋势</th>
                      <th>距 60 日线</th>
                      <th>量比</th>
                      <th>历史验证</th>
                      <th>依据 / 反证</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.stockRegimes.map((stock) => (
                      <tr key={stock.symbol}>
                        <td className="symbol-cell">
                          <strong>{stock.name}</strong>
                          <span className="table-subline">
                            {stock.symbol} · {stock.barCount} 根
                          </span>
                        </td>
                        <td>
                          <span className={`rank-badge ${regimeClass(stock.regime)}`}>
                            {regimeLabels[stock.regime]}
                          </span>
                        </td>
                        <td>{percent(stock.confidence)}</td>
                        <td className={stock.features.return20d >= 0 ? "positive" : "negative"}>
                          {signedPercent(stock.features.return20d)}
                        </td>
                        <td className={stock.features.distanceFromMa60 >= 0 ? "positive" : "negative"}>
                          {signedPercent(stock.features.distanceFromMa60)}
                        </td>
                        <td>{stock.features.volumeRatio.toFixed(2)}</td>
                        <td>
                          {percent(stock.validation.hitRate5d)}
                          <span className="table-subline">
                            {stock.validation.samples} 个同类样本
                          </span>
                        </td>
                        <td className="regime-reason-cell">
                          {stock.evidence[0] ?? stock.riskFlags[0]}
                          {stock.riskFlags[0] && stock.evidence[0] && (
                            <span className="table-subline negative">{stock.riskFlags[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="research-source-row">
            <ShieldCheck size={15} />
            <span>
              {report.source.sectorHistorySource} · 更新 {report.source.fetchedAt
                ? new Date(report.source.fetchedAt).toLocaleString("zh-CN")
                : "未知"} · 仅用于研究与本地 paper
            </span>
          </div>
        </>
      )}
    </section>
  );
}
