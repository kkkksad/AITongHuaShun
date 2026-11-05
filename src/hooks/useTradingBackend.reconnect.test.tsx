import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { fetchTradingBootstrap, type TradingBootstrap } from "../lib/tradingApi";
import { useTradingBackend, type TradingBackend } from "./useTradingBackend";

vi.mock("../lib/tradingApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/tradingApi")>(),
  fetchTradingBootstrap: vi.fn(),
  getTradingSocketUrl: () => "ws://127.0.0.1/test-only",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  private handlers = new Map<string, Array<(event: Event) => void>>();

  constructor() { MockWebSocket.instances.push(this); }
  addEventListener(type: string, callback: (event: Event) => void) {
    this.handlers.set(type, [...this.handlers.get(type) ?? [], callback]);
  }
  emit(type: string, event: Event = new Event(type)) {
    if (type === "open") this.readyState = MockWebSocket.OPEN;
    if (type === "close") this.readyState = MockWebSocket.CLOSED;
    for (const callback of this.handlers.get(type) ?? []) callback(event);
  }
  receive(type: string, data: unknown) {
    this.emit("message", new MessageEvent("message", { data: JSON.stringify({ type, data }) }));
  }
  close() { this.emit("close", new CloseEvent("close", { code: 1000 })); }
}

function order(id: string, status: OrderRecord["status"] = "pending"): OrderRecord {
  return {
    id, symbol: "600519", name: "本地测试", side: "buy", type: "limit", quantity: 100,
    status, requestedPrice: 10, limitPrice: 10, filledQuantity: status === "filled" ? 100 : 0,
    notional: status === "filled" ? 1_000 : 0, commission: status === "filled" ? 5 : 0,
    createdAt: "2026-11-05T02:00:00Z", updatedAt: "2026-11-05T02:00:00Z",
  };
}

function bootstrap(orders = [order("fill"), order("cancel"), order("removed")]): TradingBootstrap {
  return {
    health: {
      ok: true, service: "local-test", mode: "paper", marketDataProvider: "mock",
      realTradingEnabled: false, authEnabled: false, websocketConnections: 0,
      timestamp: "2026-11-05T02:00:00Z",
    },
    capabilities: {
      marketData: { provider: "mock", mode: "paper", readOnly: true, external: false },
      execution: { provider: "paper-broker", mode: "paper", liveSupported: false, humanApprovalRequiredForLive: true },
      autoPaperExecution: {
        enabled: false, mode: "local-paper-broker-only", tradeWindowOnly: true, intervalMs: 60_000,
        maxOrdersPerRun: 2, maxDailyOrders: 4, targetDailyOrders: 2, liveTradingEnabled: false,
      },
      credentials: { browserAllowed: false, storage: "server-password-hash-only" },
      authentication: { enabled: false, mode: "test-unprotected", defaultCredentials: false },
      researchData: { dataDir: "in-memory", maxSymbols: 1, historyDays: 30, maxCacheMb: 1, storeRawNews: false },
      openApi: null,
    },
    market: { mode: "paper", sequence: 1, marketTime: "2026-11-05T02:00:00Z", quotes: [] },
    account: {
      accountId: "local-test", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: "2026-11-05T02:00:00Z",
    },
    positions: [], orders,
    limits: { maxOrderNotional: 1_000, maxPositionWeight: 0.25, maxDailyLoss: 0.05, lotSize: 100, realTradingEnabled: false },
  };
}

