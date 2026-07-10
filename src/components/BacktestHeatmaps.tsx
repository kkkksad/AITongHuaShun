import { useMemo } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import type { BacktestResult, StrategyParameters } from "../types";
import { runBacktest } from "../lib/backtest";
import { strategies } from "../data/mockData";

// ── Utility: compute running drawdown series ──────────────────

export interface DrawdownPoint {
  date: string;
  drawdown: number; // 0 to 1, where 0 = no drawdown, 0.25 = 25% drawdown
  portfolio: number;
  peak: number;
}

export function computeDrawdownSeries(
  equity: Array<{ date: string; portfolio: number }>,
): DrawdownPoint[] {
  let peak = equity[0]?.portfolio ?? 0;
  return equity.map((point) => {
    peak = Math.max(peak, point.portfolio);
    const drawdown = peak > 0 ? (peak - point.portfolio) / peak : 0;
    return { date: point.date, drawdown, portfolio: point.portfolio, peak };
  });
}

// ── Color scale for drawdown heatmap cells ──────────────────

function drawdownColor(dd: number): { bg: string; text: string } {
  if (dd <= 0) return { bg: "#16a36a", text: "#ffffff" }; // at peak (green)
  if (dd < 0.02) return { bg: "#bae6d5", text: "#14523a" };
  if (dd < 0.04) return { bg: "#fef3c7", text: "#8a6106" };
  if (dd < 0.07) return { bg: "#fed7aa", text: "#8c3306" };
  if (dd < 0.10) return { bg: "#fca5a5", text: "#7f1d1d" };
  return { bg: "#dc2626", text: "#ffffff" }; // deep drawdown (red)
}

// ── Drawdown Heatmap Component ──────────────────────────────

interface DrawdownHeatmapProps {
  result: BacktestResult;
}

