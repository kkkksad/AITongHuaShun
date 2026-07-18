import { Activity, ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { MarketSnapshot } from "../../shared/trading";
import type { ConnectionState } from "../hooks/useTradingBackend";

interface MarketOverviewProps {
  market?: MarketSnapshot;
  connectionState: ConnectionState;
}

function formatVolume(volume: number): string {
  return `${(volume / 100_000_000).toFixed(2)} 亿`;
}

function formatAmount(amount?: number): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return "暂无";
  }
  return `${(amount / 100_000_000).toFixed(2)} 亿`;
}

export function MarketOverview({ market, connectionState }: MarketOverviewProps) {
  const liveIndices = market?.quotes
    .filter((quote) => !quote.tradable && quote.price > 0)
    .map((quote) => ({
      symbol: quote.symbol,
      name: quote.name,
      value: quote.price,
      change: quote.changePercent,
      turnover: quote.amount ? formatAmount(quote.amount) : formatVolume(quote.volume),
      metricLabel: quote.amount ? "成交额" : "成交量",
    })) ?? [];
  const asOf = market
    ? new Date(market.marketTime).toLocaleString("zh-CN", { hour12: false })
    : "等待后端快照";
  const hasIndices = liveIndices.length > 0;

  return (
    <section className="market-overview">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">收盘快照</span>
          <h2>主要指数</h2>
        </div>
        <div className="as-of">
          <Activity size={15} />
          {connectionState === "connected"
            ? hasIndices ? asOf : `${asOf} · 无指数报价`
            : connectionState === "connecting" ? "正在连接后端" : "后端离线"}
        </div>
      </div>

      {hasIndices ? (
        <div className="index-grid">
          {liveIndices.map((index) => (
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
                <span>{index.metricLabel} {index.turnover}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="market-index-empty" role="status">
          <Activity size={19} />
          <div>
            <strong>{connectionState === "connected" ? "指数行情暂未返回" : "等待指数行情连接"}</strong>
            <span>
              {connectionState === "connected"
                ? "当前快照不使用静态指数补位"
                : "后端连接后显示当前指数快照"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