describe("useTradingBackend reconnect order snapshots", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let backend: TradingBackend;
  let mounted: boolean;

  function Probe({ enabled = true }: { enabled?: boolean }) {
    backend = useTradingBackend({ enabled });
    return <pre>{JSON.stringify(backend.orders.map(({ id, status }) => ({ id, status })))}</pre>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
    vi.mocked(fetchTradingBootstrap).mockReset().mockResolvedValue(bootstrap());
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    client.setQueryData(["trading-bootstrap"], bootstrap());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function render(enabled = true) {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe enabled={enabled} /></QueryClientProvider>));
    await act(() => vi.advanceTimersByTimeAsync(1));
  }

  async function connect() {
    await render();
    const socket = MockWebSocket.instances[0];
    await act(async () => socket.emit("open"));
    return socket;
  }

  async function reconnect(socket: MockWebSocket) {
    await act(async () => {
      socket.emit("close", new CloseEvent("close", { code: 1006 }));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const next = MockWebSocket.instances.at(-1)!;
    expect(next).not.toBe(socket);
    await act(async () => next.emit("open"));
    return next;
  }

  async function receive(socket: MockWebSocket, type: string, data: unknown) {
    await act(async () => socket.receive(type, data));
    await act(() => vi.advanceTimersByTimeAsync(1));
  }

  it("replaces stale orders with filled, cancelled and new orders after reconnect", async () => {
    const socket = await reconnect(await connect());
    const previous = client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!;
    const latest = [order("new"), order("cancel", "cancelled"), order("fill", "filled")];
    await receive(socket, "orders.snapshot", latest);

    expect(backend.realtimeState).toBe("connected");
    expect(backend.orders).toEqual(latest);
    expect(container.textContent).not.toContain("removed");
    const updated = client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!;
    expect(updated.account).toBe(previous.account);
    expect(updated.positions).toBe(previous.positions);
    expect(updated.market).toBe(previous.market);
    expect(updated.limits).toBe(previous.limits);
    expect(fetchTradingBootstrap).not.toHaveBeenCalled();
  });

  it("replaces the entire list with empty after a disconnected account reset", async () => {
    const socket = await reconnect(await connect());
    await receive(socket, "orders.snapshot", []);

    expect(backend.orders).toEqual([]);
    expect(container.textContent).toBe("[]");
  });

  it("keeps subsequent incremental order updates and the existing 50-order limit", async () => {
    const socket = await reconnect(await connect());
    const latest = Array.from({ length: 50 }, (_, index) => order(`latest-${index}`));
    await receive(socket, "orders.snapshot", latest);
    await receive(socket, "order.updated", order("latest-20", "filled"));
    await receive(socket, "order.updated", order("newest"));

    expect(backend.orders).toHaveLength(50);
    expect(backend.orders[0].id).toBe("newest");
    expect(backend.orders.find((entry) => entry.id === "latest-20")?.status).toBe("filled");
    expect(backend.orders.some((entry) => entry.id === "latest-49")).toBe(false);
    expect(backend.orders.some((entry) => entry.id === "removed")).toBe(false);
  });

  it("ignores a retired socket's late snapshots and order updates", async () => {
    const first = await connect();
    const current = await reconnect(first);
    await receive(current, "orders.snapshot", [order("current")]);
    await receive(first, "orders.snapshot", [order("late")]);
    await receive(first, "order.updated", order("late-update"));

    expect(backend.orders).toEqual([order("current")]);
  });

  it("ignores snapshots and updates after unmount without changing the cache", async () => {
    const socket = await connect();
    await receive(socket, "orders.snapshot", [order("before-unmount")]);
    await act(async () => root.unmount());
    mounted = false;
    const previous = client.getQueryData(["trading-bootstrap"]);
    socket.receive("orders.snapshot", []);
    socket.receive("order.updated", order("late"));

    expect(client.getQueryData(["trading-bootstrap"])).toBe(previous);
  });

  it("ignores snapshots when authentication disables the backend", async () => {
    const socket = await connect();
    await receive(socket, "orders.snapshot", [order("before-disable")]);
    await render(false);
    const previous = client.getQueryData(["trading-bootstrap"]);
    socket.receive("orders.snapshot", []);

    expect(client.getQueryData(["trading-bootstrap"])).toBe(previous);
    expect(backend.orders).toEqual([]);
  });
});
