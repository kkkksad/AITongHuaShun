import type { MarketSnapshot } from "../../shared/trading";
import { FlowPanel } from "./FlowPanel";
import { MarketChart } from "./MarketChart";

interface MarketAshareOverviewPanelProps {
  market?: MarketSnapshot;
}

export function MarketAshareOverviewPanel({ market }: MarketAshareOverviewPanelProps) {
  return (
    <div className="two-column wide-left">
      <MarketChart market={market} />
      <FlowPanel />
    </div>
  );
}
