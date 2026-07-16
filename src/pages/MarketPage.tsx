import { MarketResearchWorkspace } from "../components/MarketResearchWorkspace";
import type { TradingBackend } from "../hooks/useTradingBackend";

interface MarketPageProps {
  trading: TradingBackend;
}

export default function MarketPage({ trading }: MarketPageProps) {
  return <MarketResearchWorkspace trading={trading} />;
}
