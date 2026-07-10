import { Activity, ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { MarketSnapshot } from "../../shared/trading";
import { marketIndices } from "../data/mockData";
import type { ConnectionState } from "../hooks/useTradingBackend";

interface MarketOverviewProps {
  market?: MarketSnapshot;
  connectionState: ConnectionState;
}

function formatVolume(volume: number): string {
  return `${(volume / 100_000_000).toFixed(2)} 亿`;
}

export function MarketOverview({ market, connectionState }: MarketOverviewProps) {
  const indices = market
    ? market.quotes
        .filter((quote) => !quote.tradable)
        .map((quote) => ({
          symbol: quote.symbol,
          name: quote.name,
          value: quote.price,
          change: quote.changePercent,
          turnover: formatVolume(quote.volume),
        }))
    : marketIndices;
  const asOf = market
    ? new Date(market.marketTime).toLocaleString("zh-CN", { hour12: false })
    : "静态演示快照";

  return (
    <section className="market-overview">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">收盘快照</span>
          <h2>主要指数</h2>
        </div>
        <div className="as-of">
          <Activity size={15} />
          {connectionState === "connected" ? asOf : "后端离线 · 静态演示"}
        </div>
      </div>

      <div className="index-grid">
        {indices.map((index) => (
          <article className="index-card" key={index.symbol}>
            <div className="index-card-top">
              <span>{index.name}</span>
              <small>{index.symbol}</small>
            </div>
            <strong>{index.value.toLocaleString("zh-CN")}</strong>
            <div className="index-card-bottom">
              <span className={index.change >= 0 ? "positive" : "negative"}>
                {index.change >= 0 ? (
                  <ArrowUpRight size={14} />
                ) : (
                  <ArrowDownRight size={14} />
                )}
                {index.change.toFixed(2)}%
              </span>
              <span>成交量 {index.turnover}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
