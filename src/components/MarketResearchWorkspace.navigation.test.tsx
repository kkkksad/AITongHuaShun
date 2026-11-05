import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../hooks/useTheme";
import type { TradingBackend } from "../hooks/useTradingBackend";
import { I18nProvider } from "../i18n";
import { getModuleHref, parseMarketTab } from "../lib/moduleCatalog";
import { AppShell } from "./AppShell";
import { MarketResearchWorkspace } from "./MarketResearchWorkspace";

const panels = vi.hoisted(() => ({ turningGate: null as Promise<void> | null }));

vi.mock("./MarketOverview", () => ({ MarketOverview: () => <div>市场概览</div> }));
vi.mock("./MarketAshareOverviewPanel", () => ({ MarketAshareOverviewPanel: () => <div>A 股内容</div> }));
vi.mock("./TurningPointPanel", () => ({
  TurningPointPanel: () => {
    if (panels.turningGate) throw panels.turningGate;
    return <div>变盘内容</div>;
  },
}));
vi.mock("./StockTrendForecastPanel", () => ({ StockTrendForecastPanel: () => <div>个股内容</div> }));
vi.mock("./MarketRegimePanel", () => ({ MarketRegimePanel: () => <div>板块内容</div> }));
vi.mock("./HongKongMarketPanel", () => ({ HongKongMarketPanel: () => <div>港股内容</div> }));
vi.mock("./FuturesMarketPanel", () => ({ FuturesMarketPanel: () => <div>期货内容</div> }));
vi.mock("./ExternalMarketImpactPanel", () => ({ ExternalMarketImpactPanel: () => <div>外盘内容</div> }));
vi.mock("./CryptoMarketPanel", () => ({ CryptoMarketPanel: () => <div>数字资产内容</div> }));
vi.mock("./MarketEventsPanel", () => ({ MarketEventsPanel: () => <div>事件内容</div> }));
vi.mock("./EsotericMarketPanel", () => ({ EsotericMarketPanel: () => <div>观察内容</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("market tabs with route navigation focus", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    scrollIntoView.mockReset();
    frames = new Map();
    frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: scrollIntoView,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    panels.turningGate = null;
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  function Harness({ refresh = 0, explicitTarget = false }: { refresh?: number; explicitTarget?: boolean }) {
    const location = useLocation();
    const navigate = useNavigate();
    const market = location.pathname === "/market";
    return (
      <AppShell
        activeView={market ? "market" : "overview"}
        connectionState="connected"
        mode="paper"
        navigationKey={location.key}
        navigationTargetId={explicitTarget ? "explicit-target" : undefined}
        onModuleSelect={(item) => navigate(getModuleHref(item))}
        onViewChange={(view) => navigate(view === "overview" ? "/" : `/${view}`)}
      >
        <button id="history-back" onClick={() => navigate(-1)} type="button">返回</button>
        <section data-refresh={refresh} id="explicit-target" tabIndex={-1}>明确的导航目标</section>
        {market ? (
          <MarketResearchWorkspace
            activeTab={parseMarketTab(location.search)}
            onTabChange={(tab) => navigate(`/market?tab=${tab}`)}
            trading={{ connectionState: "connected" } as TradingBackend}
          />
        ) : <div>总览内容</div>}
      </AppShell>
    );
  }

  async function flushFrames() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  }

  async function render({ initialEntry = "/market?tab=a-share", refresh = 0, explicitTarget = false } = {}) {
    await act(async () => {
      root.render(
        <ThemeProvider><I18nProvider><MemoryRouter initialEntries={[initialEntry]}>
          <Harness explicitTarget={explicitTarget} refresh={refresh} />
        </MemoryRouter></I18nProvider></ThemeProvider>,
      );
      await vi.dynamicImportSettled();
    });
    await flushFrames();
  }

  function tab(id: string) {
    return container.querySelector<HTMLButtonElement>(`#market-workspace-tab-${id}`)!;
  }

  async function press(key: string) {
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      await vi.dynamicImportSettled();
    });
    await flushFrames();
  }

  function expectSelectedFocus(id: string) {
    expect(tab(id).getAttribute("aria-selected")).toBe("true");
    expect(tab(id).tabIndex).toBe(0);
    expect(document.activeElement).toBe(tab(id));
  }

  it("keeps the selected tab focused while its lazy panel loads and after it mounts", async () => {
    let release!: () => void;
    panels.turningGate = new Promise<void>((resolve) => { release = resolve; });
    await render();
    await act(async () => { tab("a-share").focus(); });
    await press("ArrowRight");
    const focusedWhileLoading = document.activeElement;
    const wasLoading = Boolean(container.querySelector(".market-tab-loading"));
    await act(async () => {
      panels.turningGate = null;
      release();
      await vi.dynamicImportSettled();
    });
    await flushFrames();
    expect(wasLoading).toBe(true);
    expect(focusedWhileLoading).toBe(tab("turning"));
    expect(container.textContent).toContain("变盘内容");
    expectSelectedFocus("turning");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("supports consecutive right and left arrows without losing tablist focus", async () => {
    await render();
    await act(async () => { tab("a-share").focus(); });
    for (const [key, id] of [
      ["ArrowRight", "turning"], ["ArrowRight", "stock"],
      ["ArrowLeft", "turning"], ["ArrowLeft", "a-share"],
    ]) {
      await press(key);
      expectSelectedFocus(id);
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("wraps left from the first tab and right from the last tab", async () => {
    await render();
    await act(async () => { tab("a-share").focus(); });
    await press("ArrowLeft");
    expectSelectedFocus("esoteric");
    await press("ArrowRight");
    expectSelectedFocus("a-share");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps Home and End navigation in the tablist", async () => {
    await render();
    await act(async () => { tab("a-share").focus(); });
    await press("End");
    expectSelectedFocus("esoteric");
    await press("Home");
    expectSelectedFocus("a-share");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll or refocus when the selected route is refreshed", async () => {
    await render();
    await act(async () => { tab("a-share").focus(); });
    await press("ArrowRight");
    expectSelectedFocus("turning");
    await render({ refresh: 1 });
    expectSelectedFocus("turning");
    expect(container.querySelector("#explicit-target")!.getAttribute("data-refresh")).toBe("1");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("respects an explicitly focused selected tab after a click navigation", async () => {
    await render();
    await act(async () => {
      tab("stock").focus();
      tab("stock").click();
    });
    await flushFrames();
    expectSelectedFocus("stock");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("still focuses main when quick search enters the market page from the header", async () => {
    await render({ initialEntry: "/" });
    const input = container.querySelector<HTMLInputElement>("#global-search")!;
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }));
    });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "个股研判");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter");
    expect(tab("stock").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("main"));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
  });

  it("still focuses main on history return when the old focused tab is no longer selected", async () => {
    await render();
    await act(async () => { tab("a-share").focus(); });
    await press("ArrowRight");
    // Keep the old tab focused when the browser changes the selected route.
    scrollIntoView.mockClear();
    await act(async () => {
      tab("turning").focus();
      container.querySelector<HTMLButtonElement>("#history-back")!.click();
    });
    await flushFrames();
    expect(tab("a-share").getAttribute("aria-selected")).toBe("true");
    expect(tab("turning").getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(container.querySelector("main"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit destination even when a selected tab has focus", async () => {
    await render({ explicitTarget: true });
    scrollIntoView.mockClear();
    await act(async () => { tab("a-share").focus(); });
    await press("ArrowRight");
    expect(tab("turning").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("#explicit-target"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
