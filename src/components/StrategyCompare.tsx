import { useState, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, TrendingUp, Target, ShieldAlert } from "lucide-react";
import type { BacktestResult, StrategyDefinition } from "../types";

interface StrategyCompareProps {
  results: { strategy: StrategyDefinition; result: BacktestResult }[];
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}

const COMPARE_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706",
  "#7c3aed", "#0891b2", "#db2777", "#65a30d",
];

interface MergedCurvePoint {
  date: string;
  [strategyName: string]: string | number;
}

export function StrategyCompare({ results }: StrategyCompareProps) {
  const [selectedMetric, setSelectedMetric] = useState<"totalReturn" | "sharpe" | "maxDrawdown" | "winRate">("totalReturn");

  if (results.length < 2) {
    return (
      <section className="panel compare-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">策略对比</span>
            <h2>多策略对决</h2>
          </div>
          <BarChart3 size={20} />
        </div>
        <div className="empty-copy" style={{ padding: "2rem 0", textAlign: "center", color: "#8b94a1" }}>
          需要至少2个策略结果才能进行对比
        </div>
      </section>
    );
  }

  // Merge equity curves by date
  const mergedCurve: MergedCurvePoint[] = useMemo(() => {
    const dateMap = new Map<string, MergedCurvePoint>();

    results.forEach(({ strategy, result }) => {
      result.equityCurve.forEach((point) => {
        if (!dateMap.has(point.date)) {
          dateMap.set(point.date, { date: point.date });
        }
        const entry = dateMap.get(point.date)!;
        entry[strategy.shortName] = point.portfolio;
      });
    });

    return Array.from(dateMap.values()).sort((a, b) => {
      const [ma, da] = a.date.split("/").map(Number);
      const [mb, db] = b.date.split("/").map(Number);
      return ma !== mb ? ma - mb : da - db;
    });
  }, [results]);

  // Metrics comparison
  const metricRanking = useMemo(() => {
    const sorted = [...results].sort((a, b) => {
      switch (selectedMetric) {
        case "totalReturn":
          return b.result.metrics.totalReturn - a.result.metrics.totalReturn;
        case "sharpe":
          return b.result.metrics.sharpe - a.result.metrics.sharpe;
        case "maxDrawdown":
          return a.result.metrics.maxDrawdown - b.result.metrics.maxDrawdown;
        case "winRate":
          return b.result.metrics.winRate - a.result.metrics.winRate;
      }
    });
    return sorted;
  }, [results, selectedMetric]);

  const metricConfigs = [
    { key: "totalReturn" as const, label: "累计收益", icon: TrendingUp, better: "higher" },
    { key: "sharpe" as const, label: "夏普比率", icon: Target, better: "higher" },
    { key: "maxDrawdown" as const, label: "最大回撤", icon: ShieldAlert, better: "lower" },
    { key: "winRate" as const, label: "胜率", icon: BarChart3, better: "higher" },
  ];

  const formatMetricValue = (key: string, value: number): string => {
    switch (key) {
      case "totalReturn":
      case "maxDrawdown":
        return formatPercent(value);
      case "sharpe":
        return value.toFixed(2);
      case "winRate":
        return formatPercent(value);
      default:
        return String(value);
    }
  };

  return (
    <section className="panel compare-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">策略对比</span>
          <h2>多策略对决</h2>
        </div>
        <BarChart3 size={20} />
      </div>

      {/* Ranking Podium */}
      <div className="compare-podium">
        {metricRanking.slice(0, 3).map((entry, index) => (
          <div
            className={`podium-card podium-${index + 1}`}
            key={entry.strategy.id}
            style={{ "--strategy-color": entry.strategy.color } as React.CSSProperties}
          >
            <div className="podium-rank">{index + 1}</div>
            <div className="podium-info">
              <strong>{entry.strategy.name}</strong>
              <span className={index === 0 ? "positive" : ""}>
                {formatMetricValue(selectedMetric, entry.result.metrics[selectedMetric])}
              </span>
              <small>{entry.strategy.tag}</small>
            </div>
          </div>
        ))}
      </div>

      {/* Metric Tabs */}
      <div className="compare-metric-tabs">
        {metricConfigs.map(({ key, label, icon: Icon }) => (
          <button
            className={selectedMetric === key ? "compare-tab active" : "compare-tab"}
            key={key}
            onClick={() => setSelectedMetric(key)}
            type="button"
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Full Ranking Table */}
      <div className="compare-ranking-table-wrapper">
        <table className="data-table compare-ranking-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>策略</th>
              <th>标签</th>
              <th>{metricConfigs.find((m) => m.key === selectedMetric)?.label}</th>
              <th>年化收益</th>
              <th>夏普</th>
              <th>最大回撤</th>
              <th>交易笔数</th>
            </tr>
          </thead>
          <tbody>
            {metricRanking.map((entry, index) => (
              <tr className={index === 0 ? "rank-first" : index < 3 ? "rank-podium" : ""} key={entry.strategy.id}>
                <td>
                  <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
                </td>
                <td className="symbol-cell">
                  <strong>{entry.strategy.name}</strong>
                </td>
                <td>
                  <span className="strategy-tag">{entry.strategy.tag}</span>
                </td>
                <td className={index === 0 ? "positive" : ""}>
                  <strong>{formatMetricValue(selectedMetric, entry.result.metrics[selectedMetric])}</strong>
                </td>
                <td>{formatPercent(entry.result.metrics.annualizedReturn)}</td>
                <td>{entry.result.metrics.sharpe.toFixed(2)}</td>
                <td className="negative">-{(entry.result.metrics.maxDrawdown * 100).toFixed(2)}%</td>
                <td>{entry.result.metrics.tradeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Equity Curves Overlay */}
      <div className="compare-chart-section">
        <div className="table-heading">
          <h3>权益曲线对比</h3>
          <span>基于固定种子模拟数据</span>
        </div>
        <div className="compare-equity-chart">
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={mergedCurve} margin={{ left: 2, right: 12, top: 12 }}>
              <CartesianGrid stroke="#e7e9ee" strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                minTickGap={32}
                tick={{ fill: "#7a8190", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={["dataMin - 20000", "dataMax + 20000"]}
                tick={{ fill: "#7a8190", fontSize: 11 }}
                tickFormatter={(value: number) => `${(value / 10000).toFixed(0)}万`}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  border: "1px solid #dfe3ea",
                  borderRadius: 6,
                  boxShadow: "0 10px 30px rgba(28, 35, 49, 0.12)",
                }}
                formatter={(value: number, name: string) => [
                  `¥${formatCurrency(value)}`,
                  name,
                ]}
              />
              <Legend
                iconType="plainline"
                wrapperStyle={{ fontSize: 12 }}
              />
              {results.map(({ strategy }, index) => (
                <Area
                  key={strategy.id}
                  dataKey={strategy.shortName}
                  fill="transparent"
                  name={strategy.name}
                  stroke={COMPARE_COLORS[index % COMPARE_COLORS.length]}
                  strokeWidth={index === 0 ? 2.5 : 1.5}
                  type="monotone"
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
