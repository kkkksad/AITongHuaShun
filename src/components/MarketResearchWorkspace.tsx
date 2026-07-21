import {
  lazy,
  Suspense,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bitcoin,
  Globe2,
  Layers3,
  LoaderCircle,
  Newspaper,
  ScanSearch,
  Search,
} from "lucide-react";
import type { TradingBackend } from "../hooks/useTradingBackend";
import { MarketOverview } from "./MarketOverview";

const loadAsharePanel = () => import("./MarketAshareOverviewPanel");
const loadTurningPanel = () => import("./TurningPointPanel");
const loadStockPanel = () => import("./StockTrendForecastPanel");
const loadRegimePanel = () => import("./MarketRegimePanel");
const loadHongKongPanel = () => import("./HongKongMarketPanel");
const loadFuturesPanel = () => import("./FuturesMarketPanel");
const loadExternalPanel = () => import("./ExternalMarketImpactPanel");
const loadCryptoPanel = () => import("./CryptoMarketPanel");
const loadEventsPanel = () => import("./MarketEventsPanel");

const MarketAshareOverviewPanel = lazy(async () => ({
  default: (await loadAsharePanel()).MarketAshareOverviewPanel,
}));
const TurningPointPanel = lazy(async () => ({
  default: (await loadTurningPanel()).TurningPointPanel,
}));
const StockTrendForecastPanel = lazy(async () => ({
  default: (await loadStockPanel()).StockTrendForecastPanel,
}));
const MarketRegimePanel = lazy(async () => ({
  default: (await loadRegimePanel()).MarketRegimePanel,
}));
const HongKongMarketPanel = lazy(async () => ({
  default: (await loadHongKongPanel()).HongKongMarketPanel,
}));
const FuturesMarketPanel = lazy(async () => ({
  default: (await loadFuturesPanel()).FuturesMarketPanel,
}));
const ExternalMarketImpactPanel = lazy(async () => ({
  default: (await loadExternalPanel()).ExternalMarketImpactPanel,
}));
const CryptoMarketPanel = lazy(async () => ({
  default: (await loadCryptoPanel()).CryptoMarketPanel,
}));
const MarketEventsPanel = lazy(async () => ({
  default: (await loadEventsPanel()).MarketEventsPanel,
}));

type MarketWorkspaceTab =
  | "a-share"
  | "turning"
  | "stock"
  | "regime"
  | "hong-kong"
  | "futures"
  | "external"
  | "crypto"
  | "events";

interface MarketResearchWorkspaceProps {
  trading: TradingBackend;
}

const tabs: Array<{
  id: MarketWorkspaceTab;
  label: string;
  icon: ComponentType<LucideProps>;
  preload: () => Promise<unknown>;
}> = [
  { id: "a-share", label: "A 股概览", icon: BarChart3, preload: loadAsharePanel },
  { id: "turning", label: "变盘雷达", icon: ScanSearch, preload: loadTurningPanel },
  { id: "stock", label: "个股研判", icon: Search, preload: loadStockPanel },
  { id: "regime", label: "板块形态", icon: Layers3, preload: loadRegimePanel },
  { id: "hong-kong", label: "港股观察", icon: Globe2, preload: loadHongKongPanel },
  { id: "futures", label: "期货研判", icon: Activity, preload: loadFuturesPanel },
  { id: "external", label: "全球影响", icon: Globe2, preload: loadExternalPanel },
  { id: "crypto", label: "数字资产", icon: Bitcoin, preload: loadCryptoPanel },
  { id: "events", label: "事件资讯", icon: Newspaper, preload: loadEventsPanel },
];

function MarketTabLoading() {
  return (
    <div aria-live="polite" className="market-tab-loading" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>正在加载研究模块</span>
    </div>
  );
}

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
                onFocus={() => void tab.preload()}
                onMouseEnter={() => void tab.preload()}
                onPointerDown={() => void tab.preload()}
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
          <Suspense fallback={<MarketTabLoading />}>
            {activeTab === "a-share" && (
              <MarketAshareOverviewPanel
                connectionState={trading.connectionState}
                market={trading.market}
              />
            )}
            {activeTab === "turning" && <TurningPointPanel />}
            {activeTab === "stock" && <StockTrendForecastPanel />}
            {activeTab === "regime" && <MarketRegimePanel />}
            {activeTab === "hong-kong" && <HongKongMarketPanel />}
            {activeTab === "futures" && <FuturesMarketPanel />}
            {activeTab === "external" && <ExternalMarketImpactPanel />}
            {activeTab === "crypto" && <CryptoMarketPanel />}
            {activeTab === "events" && <MarketEventsPanel />}
          </Suspense>
        </div>
      </section>
    </div>
  );
}
