import { Waves } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { sectorFlows } from "../data/mockData";

export function FlowPanel() {
  return (
    <section className="panel flow-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">主力净流入</span>
          <h2>板块资金</h2>
        </div>
        <Waves size={20} />
      </div>
      <div className="flow-chart">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={sectorFlows} layout="vertical" margin={{ left: 4, right: 18 }}>
            <XAxis axisLine={false} hide type="number" />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: "#5d6472", fontSize: 12 }}
              tickLine={false}
              type="category"
              width={68}
            />
            <Tooltip
              contentStyle={{ border: "1px solid #dfe3ea", borderRadius: 6 }}
              formatter={(value: number) => [`${value.toFixed(1)} 亿元`, "净流入"]}
            />
            <Bar dataKey="flow" radius={[0, 3, 3, 0]}>
              {sectorFlows.map((entry) => (
                <Cell fill={entry.flow >= 0 ? "#0f766e" : "#dc4c4c"} key={entry.name} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flow-list">
        {sectorFlows.slice(0, 4).map((sector) => (
          <div key={sector.name}>
            <span>{sector.name}</span>
            <strong className={sector.change >= 0 ? "positive" : "negative"}>
              {sector.change >= 0 ? "+" : ""}
              {sector.change.toFixed(2)}%
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
