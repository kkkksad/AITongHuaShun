import { FlowPanel } from "../components/FlowPanel";
import { MarketChart } from "../components/MarketChart";
import { MarketOverview } from "../components/MarketOverview";
import { MarketRegimePanel } from "../components/MarketRegimePanel";
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
      <div className="two-column wide-left">
        <MarketChart market={trading.market} />
        <FlowPanel />
      </div>
      <MarketRegimePanel />
      <NewsPanel />
    </div>
  );
}
