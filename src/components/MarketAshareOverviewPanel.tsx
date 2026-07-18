import type { MarketSnapshot } from "../../shared/trading";
import type { ConnectionState } from "../hooks/useTradingBackend";
import { FlowPanel } from "./FlowPanel";
import { MarketChart } from "./MarketChart";
import { MarketDataQualityStrip } from "./MarketDataQualityStrip";

interface MarketAshareOverviewPanelProps {
  connectionState: ConnectionState;
  market?: MarketSnapshot;
}

export function MarketAshareOverviewPanel({
  connectionState,
  market,
}: MarketAshareOverviewPanelProps) {
  return (
    <div className="a-share-overview-stack">
      <MarketDataQualityStrip connectionState={connectionState} />
      <div className="two-column wide-left">
        <MarketChart market={market} />
        <FlowPanel />
      </div>
    </div>
  );
}
