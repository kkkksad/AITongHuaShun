import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import {
  AUTH_EXPIRED_EVENT, fetchDailyMarketReview, fetchPaperTradingPlan, fetchTradingBootstrap, fetchWeeklyPaperReview,
  login, logout, verifyLogin, updatePaperStrategyProfile,
  type PaperTradingPlan, type TradingBootstrap,
} from "./lib/tradingApi";
import { dailyMarketReviewQueryOptions, weeklyPaperReviewQueryOptions } from "./lib/researchQueries";

vi.mock("./lib/tradingApi", async (original) => ({
  ...await original<typeof import("./lib/tradingApi")>(),
  verifyLogin: vi.fn(), login: vi.fn(), logout: vi.fn(), fetchTradingBootstrap: vi.fn(), fetchPaperTradingPlan: vi.fn(),
  fetchDailyMarketReview: vi.fn(), fetchWeeklyPaperReview: vi.fn(), updatePaperStrategyProfile: vi.fn(),
  getTradingSocketUrl: () => "ws://fixture.invalid/socket",
}));
vi.mock("./components/PwaInstallPrompt", () => ({ PwaInstallPrompt: () => null, OfflineBanner: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class Socket { addEventListener() {} close() {} }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function bootstrap(cash: number): TradingBootstrap {
  return {
    health: {
      ok: true, service: "local-test", mode: "paper", marketDataProvider: "mock",
      realTradingEnabled: false, authEnabled: true, websocketConnections: 0, timestamp: "2026-11-05T02:00:00Z",
    },
    capabilities: {
      marketData: { provider: "mock", mode: "paper", readOnly: true, external: false },
      execution: { provider: "paper-broker", mode: "paper", liveSupported: false, humanApprovalRequiredForLive: true },
      autoPaperExecution: { enabled: false, mode: "local-paper-broker-only", tradeWindowOnly: true, intervalMs: 60_000,
        maxOrdersPerRun: 2, maxDailyOrders: 4, targetDailyOrders: 2, liveTradingEnabled: false },
      credentials: { browserAllowed: false, storage: "server-password-hash-only" },
      authentication: { enabled: true, mode: "server-session", defaultCredentials: false },
      researchData: { dataDir: "in-memory", maxSymbols: 1, historyDays: 30, maxCacheMb: 1, storeRawNews: false },
      openApi: null,
    },
    market: { mode: "paper", sequence: 1, marketTime: "2026-11-05T02:00:00Z", quotes: [] },
    account: { accountId: "fixture-account", mode: "paper", cash, equity: cash, startingEquity: cash,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0,
      paused: false, updatedAt: "2026-11-05T02:00:00Z", strategyProfile: "growth", executionStrategy: "auto" },
    positions: [], orders: [], limits: { maxOrderNotional: 1_000, maxPositionWeight: 1, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false },
  };
}
function privatePlan(summary: string): PaperTradingPlan {
  return { capitalPlan: { sizingDiagnostics: {
    effectiveOrderCap: 5_000, minimumFeeEfficientNotional: 1_000, plannedBuyOrderCount: 1,
    averagePlannedBuyNotional: 4_900, largestPlannedBuyNotional: 4_900, limitingConstraint: "risk-order-cap",
    plannedCashBudget: 20_000, cashReserveAmount: 0, summary,
  } } } as PaperTradingPlan;
}

describe("App authentication query boundaries", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let navigate: ReturnType<typeof useNavigate>;
  const user = { username: "fixture-admin", role: "admin" as const };

  function NavigationProbe() { navigate = useNavigate(); return null; }
  beforeAll(async () => { await import("./components/Settings"); });
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    vi.stubGlobal("WebSocket", Socket);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.mocked(verifyLogin).mockResolvedValue({ user } as Awaited<ReturnType<typeof verifyLogin>>);
    vi.mocked(login).mockResolvedValue({ user } as Awaited<ReturnType<typeof login>>);
    vi.mocked(logout).mockResolvedValue();
    vi.mocked(fetchTradingBootstrap).mockResolvedValue(bootstrap(20_000));
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("old-session-private-plan"));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  async function settle() {
    await act(async () => { await vi.dynamicImportSettled(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  async function mount() {
    await act(async () => root.render(<QueryClientProvider client={client}><ThemeProvider><I18nProvider>
      <MemoryRouter initialEntries={["/settings?section=execution"]}><NavigationProbe /><App /></MemoryRouter>
    </I18nProvider></ThemeProvider></QueryClientProvider>));
    await settle();
  }
  async function leave(expired = false) {
    await act(async () => {
      if (expired) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      else container.querySelector<HTMLButtonElement>(".topbar-logout")!.click();
    });
    await settle();
    expect(container.textContent).toContain("登录工作台");
  }
  async function authenticate() {
    await act(async () => {
      for (const [name, value] of [["username", user.username], ["password", "fixture-password"]]) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
  }
  const otherKeys = [
    ["daily-market-review"], ["weekly-paper-review", "current"], ["weekly-paper-review", "previous"],
    ["paper-auto-execution-status"], ["real-research-data-feed", "news", 40, 3], ["market-data-quality"],
  ];

  it.each(["logout", "expired", "logout-failed"])("clears old private reports on %s and fetches fresh reports for a new authentication", async (exit) => {
    await mount();
    expect(container.textContent).toContain("old-session-private-plan");
    for (const key of otherKeys) client.setQueryData(key, { oldSession: true });
    if (exit === "logout-failed") vi.mocked(logout).mockRejectedValue(new Error("fixture network failure"));
    await leave(exit === "expired");
    expect(client.getQueryData(["paper-trading-plan"])).toBeUndefined();
    for (const key of otherKeys) expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(["trading-bootstrap"])).toBeUndefined();
    vi.mocked(fetchTradingBootstrap).mockResolvedValue(bootstrap(8_000));
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("new-session-plan"));
    vi.mocked(fetchDailyMarketReview).mockResolvedValue({ newSession: "daily" } as unknown as Awaited<ReturnType<typeof fetchDailyMarketReview>>);
    vi.mocked(fetchWeeklyPaperReview).mockResolvedValue({ newSession: "weekly" } as unknown as Awaited<ReturnType<typeof fetchWeeklyPaperReview>>);
    await authenticate();
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.cash).toBe(8_000);
    expect(container.textContent).toContain("new-session-plan");
    expect(container.textContent).not.toContain("old-session-private-plan");
    expect(fetchPaperTradingPlan).toHaveBeenCalledTimes(2);
    await client.fetchQuery(dailyMarketReviewQueryOptions());
    await client.fetchQuery(weeklyPaperReviewQueryOptions("current"));
    expect(client.getQueryData(["daily-market-review"])).toEqual({ newSession: "daily" });
    expect(client.getQueryData(["weekly-paper-review", "current"])).toEqual({ newSession: "weekly" });
  });

  it("clears queries introduced on the login page before authentication completes", async () => {
    await mount(); await leave();
    client.setQueryData(["paper-trading-plan"], privatePlan("login-page-stale-plan"));
    client.setQueryData(["daily-market-review"], { oldSession: true });
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("new-session-plan"));
    await authenticate();
    expect(container.textContent).toContain("new-session-plan");
    expect(container.textContent).not.toContain("login-page-stale-plan");
    expect(client.getQueryData(["daily-market-review"])).toBeUndefined();
  });

  it.each(["success", "failure"])("ignores an old logout %s after an expired session has authenticated again", async (outcome) => {
    const old = deferred<void>(); vi.mocked(logout).mockReturnValueOnce(old.promise);
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>(".topbar-logout")!.click(); });
    expect(logout).toHaveBeenCalledTimes(1);
    await leave(true);
    vi.mocked(fetchTradingBootstrap).mockResolvedValue(bootstrap(8_000));
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("new-session-plan"));
    await authenticate();
    await act(async () => {
      if (outcome === "success") old.resolve();
      else old.reject(new Error("old-session-logout-failure"));
    });
    await settle();
    expect(container.textContent).toContain("new-session-plan");
    expect(container.textContent).not.toContain("登录工作台");
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.cash).toBe(8_000);
  });

  it("aborts an old in-flight plan and never lets its late response replace the new session's data", async () => {
    const old = deferred<PaperTradingPlan>();
    let oldSignal: AbortSignal | undefined;
    vi.mocked(fetchPaperTradingPlan).mockImplementationOnce((signal) => { oldSignal = signal; return old.promise; });
    await mount();
    expect(oldSignal?.aborted).toBe(false);
    await leave();
    expect(oldSignal?.aborted).toBe(true);
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("new-session-plan"));
    await authenticate();
    await act(async () => { old.resolve(privatePlan("late-old-plan")); });
    await settle();
    expect(container.textContent).toContain("new-session-plan");
    expect(container.textContent).not.toContain("late-old-plan");
    expect(client.getQueryData(["paper-trading-plan"])).toEqual(privatePlan("new-session-plan"));
  });

  it("does not let a late initial session verification override an intervening auth-expired event", async () => {
    const old = deferred<Awaited<ReturnType<typeof verifyLogin>>>();
    vi.mocked(verifyLogin).mockReturnValueOnce(old.promise);
    await mount();
    await act(async () => { window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)); });
    await act(async () => { old.resolve({ user } as Awaited<ReturnType<typeof verifyLogin>>); });
    await settle();
    expect(container.textContent).toContain("登录工作台");
    expect(fetchTradingBootstrap).not.toHaveBeenCalled();
  });

  it("preserves fresh same-session queries when navigating away and back", async () => {
    await mount();
    expect(fetchPaperTradingPlan).toHaveBeenCalledTimes(1);
    await act(async () => navigate("/strategy?stage=configure")); await settle();
    await act(async () => navigate("/settings?section=execution")); await settle();
    expect(container.textContent).toContain("old-session-private-plan");
    expect(fetchPaperTradingPlan).toHaveBeenCalledTimes(1);
    expect(fetchTradingBootstrap).toHaveBeenCalledTimes(1);
  });

  it("keeps a late profile mutation's return behavior while preventing old account data from replacing a new session", async () => {
    await mount();
    const old = deferred<Awaited<ReturnType<typeof updatePaperStrategyProfile>>>();
    vi.mocked(updatePaperStrategyProfile).mockReturnValueOnce(old.promise);
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".strategy-profile-option")].find((button) => button.textContent?.includes("均衡"))!.click();
    });
    expect(updatePaperStrategyProfile).toHaveBeenCalledTimes(1);
    await leave();
    vi.mocked(fetchTradingBootstrap).mockResolvedValue(bootstrap(8_000));
    vi.mocked(fetchPaperTradingPlan).mockResolvedValue(privatePlan("new-session-plan"));
    await authenticate();
    expect([...container.querySelectorAll<HTMLButtonElement>(".strategy-profile-option")].every((button) => !button.disabled)).toBe(true);
    await act(async () => { old.resolve({ account: bootstrap(1_234).account }); }); await settle();
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.cash).toBe(8_000);
    expect(container.textContent).toContain("¥8,000");
    expect(container.textContent).not.toContain("¥1,234");
  });
});
