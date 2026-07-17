import { IpoSubscriptionPanel } from "./IpoSubscriptionPanel";
import { NewsPanel } from "./NewsPanel";

export function MarketEventsPanel() {
  return (
    <div className="page-stack market-events-stack">
      <IpoSubscriptionPanel />
      <NewsPanel />
    </div>
  );
}
