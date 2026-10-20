import { MarketResearchWorkspace } from "../components/MarketResearchWorkspace";
import type { TradingBackend } from "../hooks/useTradingBackend";
import type { MarketModuleTab } from "../lib/moduleCatalog";

interface MarketPageProps {
  trading: TradingBackend;
  activeTab: MarketModuleTab;
  onTabChange: (tab: MarketModuleTab) => void;
}

export default function MarketPage({ trading, activeTab, onTabChange }: MarketPageProps) {
  return (
    <MarketResearchWorkspace
      activeTab={activeTab}
      onTabChange={onTabChange}
      trading={trading}
    />
  );
}