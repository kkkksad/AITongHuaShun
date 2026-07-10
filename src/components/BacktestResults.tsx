import { ArrowDownRight, ArrowUpRight, Sigma } from "lucide-react";
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
import type { BacktestResult } from "../types";

interface BacktestResultsProps {
  result: BacktestResult;
  compact?: boolean;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function BacktestResults({ result, compact = false }: BacktestResultsProps) {
  const metrics = [
    {
      label: "累计收益",
      value: formatPercent(result.metrics.totalReturn),
      positive: result.metrics.totalReturn >= 0,
    },
    {
      label: "年化收益",
      value: formatPercent(result.metrics.annualizedReturn),
      positive: result.metrics.annualizedReturn >= 0,
    },
    {
      label: "最大回撤",
      value: `-${(result.metrics.maxDrawdown * 100).toFixed(2)}%`,
      positive: false,
    },
    {
      label: "夏普比率",
      value: result.metrics.sharpe.toFixed(2),
      positive: result.metrics.sharpe >= 1,
    },
  ];

  return (
    <section className="panel backtest-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">回测输出</span>
          <h2>策略净值表现</h2>
        </div>
        <div className="sample-badge">
          <Sigma size={15} />
          90 个交易日
        </div>
      </div>

      <div className="metrics-row">
        {metrics.map((metric) => (
          <div className="metric-cell" key={metric.label}>
            <span>{metric.label}</span>
            <strong className={metric.positive ? "positive" : "negative"}>
              {metric.value}
            </strong>
            {metric.positive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          </div>
        ))}
      </div>

      <div className={compact ? "equity-chart compact" : "equity-chart"}>
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={result.equityCurve} margin={{ left: 2, right: 12, top: 12 }}>
            <defs>
              <linearGradient id="portfolioFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
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
                name === "portfolio" ? "策略" : "沪深 300",
              ]}
            />
            <Legend
              formatter={(value) => (value === "portfolio" ? "策略净值" : "沪深 300")}
              iconType="plainline"
              wrapperStyle={{ fontSize: 12 }}
            />
            <Area
              dataKey="portfolio"
              fill="url(#portfolioFill)"
              name="portfolio"
              stroke="#2563eb"
              strokeWidth={2.25}
              type="monotone"
            />
            <Area
              dataKey="benchmark"
              fill="transparent"
              name="benchmark"
              stroke="#9aa1ae"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <div className="trade-table-wrap">
          <div className="table-heading">
            <h3>最近交易</h3>
            <span>{result.metrics.tradeCount} 笔模拟指令</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>标的</th>
                <th>方向</th>
                <th>数量</th>
                <th>价格</th>
                <th>已实现盈亏</th>
              </tr>
            </thead>
            <tbody>
              {result.trades
                .slice(-5)
                .reverse()
                .map((trade) => (
                  <tr key={trade.id}>
                    <td>{trade.date}</td>
                    <td className="symbol-cell">{trade.symbol}</td>
                    <td>
                      <span className={trade.side === "买入" ? "side buy" : "side sell"}>
                        {trade.side}
                      </span>
                    </td>
                    <td>{trade.quantity.toLocaleString("zh-CN")}</td>
                    <td>¥{trade.price.toFixed(2)}</td>
                    <td className={trade.pnl > 0 ? "positive" : trade.pnl < 0 ? "negative" : ""}>
                      {trade.pnl === 0 ? "—" : `¥${formatCurrency(trade.pnl)}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
