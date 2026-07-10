import { Activity, ArrowUpRight } from "lucide-react";
import { marketIndices } from "../data/mockData";

export function MarketOverview() {
  return (
    <section className="market-overview">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">收盘快照</span>
          <h2>主要指数</h2>
        </div>
        <div className="as-of">
          <Activity size={15} />
          2026-07-11 15:00
        </div>
      </div>

      <div className="index-grid">
        {marketIndices.map((index) => (
          <article className="index-card" key={index.symbol}>
            <div className="index-card-top">
              <span>{index.name}</span>
              <small>{index.symbol}</small>
            </div>
            <strong>{index.value.toLocaleString("zh-CN")}</strong>
            <div className="index-card-bottom">
              <span className="positive">
                <ArrowUpRight size={14} />
                {index.change.toFixed(2)}%
              </span>
              <span>成交 {index.turnover}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
