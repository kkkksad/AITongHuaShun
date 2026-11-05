import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import {
  cancelPaperOrder, fetchTradingBootstrap, resetPaperAccount, setPaperTradingPaused,
  submitPaperOrder, updatePaperExecutionStrategy, updatePaperStrategyProfile, type TradingBootstrap,
} from "../lib/tradingApi";
import { useTradingBackend, type TradingBackend } from "./useTradingBackend";

vi.mock("../lib/tradingApi", async (original) => ({
  ...await original<typeof import("../lib/tradingApi")>(),
  fetchTradingBootstrap: vi.fn(), cancelPaperOrder: vi.fn(), resetPaperAccount: vi.fn(),
  setPaperTradingPaused: vi.fn(), submitPaperOrder: vi.fn(), updatePaperExecutionStrategy: vi.fn(), updatePaperStrategyProfile: vi.fn(),
  getTradingSocketUrl: () => "ws://fixture.invalid/socket",
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class Socket {
  static instances: Socket[] = [];
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  addEventListener() {}
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function bootstrap(accountId: string): TradingBootstrap {
  return {
    health: {
      ok: true, service: "local-test", mode: "paper", marketDataProvider: "mock",
      realTradingEnabled: false, authEnabled: false, websocketConnections: 0, timestamp: "2026-11-05T02:00:00Z",
    },
    capabilities: {
      marketData: { provider: "mock", mode: "paper", readOnly: true, external: false },
      execution: { provider: "paper-broker", mode: "paper", liveSupported: false, humanApprovalRequiredForLive: true },
      autoPaperExecution: { enabled: false, mode: "local-paper-broker-only", tradeWindowOnly: true, intervalMs: 60_000,
        maxOrdersPerRun: 2, maxDailyOrders: 4, targetDailyOrders: 2, liveTradingEnabled: false },
      credentials: { browserAllowed: false, storage: "server-password-hash-only" },
      authentication: { enabled: false, mode: "test-unprotected", defaultCredentials: false },
      researchData: { dataDir: "in-memory", maxSymbols: 1, historyDays: 30, maxCacheMb: 1, storeRawNews: false },
      openApi: null,
    },
    market: { mode: "paper", sequence: 1, marketTime: "2026-11-05T02:00:00Z", quotes: [] },
    account: { accountId, mode: "paper", cash: accountId === "A" ? 1_000 : 2_000, equity: accountId === "A" ? 1_000 : 2_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0,
      paused: false, updatedAt: "2026-11-05T02:00:00Z" },
    positions: [], orders: [], limits: { maxOrderNotional: 1_000, maxPositionWeight: 1, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false },
  };
}
const oldOrder = { id: "old-order", symbol: "600001", quantity: 100, status: "filled" } as OrderRecord;
const oldResult = { account: bootstrap("A").account, positions: [], orders: [], order: oldOrder };
const actions = [
  { name: "submit", api: submitPaperOrder, invoke: (backend: TradingBackend) => backend.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 100 }) },
  { name: "cancel", api: cancelPaperOrder, invoke: (backend: TradingBackend) => backend.cancelOrder("old-order") },
  { name: "pause", api: setPaperTradingPaused, invoke: (backend: TradingBackend) => backend.setPaused(true) },
  { name: "reset", api: resetPaperAccount, invoke: (backend: TradingBackend) => backend.resetAccount({ startingCash: 1_000, strategyProfile: "balanced", confirmation: "重置模拟账户" }) },
  { name: "execution", api: updatePaperExecutionStrategy, invoke: (backend: TradingBackend) => backend.setExecutionStrategy("auto") },
  { name: "profile", api: updatePaperStrategyProfile, invoke: (backend: TradingBackend) => backend.setStrategyProfile("balanced") },
];

describe("trading mutations across authentication epochs", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let backend: TradingBackend;
  const epoch = { current: 0 };
  function Probe() {
    backend = useTradingBackend({ authenticationEpoch: epoch });
    return <output>{backend.account?.accountId}</output>;
  }
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  beforeEach(() => {
    vi.resetAllMocks(); epoch.current = 0; Socket.instances = []; vi.stubGlobal("WebSocket", Socket);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["trading-bootstrap"], bootstrap("A"));
    vi.mocked(fetchTradingBootstrap).mockResolvedValue(bootstrap("B"));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function changeAuthentication() {
    // An expired session and a fast login can be batched without an enabled=false render.
    epoch.current++;
    void client.cancelQueries(); client.clear();
    await render();
    expect(backend.account?.accountId).toBe("B");
  }

  it.each(actions)("ignores old $name success without blocking the new session or changing the returned promise", async ({ name, api, invoke }) => {
    const pending = deferred<any>(); vi.mocked(api).mockReturnValue(pending.promise);
    await render();
    let completion!: Promise<unknown>;
    await act(async () => { completion = invoke(backend); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(backend.pendingAction).toBe(true);
    const oldSocket = Socket.instances[0];
    await changeAuthentication();
    expect(backend.pendingAction).toBe(false);
    expect(backend.notice).toBeUndefined();
    expect(oldSocket.close).toHaveBeenCalledTimes(1);
    client.setQueryData(["paper-trading-plan"], { accountId: "B" });
    let returned: unknown;
    await act(async () => { pending.resolve(oldResult); returned = await completion; });
    expect(returned).toEqual(name === "submit" || name === "cancel" ? oldOrder : undefined);
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.accountId).toBe("B");
    expect(client.getQueryData(["paper-trading-plan"])).toEqual({ accountId: "B" });
    expect(backend.notice).toBeUndefined();
    expect(backend.error).toBeUndefined();
  });

  it.each(actions)("keeps old $name rejection semantics without setting an error in the new session", async ({ api, invoke }) => {
    const pending = deferred<any>(); vi.mocked(api).mockReturnValue(pending.promise);
    await render();
    let completion!: Promise<unknown>;
    await act(async () => { completion = invoke(backend); });
    const outcome = completion.then(() => null, (error: unknown) => error);
    await changeAuthentication();
    const failure = new Error("old-session-failure");
    let returned: unknown;
    await act(async () => { pending.reject(failure); returned = await outcome; });
    expect(returned).toBe(failure);
    expect(backend.error).toBeUndefined();
    expect(backend.notice).toBeUndefined();
    expect(backend.pendingAction).toBe(false);
  });

  it.each(actions)("captures $name authentication at invocation before mutation scheduling", async ({ api, invoke }) => {
    const pending = deferred<any>(); vi.mocked(api).mockReturnValue(pending.promise);
    await render();
    let completion!: Promise<unknown>;
    await act(async () => {
      completion = invoke(backend);
      epoch.current++;
      void client.cancelQueries(); client.clear();
      root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(backend.account?.accountId).toBe("B");
    await act(async () => { pending.resolve(oldResult); await completion; });
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.accountId).toBe("B");
    expect(backend.notice).toBeUndefined();
    expect(backend.error).toBeUndefined();
    expect(backend.pendingAction).toBe(false);
  });

  it.each(["bootstrap-cancel", "research-cancel"])("rechecks authentication after reset waits for %s", async (stage) => {
    const pending = deferred<any>(); const gate = deferred<void>();
    vi.mocked(resetPaperAccount).mockReturnValue(pending.promise);
    await render();
    const originalCancel = client.cancelQueries.bind(client);
    const cancel = vi.spyOn(client, "cancelQueries").mockImplementation((filters, options) => {
      const isBootstrap = filters?.queryKey?.[0] === "trading-bootstrap";
      const isResearch = Boolean(filters?.predicate);
      if (stage === "bootstrap-cancel" && isBootstrap || stage === "research-cancel" && isResearch) {
        return gate.promise.then(() => originalCancel(filters, options));
      }
      return originalCancel(filters, options);
    });
    let completion!: Promise<unknown>;
    await act(async () => { completion = backend.resetAccount({ startingCash: 1_000, strategyProfile: "balanced", confirmation: "重置模拟账户" }); });
    await act(async () => { pending.resolve(oldResult); });
    expect(cancel.mock.calls.some(([filters]) => stage === "bootstrap-cancel" ? filters?.queryKey?.[0] === "trading-bootstrap" : Boolean(filters?.predicate))).toBe(true);
    await changeAuthentication();
    client.setQueryData(["paper-trading-plan"], { accountId: "B" });
    await act(async () => { gate.resolve(); await completion; });
    expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.accountId).toBe("B");
    expect(client.getQueryData(["paper-trading-plan"])).toEqual({ accountId: "B" });
    expect(backend.notice).toBeUndefined();
  });
});
