import { useMemo, useState } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CircleDollarSign, PieChartIcon, TrendingUp, Zap } from "lucide-react";
import type { PositionSnapshot, MarketSnapshot } from "../../shared/trading";

const COLORS = [
  "#2563eb", "#0891b2", "#7c3aed", "#db2777",
  "#ea580c", "#65a30d", "#ca8a04", "#e11d48",
  "#4f46e5", "#0d9488",
];

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

interface PortfolioProps {
  positions: PositionSnapshot[];
  market?: MarketSnapshot;
  equity?: number;
}

export function Portfolio({ positions, market, equity }: PortfolioProps) {
  const [sortBy, setSortBy] = useState<"weight" | "pnl" | "value">("weight");

  const sorted = useMemo(() => {
    const copy = [...positions];
    switch (sortBy) {
      case "pnl":
        copy.sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
        break;
      case "value":
        copy.sort((a, b) => b.marketValue - a.marketValue);
        break;
      default:
        copy.sort((a, b) => b.weight - a.weight);
    }
    return copy;
  }, [positions, sortBy]);

  const pieData = useMemo(() => {
    const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    // Show top 7 positions, rest grouped as "其他"
    const sortedByValue = [...positions].sort((a, b) => b.marketValue - a.marketValue);
    const top = sortedByValue.slice(0, 7);
    const rest = sortedByValue.slice(7);
    const restValue = rest.reduce((sum, p) => sum + p.marketValue, 0);

    const data = top.map((p) => ({
      name: p.symbol,
      label: p.name || p.symbol,
      value: p.marketValue,
      weight: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0,
    }));

    if (restValue > 0 && totalValue > 0) {
      data.push({
        name: "其他",
        label: `其他 (${rest.length} 个)`,
        value: restValue,
        weight: (restValue / totalValue) * 100,
      });
    }

    return data;
  }, [positions]);

  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const pnlPercent = totalValue - totalPnl > 0
    ? (totalPnl / (totalValue - totalPnl)) * 100
    : 0;

  const winCount = positions.filter((p) => p.unrealizedPnl > 0).length;
  const lossCount = positions.filter((p) => p.unrealizedPnl < 0).length;

  const concentration = useMemo(() => {
    if (positions.length === 0) return 0;
    const weights = positions.map((p) => p.weight);
    // Herfindahl-Hirschman Index (scaled 0-1)
    return weights.reduce((sum, w) => sum + w * w, 0);
  }, [positions]);

  return (
    <div className="portfolio-panel">
      {/* Summary Row */}
      <div className="portfolio-summary">
        <div className="summary-card">
          <CircleDollarSign size={20} />
          <div>
            <span>持仓总市值</span>
            <strong>{money(totalValue)}</strong>
          </div>
        </div>
        <div className="summary-card">
          <TrendingUp size={20} />
          <div>
            <span>浮动盈亏</span>
            <strong className={totalPnl >= 0 ? "positive" : "negative"}>
              {money(totalPnl)} ({totalPnl >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%)
            </strong>
          </div>
        </div>
        <div className="summary-card">
          <PieChartIcon size={20} />
          <div>
            <span>持仓数量</span>
            <strong>
              {positions.length} 个标的
              <small style={{ marginLeft: 8, fontWeight: 400 }}>
                (赢 {winCount} / 亏 {lossCount})
              </small>
            </strong>
          </div>
        </div>
        <div className="summary-card">
          <Zap size={20} />
          <div>
            <span>集中度 (HHI)</span>
            <strong className={concentration > 0.25 ? "negative" : "positive"}>
              {(concentration * 100).toFixed(1)}%
            </strong>
          </div>
        </div>
      </div>

      {/* Charts + Positions */}
      <div className="portfolio-columns">
        {/* Asset Allocation Pie */}
        <div className="portfolio-chart-section">
          <div className="table-heading">
            <h3>资产配置</h3>
            <span>按市值占比</span>
          </div>
          {pieData.length > 0 ? (
            <div className="portfolio-pie-wrap">
              <ResponsiveContainer height={280} width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={pieData}
                    dataKey="value"
                    innerRadius={55}
                    label={({ name, weight }) =>
                      weight > 5 ? `${name} ${weight.toFixed(1)}%` : ""
                    }
                    labelLine={false}
                    nameKey="label"
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {pieData.map((_, index) => (
                      <Cell
                        fill={COLORS[index % COLORS.length]}
                        key={`cell-${index}`}
                        stroke="#fff"
                        strokeWidth={1}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #dfe3ea",
                      borderRadius: 6,
                      boxShadow: "0 10px 30px rgba(28, 35, 49, 0.12)",
                    }}
                    formatter={(value: number) => [money(value), "市值"]}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span style={{ fontSize: 11, color: "#5a6270" }}>{value}</span>
                    )}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-copy" style={{ padding: "3rem 0", textAlign: "center" }}>
              暂无持仓数据
            </div>
          )}
        </div>

        {/* Position Detail Table */}
        <div className="portfolio-table-section">
          <div className="table-heading">
            <h3>持仓明细</h3>
            <div className="sort-tabs">
              <button
                className={sortBy === "weight" ? "sort-tab active" : "sort-tab"}
                onClick={() => setSortBy("weight")}
                type="button"
              >
                权重
              </button>
              <button
                className={sortBy === "pnl" ? "sort-tab active" : "sort-tab"}
                onClick={() => setSortBy("pnl")}
                type="button"
              >
                盈亏
              </button>
              <button
                className={sortBy === "value" ? "sort-tab active" : "sort-tab"}
                onClick={() => setSortBy("value")}
                type="button"
              >
                市值
              </button>
            </div>
          </div>

          <div className="table-scroll" style={{ maxHeight: "38vh" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>持仓数量</th>
                  <th>成本价</th>
                  <th>现价</th>
                  <th>市值</th>
                  <th>浮动盈亏</th>
                  <th>盈亏%</th>
                  <th>权重</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td className="empty-row" colSpan={8}>
                      暂无持仓
                    </td>
                  </tr>
                )}
                {sorted.map((pos) => {
                  const costBasis = pos.averagePrice * pos.quantity;
                  const pnlPct = costBasis > 0
                    ? (pos.unrealizedPnl / costBasis) * 100
                    : 0;

                  return (
                    <tr key={pos.symbol}>
                      <td className="symbol-cell">
                        <strong>{pos.name}</strong>
                        <small className="table-subline">{pos.symbol}</small>
                      </td>
                      <td>{pos.quantity.toLocaleString("zh-CN")}</td>
                      <td>¥{pos.averagePrice.toFixed(2)}</td>
                      <td>¥{pos.currentPrice.toFixed(2)}</td>
                      <td>{money(pos.marketValue)}</td>
                      <td className={pos.unrealizedPnl >= 0 ? "positive" : "negative"}>
                        {money(pos.unrealizedPnl)}
                      </td>
                      <td
                        className={pnlPct >= 0 ? "positive" : "negative"}
                      >
                        {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                      </td>
                      <td>
                        <div className="weight-bar-cell">
                          <div
                            className="weight-bar-fill"
                            style={{ width: `${Math.min(pos.weight * 100, 100)}%` }}
                          />
                          <span>{(pos.weight * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
