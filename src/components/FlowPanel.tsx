import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Waves } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchMarketRegimeResearch } from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

export function FlowPanel() {
  const regimeQuery = useQuery({
    queryKey: ["market-regime", 10, 8, 180],
    queryFn: ({ signal }) => fetchMarketRegimeResearch(10, 8, 180, signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const sectors = regimeQuery.data?.sectorOutlooks.slice(0, 6) ?? [];
  const chartData = sectors.map((sector) => ({
    name: sector.name,
    score: sector.growthProbability5d,
    direction: sector.direction,
  }));

  return (
    <section className="panel flow-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">真实历史评分</span>
          <h2>板块 5 日展望</h2>
        </div>
        <button
          aria-label="刷新板块展望"
          className="icon-button"
          disabled={regimeQuery.isFetching}
          onClick={() => void regimeQuery.refetch()}
          title="刷新"
          type="button"
        >
          {regimeQuery.isFetching ? <RefreshCw className="spin" size={17} /> : <Waves size={18} />}
        </button>
      </div>

      <ResearchQueryState
        dataUpdatedAt={regimeQuery.dataUpdatedAt}
        hasData={Boolean(regimeQuery.data)}
        isError={regimeQuery.isError}
        isLoading={regimeQuery.isLoading}
        loadingText="读取真实板块历史…"
        unavailableText="板块历史研究暂不可用。"
      />
      {regimeQuery.data && sectors.length === 0 && (
        <div className="research-empty">
          {regimeQuery.data.warnings[0] ?? "没有满足历史样本要求的板块。"}
        </div>
      )}
      {sectors.length > 0 && (
        <>
          <div className="flow-chart">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 18 }}>
                <XAxis domain={[0, 100]} axisLine={false} hide type="number" />
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
                  formatter={(value: number) => [`${value.toFixed(0)} / 100`, "5 日研究评分"]}
                />
                <Bar dataKey="score" radius={[0, 3, 3, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      fill={entry.direction === "constructive" ? "#0f766e" : entry.direction === "cautious" ? "#dc4c4c" : "#d97706"}
                      key={entry.name}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flow-list">
            {sectors.slice(0, 4).map((sector) => (
              <div key={sector.symbol}>
                <span>{sector.name}</span>
                <strong className={sector.current.changePercent >= 0 ? "positive" : "negative"}>
                  {sector.current.changePercent >= 0 ? "+" : ""}
                  {sector.current.changePercent.toFixed(2)}%
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
