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
import { intradayData } from "../data/mockData";

export function MarketChart() {
  return (
    <section className="panel market-chart-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">上证指数</span>
          <h2>分时走势与成交量</h2>
        </div>
        <BarChart3 size={20} />
      </div>
      <div className="market-chart">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={intradayData} margin={{ left: 0, right: 8, top: 12 }}>
            <CartesianGrid stroke="#e7e9ee" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="time"
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={[3480, 3545]}
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
              width={42}
              yAxisId="price"
            />
            <YAxis hide domain={[0, 120]} orientation="right" yAxisId="volume" />
            <Tooltip
              contentStyle={{ border: "1px solid #dfe3ea", borderRadius: 6 }}
              formatter={(value: number, name: string) => [
                name === "volume" ? `${value} 亿` : value.toFixed(2),
                name === "price" ? "指数" : name === "average" ? "均价" : "成交量",
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
