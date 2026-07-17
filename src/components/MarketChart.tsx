import { BarChart3 } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import { intradayData } from "../data/mockData";

interface MarketChartProps {
  market?: MarketSnapshot;
}

function findPrimaryIndex(market?: MarketSnapshot): MarketQuote | undefined {
  return market?.quotes.find((quote) => quote.symbol === "SH000001")
    ?? market?.quotes.find((quote) => !quote.tradable && quote.price > 0);
}

export function buildIndexSnapshotData(index?: MarketQuote) {
  if (!index) {
    return intradayData;
  }

  const points = [
    { time: "昨收", price: index.previousClose, average: index.previousClose, volume: 0 },
    { time: "今开", price: index.open ?? index.previousClose, average: index.previousClose, volume: 0 },
    { time: "最低", price: index.low ?? index.price, average: index.previousClose, volume: 0 },
    { time: "最新", price: index.price, average: index.previousClose, volume: index.amount ? index.amount / 100_000_000 : 0 },
    { time: "最高", price: index.high ?? index.price, average: index.previousClose, volume: 0 },
  ];

  return points.filter((point) => Number.isFinite(point.price) && point.price > 0);
}

export function buildPriceDomain(data: Array<{ price: number; average: number }>): [number, number] {
  const values = data.flatMap((point) => [point.price, point.average]).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return [3480, 3545];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.15, max * 0.003);
  return [Number((min - padding).toFixed(2)), Number((max + padding).toFixed(2))];
}

function formatAsOf(value?: string): string {
  if (!value) {
    return "静态演示";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function MarketChart({ market }: MarketChartProps) {
  const primaryIndex = findPrimaryIndex(market);
  const chartData = buildIndexSnapshotData(primaryIndex);
  const priceDomain = buildPriceDomain(chartData);
  const title = primaryIndex ? `${primaryIndex.name} 日内快照` : "分时走势与成交量";
  const kicker = primaryIndex ? primaryIndex.symbol : "静态演示";
  const asOf = formatAsOf(primaryIndex?.updatedAt ?? market?.marketTime);

  return (
    <section className="panel market-chart-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">{kicker} · {asOf}</span>
          <h2>{title}</h2>
        </div>
        <BarChart3 size={20} />
      </div>
      <div className="market-chart">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 12 }}>
            <CartesianGrid stroke="#e7e9ee" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="time"
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={priceDomain}
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
              width={42}
              yAxisId="price"
            />
            <YAxis hide domain={[0, 120]} orientation="right" yAxisId="volume" />
            <Tooltip
              contentStyle={{ border: "1px solid #dfe3ea", borderRadius: 6 }}
              formatter={(value: number, name: string) => [
                name === "volume" ? `${value.toFixed(2)} 亿元` : value.toFixed(2),
                name === "price" ? "点位" : name === "average" ? "昨收" : "成交额",
              ]}
            />
            <Bar dataKey="volume" fill="#dce6f5" maxBarSize={22} yAxisId="volume" />
            <Line
              dataKey="average"
              dot={false}
              stroke="#d97706"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              type="monotone"
              yAxisId="price"
            />
            <Line
              dataKey="price"
              dot={false}
              stroke="#2563eb"
              strokeWidth={2.25}
              type="monotone"
              yAxisId="price"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