export function DrawdownHeatmap({ result }: DrawdownHeatmapProps) {
  const series = useMemo(
    () => computeDrawdownSeries(result.equityCurve),
    [result.equityCurve],
  );

  // Split into rows of ~18 days for readability
  const ROW_SIZE = 18;
  const rows: DrawdownPoint[][] = [];
  for (let i = 0; i < series.length; i += ROW_SIZE) {
    rows.push(series.slice(i, i + ROW_SIZE));
  }

  const maxDD = result.metrics.maxDrawdown;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">回撤分析</span>
          <h2>每日回撤热力图</h2>
        </div>
        <span className="as-of">
          最大回撤:{" "}
          <strong className="negative">-{(maxDD * 100).toFixed(2)}%</strong>
        </span>
      </div>

      <div className="drawdown-heatmap-grid">
        {rows.map((row, rowIdx) => (
          <div className="drawdown-heatmap-row" key={rowIdx}>
            {row.map((cell) => {
              const colors = drawdownColor(cell.drawdown);
              return (
                <div
                  className="drawdown-cell"
                  key={cell.date}
                  style={{ backgroundColor: colors.bg, color: colors.text }}
                  title={`${cell.date}: ${(cell.drawdown * 100).toFixed(1)}% 回撤`}
                >
                  <span className="drawdown-cell-label">{cell.date}</span>
                  <span className="drawdown-cell-value">
                    {cell.drawdown <= 0
                      ? "峰值"
                      : `-${(cell.drawdown * 100).toFixed(1)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="drawdown-legend">
        <span>峰值</span>
        <span className="legend-swatch" style={{ background: "#16a36a" }} />
        <span className="legend-swatch" style={{ background: "#bae6d5" }} />
        <span className="legend-swatch" style={{ background: "#fef3c7" }} />
        <span className="legend-swatch" style={{ background: "#fed7aa" }} />
        <span className="legend-swatch" style={{ background: "#fca5a5" }} />
        <span className="legend-swatch" style={{ background: "#dc2626" }} />
        <span>深跌 &gt;10%</span>
      </div>
    </section>
  );
}

// ── Parameter Heatmap ──────────────────────────────────────

type MetricKey = "sharpe" | "totalReturn" | "maxDrawdown" | "winRate";

interface ParameterHeatmapProps {
  baseParams: StrategyParameters;
  strategyId: string;
  paramX: keyof StrategyParameters;
  paramY: keyof StrategyParameters;
  xValues: number[];
  yValues: number[];
  metric: MetricKey;
}

interface HeatmapCell {
  x: number;
  y: number;
  value: number;
  label: string;
}

function heatmapColor(value: number, metric: MetricKey): string {
  // Normalize to 0-1 for color intensity
  // For sharpe (higher better): 0-3 range
  // For totalReturn (higher better): -0.2 to 0.4
  // For maxDrawdown (lower better): 0 to 0.3
  // For winRate (higher better): 0 to 1
  let intensity: number;
  if (metric === "maxDrawdown") {
    intensity = 1 - Math.min(value / 0.3, 1);
  } else if (metric === "sharpe") {
    intensity = Math.min(Math.max(value / 3, 0), 1);
  } else if (metric === "totalReturn") {
    intensity = Math.min(Math.max((value + 0.1) / 0.4, 0), 1);
  } else {
    intensity = Math.min(Math.max(value, 0), 1);
  }
  // Blue gradient: light to dark blue
  const r = Math.round(37 + (1 - intensity) * 200);
  const g = Math.round(99 + (1 - intensity) * 130);
  const b = Math.round(235 - (1 - intensity) * 120);
  return `rgb(${r},${g},${b})`;
}

export function ParameterHeatmap({
  baseParams,
  strategyId,
  paramX,
  paramY,
  xValues,
  yValues,
  metric,
}: ParameterHeatmapProps) {
  const cells: HeatmapCell[] = useMemo(() => {
    const result: HeatmapCell[] = [];
    for (const y of yValues) {
      for (const x of xValues) {
        const params = { ...baseParams, [paramX]: x, [paramY]: y };
        const bt = runBacktest(strategyId as any, params);
        const value = bt.metrics[metric];
        result.push({ x, y, value, label: formatMetric(value, metric) });
      }
    }
    return result;
  }, [baseParams, strategyId, paramX, paramY, xValues, yValues, metric]);

  // Compute global min/max for color scaling
  const values = cells.map((c) => c.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const metricLabels: Record<MetricKey, string> = {
    sharpe: "夏普比率",
    totalReturn: "累计收益",
    maxDrawdown: "最大回撤",
    winRate: "胜率",
  };

  const paramLabels: Record<keyof StrategyParameters, string> = {
    lookback: "回看周期",
    entryThreshold: "入场阈值",
    stopLoss: "止损%",
    takeProfit: "止盈%",
    maxPosition: "最大仓位%",
    rebalanceDays: "调仓天数",
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">参数优化</span>
          <h2>
            {paramLabels[paramX]} × {paramLabels[paramY]} — {metricLabels[metric]}
          </h2>
        </div>
      </div>

      <div className="param-heatmap-container">
        {/* Y-axis labels */}
        <div className="param-heatmap-y-axis">
          <div className="param-heatmap-corner" />
          {yValues.map((y) => (
            <div className="param-heatmap-y-label" key={y}>
              {y}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="param-heatmap-grid-wrap">
          {/* X-axis labels */}
          <div className="param-heatmap-x-labels">
            {xValues.map((x) => (
              <div className="param-heatmap-x-label" key={x}>
                {x}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div
            className="param-heatmap-grid"
            style={{
              gridTemplateColumns: `repeat(${xValues.length}, 1fr)`,
              gridTemplateRows: `repeat(${yValues.length}, 1fr)`,
            }}
          >
            {cells.map((cell) => {
              const intensity = (cell.value - minVal) / range;
              return (
                <div
                  className="param-heatmap-cell"
                  key={`${cell.x}-${cell.y}`}
                  style={{ backgroundColor: heatmapColor(cell.value, metric) }}
                  title={`${paramLabels[paramX]}=${cell.x}, ${paramLabels[paramY]}=${cell.y}: ${cell.label}`}
                >
                  <span className="param-heatmap-cell-text">{cell.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="param-heatmap-legend">
        <span>{formatMetric(minVal, metric)}</span>
        <div className="param-heatmap-gradient" />
        <span>{formatMetric(maxVal, metric)}</span>
      </div>
    </section>
  );
}

function formatMetric(value: number, metric: MetricKey): string {
  switch (metric) {
    case "sharpe":
      return value.toFixed(2);
    case "totalReturn":
      return `${(value * 100).toFixed(1)}%`;
    case "maxDrawdown":
      return `${(value * 100).toFixed(1)}%`;
    case "winRate":
      return `${(value * 100).toFixed(0)}%`;
  }
}
