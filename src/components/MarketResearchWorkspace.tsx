import {
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import type { LucideProps } from "lucide-react";
import {
  BarChart3,
  Globe2,
  Layers3,
  Newspaper,
  ScanSearch,
  Search,
} from "lucide-react";
import type { TradingBackend } from "../hooks/useTradingBackend";
import { FlowPanel } from "./FlowPanel";
import { HongKongMarketPanel } from "./HongKongMarketPanel";
import { IpoSubscriptionPanel } from "./IpoSubscriptionPanel";
import { MarketChart } from "./MarketChart";
import { MarketOverview } from "./MarketOverview";
import { MarketRegimePanel } from "./MarketRegimePanel";
import { NewsPanel } from "./NewsPanel";
import { StockTrendForecastPanel } from "./StockTrendForecastPanel";
import { TurningPointPanel } from "./TurningPointPanel";

type MarketWorkspaceTab =
  | "a-share"
  | "turning"
  | "stock"
  | "regime"
  | "hong-kong"
  | "events";

interface MarketResearchWorkspaceProps {
  trading: TradingBackend;
}

const tabs: Array<{
  id: MarketWorkspaceTab;
  label: string;
  icon: ComponentType<LucideProps>;
}> = [
  { id: "a-share", label: "A 股概览", icon: BarChart3 },
  { id: "turning", label: "变盘雷达", icon: ScanSearch },
  { id: "stock", label: "个股研判", icon: Search },
  { id: "regime", label: "板块形态", icon: Layers3 },
  { id: "hong-kong", label: "港股观察", icon: Globe2 },
  { id: "events", label: "事件资讯", icon: Newspaper },
];

export function MarketResearchWorkspace({ trading }: MarketResearchWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<MarketWorkspaceTab>("a-share");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="page-stack market-research-page">
      <MarketOverview
        connectionState={trading.connectionState}
        market={trading.market}
      />

      <section className="market-workspace" aria-label="市场研究工作台">
        <div className="market-workspace-tabs" role="tablist" aria-label="市场研究模块">
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            return (
              <button
                aria-controls={`market-workspace-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "active" : ""}
                id={`market-workspace-tab-${tab.id}`}
                key={tab.id}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                onClick={() => setActiveTab(tab.id)}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={activeTab === tab.id ? 0 : -1}
                type="button"
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={`market-workspace-tab-${activeTab}`}
          className="market-workspace-panel"
          id={`market-workspace-panel-${activeTab}`}
          role="tabpanel"
        >
          {activeTab === "a-share" && (
            <div className="two-column wide-left">
              <MarketChart market={trading.market} />
              <FlowPanel />
            </div>
          )}
          {activeTab === "turning" && <TurningPointPanel />}
          {activeTab === "stock" && <StockTrendForecastPanel />}
          {activeTab === "regime" && <MarketRegimePanel />}
          {activeTab === "hong-kong" && <HongKongMarketPanel />}
          {activeTab === "events" && (
            <div className="page-stack market-events-stack">
              <IpoSubscriptionPanel />
              <NewsPanel />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
