import { FlowPanel } from "../components/FlowPanel";
import { MarketChart } from "../components/MarketChart";
import { MarketOverview } from "../components/MarketOverview";
import { StockTrendForecastPanel } from "../components/StockTrendForecastPanel";
import { MarketRegimePanel } from "../components/MarketRegimePanel";
import { IpoSubscriptionPanel } from "../components/IpoSubscriptionPanel";
import { NewsPanel } from "../components/NewsPanel";
import type { TradingBackend } from "../hooks/useTradingBackend";

interface MarketPageProps {
  trading: TradingBackend;
}

export default function MarketPage({ trading }: MarketPageProps) {
  return (
    <div className="page-stack">
      <MarketOverview
        connectionState={trading.connectionState}
        market={trading.market}
      />
      <StockTrendForecastPanel />
      <div className="two-column wide-left">
        <MarketChart market={trading.market} />
        <FlowPanel />
      </div>
      <MarketRegimePanel />
      <IpoSubscriptionPanel />
      <NewsPanel />
    </div>
  );
}
