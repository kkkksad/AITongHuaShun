import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { fetchRecentOrders, fetchTradingBootstrap, resetPaperAccount, type TradingBootstrap } from "../lib/tradingApi";
import { useTradingBackend, type TradingBackend } from "./useTradingBackend";
import {
  dailyCandidatesQueryOptions,
  dailyMarketReviewQueryOptions,
  paperTradingPlanQueryOptions,
  realResearchNewsFeedQueryOptions,
  strategyLeaderboardQueryOptions,
  weeklyPaperReviewQueryOptions,
} from "../lib/researchQueries";

vi.mock("../lib/tradingApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/tradingApi")>(),
  fetchTradingBootstrap: vi.fn(),
  fetchRecentOrders: vi.fn(),
  resetPaperAccount: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

interface ResearchSample { accountEpoch: string }
interface ResearchDefinition {
  id: string;
  queryKey: QueryKey;
  read(signal: AbortSignal): Promise<ResearchSample>;
  placeholder?: boolean;
}

describe("useTradingBackend reconnect order snapshots", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let backend: TradingBackend;
  let mounted: boolean;
  let researchDefinitions: ResearchDefinition[];
  let researchResults: Map<string, UseQueryResult<ResearchSample>>;

  function ResearchProbe({ id, queryKey, read, placeholder }: ResearchDefinition) {
    const result = useQuery({
      queryKey,
      queryFn: ({ signal }) => read(signal),
      staleTime: Infinity,
      placeholderData: placeholder ? (previousData) => previousData : undefined,
    });
    researchResults.set(id, result);
    return <output data-research={id}>{JSON.stringify({ data: result.data, status: result.status })}</output>;
  }

  function Probe({ enabled = true }: { enabled?: boolean }) {
    backend = useTradingBackend({ enabled });
    return <>
      <pre>{JSON.stringify(backend.orders.map(({ id, status }) => ({ id, status })))}</pre>
      {researchDefinitions.map((definition) => <ResearchProbe key={definition.id} {...definition} />)}
    </>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
    vi.mocked(fetchTradingBootstrap).mockReset().mockResolvedValue(bootstrap());
    vi.mocked(fetchRecentOrders).mockReset();
    vi.mocked(resetPaperAccount).mockReset();
    researchDefinitions = [];
    researchResults = new Map();
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

  async function flush() { await act(() => vi.advanceTimersByTimeAsync(1)); }

  function research(id: string, queryKey: QueryKey, placeholder = false) {
    const next = deferred<ResearchSample>();
    const read = vi.fn<(signal: AbortSignal) => Promise<ResearchSample>>(() => next.promise);
    const definition = { id, queryKey, read, placeholder };
    return { definition, read, next };
  }

  function seedResearch(definition: ResearchDefinition) {
    const sample = { accountEpoch: `old-${definition.id}` };
    client.setQueryData(definition.queryKey, sample);
    return sample;
  }

  async function resetSuccessfully() {
    const account = { ...bootstrap().account, cash: 20_000, equity: 20_000 };
    vi.mocked(resetPaperAccount).mockResolvedValueOnce({ account, positions: [], orders: [] });
    await act(async () => backend.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", confirmation: "重置模拟账户" }));
    await flush();
  }

  function beginInitialRead() {
    client.removeQueries({ queryKey: ["trading-bootstrap"] });
    const read = deferred<TradingBootstrap>();
    vi.mocked(fetchTradingBootstrap).mockReturnValueOnce(read.promise);
    return read;
  }

  async function beginRefresh() {
    const read = deferred<TradingBootstrap>();
    vi.mocked(fetchTradingBootstrap).mockReturnValueOnce(read.promise);
    let completion!: Promise<void>;
    await act(async () => { completion = backend.refresh(); });
    return { ...read, completion };
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

  it("replays every early snapshot and order update over the first delayed bootstrap", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    const incoming = bootstrap([order("filled", "filled")]);
    incoming.market = { ...incoming.market, sequence: 2, mode: "mock" };
    incoming.account = { ...incoming.account, cash: 9_000 };
    incoming.positions = [{
      symbol: "600519", name: "本地测试", quantity: 100, availableQuantity: 0,
      averagePrice: 10, currentPrice: 10, marketValue: 1_000,
      unrealizedPnl: 0, realizedPnl: 0, weight: 0.1,
    }];
    await receive(socket, "market.snapshot", incoming.market);
    await receive(socket, "account.snapshot", incoming.account);
    await receive(socket, "positions.snapshot", incoming.positions);
    await receive(socket, "orders.snapshot", incoming.orders);
    await receive(socket, "order.updated", order("new"));
    await act(async () => read.resolve(bootstrap()));
    await flush();

    expect(backend.market).toEqual(incoming.market);
    expect(backend.account).toEqual(incoming.account);
    expect(backend.positions).toEqual(incoming.positions);
    expect(backend.orders).toEqual([order("new"), ...incoming.orders]);
    expect(backend.mode).toBe("mock");
    expect(fetchRecentOrders).not.toHaveBeenCalled();
  });

  it("uses the last full snapshot and preserves the subsequent incremental order", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    await receive(socket, "orders.snapshot", [order("discard")]);
    await receive(socket, "order.updated", order("discard-new"));
    await receive(socket, "orders.snapshot", [order("keep")]);
    await receive(socket, "order.updated", order("keep", "filled"));
    await receive(socket, "order.updated", order("keep-new"));
    await act(async () => read.resolve(bootstrap()));
    await flush();

    expect(backend.orders).toEqual([order("keep-new"), order("keep", "filled")]);
  });

  it("replays legacy order updates without a full snapshot and retains the 50-order bound", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    await receive(socket, "order.updated", order("fill", "filled"));
    await receive(socket, "order.updated", order("new"));
    await receive(socket, "order.updated", order("fill", "cancelled"));
    await act(async () => read.resolve(bootstrap(Array.from({ length: 50 }, (_, index) => order(index === 0 ? "fill" : `base-${index}`)))));
    await flush();

    expect(backend.orders).toHaveLength(50);
    expect(backend.orders[0]).toEqual(order("new"));
    expect(backend.orders[1]).toEqual(order("fill", "cancelled"));
    expect(fetchRecentOrders).not.toHaveBeenCalled();
  });

  it("protects live fields during refresh but allows a later REST read to advance", async () => {
    const socket = await connect();
    const read = await beginRefresh();
    const incoming = bootstrap([order("live")]);
    incoming.market = { ...incoming.market, sequence: 2 };
    incoming.account = { ...incoming.account, cash: 9_000 };
    await receive(socket, "market.snapshot", incoming.market);
    await receive(socket, "account.snapshot", incoming.account);
    await receive(socket, "orders.snapshot", incoming.orders);
    await act(async () => read.resolve(bootstrap()));
    await read.completion;
    await flush();
    expect(backend.market?.sequence).toBe(2);
    expect(backend.account?.cash).toBe(9_000);
    expect(backend.orders).toEqual(incoming.orders);

    const later = bootstrap([order("later-rest")]);
    later.market = { ...later.market, sequence: 3 };
    later.account = { ...later.account, cash: 8_000 };
    vi.mocked(fetchTradingBootstrap).mockResolvedValueOnce(later);
    await act(async () => backend.refresh());
    await flush();
    expect(backend.market?.sequence).toBe(3);
    expect(backend.account?.cash).toBe(8_000);
    expect(backend.orders).toEqual(later.orders);
  });

  it("keeps early events through an initial failure and retry", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    await receive(socket, "account.snapshot", { ...bootstrap().account, cash: 9_000 });
    await receive(socket, "orders.snapshot", [order("early")]);
    await act(async () => read.reject(new Error("initial fixture failure")));
    await flush();
    expect(backend.error).toContain("initial fixture failure");
    vi.mocked(fetchTradingBootstrap).mockResolvedValueOnce(bootstrap());
    await act(async () => backend.refresh());
    await flush();
    expect(backend.account?.cash).toBe(9_000);
    expect(backend.orders).toEqual([order("early")]);
    expect(backend.error).toBeUndefined();
  });

  it("finishes the first read after 1000 market events without restarting it", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    await act(async () => {
      for (let sequence = 2; sequence <= 1_001; sequence++) {
        socket.receive("market.snapshot", { ...bootstrap().market, sequence });
      }
    });
    expect(fetchTradingBootstrap).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve(bootstrap()));
    await flush();
    expect(backend.market?.sequence).toBe(1_001);
    expect(fetchTradingBootstrap).toHaveBeenCalledTimes(1);
  });

  it("cancels a disabled initial read and does not reuse its late result on re-enable", async () => {
    const read = beginInitialRead();
    const oldSocket = await connect();
    const signal = vi.mocked(fetchTradingBootstrap).mock.calls[0][0]!;
    await receive(oldSocket, "orders.snapshot", [order("old-session")]);
    await render(false);
    expect(signal.aborted).toBe(true);
    const fresh = bootstrap([order("fresh-session")]);
    vi.mocked(fetchTradingBootstrap).mockResolvedValueOnce(fresh);
    await render(true);
    await receive(oldSocket, "orders.snapshot", [order("late-old-session")]);
    await act(async () => read.resolve(bootstrap([order("late-rest")])));
    await flush();
    expect(backend.orders).toEqual(fresh.orders);
    expect(fetchTradingBootstrap).toHaveBeenCalledTimes(2);
  });

  it("treats cancellation of a refresh as lifecycle cleanup rather than a connection failure", async () => {
    await connect();
    const read = await beginRefresh();
    const completion = read.completion.catch((error: unknown) => error);
    await render(false);
    await act(async () => read.resolve(bootstrap([order("late")])));
    expect(await completion).toBeUndefined();
    await render(true);
    await flush();
    expect(backend.error).toBeUndefined();
  });

  it("starts a new reset epoch and ignores the old refresh and socket", async () => {
    const oldSocket = await connect();
    const read = await beginRefresh();
    const completion = read.completion.catch((error: unknown) => error);
    await receive(oldSocket, "orders.snapshot", [order("old-overlay")]);
    const account = { ...bootstrap().account, cash: 20_000, equity: 20_000 };
    vi.mocked(resetPaperAccount).mockResolvedValueOnce({ account, positions: [], orders: [] });
    await act(async () => backend.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", confirmation: "重置模拟账户" }));
    await receive(oldSocket, "orders.snapshot", [order("late-old-socket")]);
    await act(async () => read.resolve(bootstrap([order("late-old-rest")])));
    await completion;
    await flush();
    expect(backend.account).toEqual(account);
    expect(backend.orders).toEqual([]);
  });

  it("performs one bounded order catchup after a legacy pre-bootstrap buffer overflows", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`early-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    expect(backend.account).toBeDefined();
    expect(fetchTradingBootstrap).toHaveBeenCalledTimes(1);
    expect(fetchRecentOrders).toHaveBeenCalledTimes(1);
    expect(fetchRecentOrders).toHaveBeenCalledWith(expect.any(AbortSignal));
    await receive(socket, "order.updated", order("during-catchup"));
    await act(async () => catchup.resolve([order("authoritative")]));
    await flush();
    expect(backend.orders).toEqual([order("during-catchup"), order("authoritative")]);
    expect(backend.error).toBeUndefined();
  });

  it("reports a failed catchup honestly and accepts a later full snapshot", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`overflow-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    await act(async () => catchup.reject(new Error("fixture catchup failure")));
    await flush();
    expect(backend.error).toContain("订单");
    expect(backend.realtimeState).toBe("connected");
    expect(fetchRecentOrders).toHaveBeenCalledTimes(1);
    await receive(socket, "orders.snapshot", [order("recovered")]);
    expect(backend.orders).toEqual([order("recovered")]);
    expect(backend.error).toBeUndefined();
  });

  it("does not retry forever when the catchup itself overflows", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`first-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`second-${index}`));
      catchup.resolve([order("not-a-complete-view")]);
    });
    await flush();
    expect(fetchRecentOrders).toHaveBeenCalledTimes(1);
    expect(backend.error).toContain("订单");
    expect(backend.orders.some((entry) => entry.id === "not-a-complete-view")).toBe(false);
  });

  it("prevents a catchup from an old connection from replacing a newer handshake", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const first = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) first.receive("order.updated", order(`old-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    const current = await reconnect(first);
    await receive(current, "orders.snapshot", [order("new-connection")]);
    await act(async () => catchup.resolve([order("late-catchup")]));
    await flush();
    expect(backend.orders).toEqual([order("new-connection")]);
    expect(backend.error).toBeUndefined();
  });

  it("merges incremental updates into fresh REST orders instead of replacing them with the old cache", async () => {
    const socket = await connect();
    const read = await beginRefresh();
    await receive(socket, "order.updated", order("fill", "filled"));
    const fresh = bootstrap([order("server-new"), order("fill"), order("cancel")]);
    await act(async () => read.resolve(fresh));
    await read.completion;
    await flush();
    expect(backend.orders).toEqual([order("server-new"), order("fill", "filled"), order("cancel")]);
  });

  it("cancels a pending initial read on unmount even if the mocked transport ignores abort", async () => {
    const read = beginInitialRead();
    const socket = await connect();
    const signal = vi.mocked(fetchTradingBootstrap).mock.calls[0][0]!;
    await receive(socket, "orders.snapshot", [order("early")]);
    await act(async () => root.unmount());
    mounted = false;
    expect(signal.aborted).toBe(true);
    await act(async () => read.resolve(bootstrap([order("late")])));
    await flush();
    expect(client.getQueryData(["trading-bootstrap"])).toBeUndefined();
  });

  it("cancels an old catchup when authentication disables the backend", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`overflow-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    const signal = vi.mocked(fetchRecentOrders).mock.calls[0][0]!;
    await render(false);
    expect(signal.aborted).toBe(true);
    await act(async () => catchup.resolve([order("late-old-catchup")]));
    await flush();
    expect(client.getQueryData(["trading-bootstrap"])).toBeUndefined();
    expect(backend.error).toBeUndefined();
  });

  it("keeps a newer full snapshot when an older catchup fails", async () => {
    const read = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`overflow-${index}`));
    });
    await act(async () => read.resolve(bootstrap()));
    await flush();
    await receive(socket, "orders.snapshot", [order("fresh-handshake")]);
    await act(async () => catchup.reject(new Error("late obsolete failure")));
    await flush();
    expect(backend.orders).toEqual([order("fresh-handshake")]);
    expect(backend.error).toBeUndefined();
  });

  it("starts a fresh read window after reset without retaining the previous account overlay", async () => {
    const socket = await connect();
    await receive(socket, "account.snapshot", { ...bootstrap().account, cash: 9_000 });
    const account = { ...bootstrap().account, cash: 20_000, equity: 20_000 };
    vi.mocked(resetPaperAccount).mockResolvedValueOnce({ account, positions: [], orders: [] });
    await act(async () => backend.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", confirmation: "重置模拟账户" }));
    const next = bootstrap([]);
    next.account = { ...account, cash: 19_000 };
    vi.mocked(fetchTradingBootstrap).mockResolvedValueOnce(next);
    await act(async () => backend.refresh());
    await flush();
    expect(backend.account?.cash).toBe(19_000);
  });

  it("survives StrictMode's cancelled setup and accepts events in its current initial read", async () => {
    const first = beginInitialRead();
    const second = deferred<TradingBootstrap>();
    vi.mocked(fetchTradingBootstrap).mockReturnValueOnce(second.promise);
    await act(async () => root.render(
      <StrictMode><QueryClientProvider client={client}><Probe /></QueryClientProvider></StrictMode>,
    ));
    await flush();
    const socket = MockWebSocket.instances.at(-1)!;
    await act(async () => socket.emit("open"));
    await receive(socket, "orders.snapshot", [order("strict-current")]);
    await act(async () => { first.resolve(bootstrap([order("strict-old")])); second.resolve(bootstrap()); });
    await flush();
    expect(backend.orders).toEqual([order("strict-current")]);
    expect(backend.error).toBeUndefined();
  });

  it("reports a failed manual refresh after cancelling an unfinished order catchup", async () => {
    const initial = beginInitialRead();
    const catchup = deferred<OrderRecord[]>();
    vi.mocked(fetchRecentOrders).mockReturnValueOnce(catchup.promise);
    const socket = await connect();
    await act(async () => {
      for (let index = 0; index < 101; index++) socket.receive("order.updated", order(`overflow-${index}`));
      initial.resolve(bootstrap());
    });
    await flush();
    const refresh = await beginRefresh();
    const completion = refresh.completion.catch(() => undefined);
    await act(async () => refresh.reject(new Error("manual refresh fixture failure")));
    await completion;
    await flush();
    expect(backend.error).toContain("订单");
    expect(backend.error).toContain("失败");
    expect(backend.error).not.toContain("正在重新同步");
    expect(fetchRecentOrders).toHaveBeenCalledTimes(1);
  });

  it("retires the old socket synchronously at reset before React runs effect cleanup", async () => {
    const socket = await connect();
    const reset = deferred<Awaited<ReturnType<typeof resetPaperAccount>>>();
    vi.mocked(resetPaperAccount).mockReturnValueOnce(reset.promise);
    let completion!: Promise<void>;
    await act(async () => {
      completion = backend.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", confirmation: "重置模拟账户" });
    });
    await act(async () => {
      const account = { ...bootstrap().account, cash: 20_000, equity: 20_000 };
      reset.resolve({ account, positions: [], orders: [] });
      for (let index = 0; index < 20; index++) await Promise.resolve();
      expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.cash).toBe(20_000);
      socket.receive("account.snapshot", bootstrap().account);
      socket.receive("orders.snapshot", [order("old-queued-frame")]);
      expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.account.cash).toBe(20_000);
      expect(client.getQueryData<TradingBootstrap>(["trading-bootstrap"])!.orders).toEqual([]);
    });
    await completion;
  });

  it("clears active account research including previous-data placeholders without waiting for new reports", async () => {
    const queries = [
      research("plan", paperTradingPlanQueryOptions().queryKey, true),
      research("daily", dailyMarketReviewQueryOptions().queryKey, true),
      research("weekly", weeklyPaperReviewQueryOptions("previous").queryKey),
    ];
    researchDefinitions = queries.map(({ definition }) => definition);
    for (const definition of researchDefinitions) seedResearch(definition);
    await render();
    expect(container.textContent).toContain("old-plan");
    expect(container.textContent).toContain("old-daily");

    await resetSuccessfully();

    expect(backend.pendingAction).toBe(false);
    expect(backend.account?.cash).toBe(20_000);
    for (const { definition, read } of queries) {
      const result = researchResults.get(definition.id)!;
      expect(read).toHaveBeenCalledTimes(1);
      expect(result.data).toBeUndefined();
      expect(result.status).toBe("pending");
      expect(result.fetchStatus).toBe("fetching");
      expect(result.isPlaceholderData).toBe(false);
      expect(client.getQueryData(definition.queryKey)).toBeUndefined();
    }
    expect(container.textContent).not.toContain("old-");
  });

  it("clears every inactive weekly period while refetching only the currently observed period", async () => {
    const selected = research("selected-week", weeklyPaperReviewQueryOptions("previous").queryKey);
    const inactiveKeys: QueryKey[] = [
      weeklyPaperReviewQueryOptions("current").queryKey,
      ["weekly-paper-review", "archived-period"],
      ["weekly-paper-review", "current", "legacy-parameter"],
    ];
    researchDefinitions = [selected.definition];
    seedResearch(selected.definition);
    for (const queryKey of inactiveKeys) client.setQueryData(queryKey, { accountEpoch: "old-inactive" });
    await render();

    await resetSuccessfully();

    expect(selected.read).toHaveBeenCalledTimes(1);
    expect(researchResults.get("selected-week")?.data).toBeUndefined();
    expect(researchResults.has("selected-week")).toBe(true);
    for (const key of inactiveKeys) {
      expect(client.getQueryState(key)).toMatchObject({ data: undefined, status: "pending", fetchStatus: "idle" });
    }
  });

  it.each(["before-new", "after-new"])("ignores an aborted old research GET resolving %s account report", async (order) => {
    const plan = research("plan", paperTradingPlanQueryOptions().queryKey, true);
    const oldRead = deferred<ResearchSample>();
    plan.read.mockReturnValueOnce(oldRead.promise);
    researchDefinitions = [plan.definition];
    seedResearch(plan.definition);
    await render();
    await act(async () => { void researchResults.get("plan")!.refetch(); });
    const oldSignal = plan.read.mock.calls[0][0];

    await resetSuccessfully();

    expect(oldSignal.aborted).toBe(true);
    expect(plan.read).toHaveBeenCalledTimes(2);
    expect(plan.read.mock.calls[1][0].aborted).toBe(false);
    if (order === "before-new") {
      await act(async () => oldRead.resolve({ accountEpoch: "late-old-account" }));
      await flush();
      expect(researchResults.get("plan")?.data).toBeUndefined();
    }
    const latest = { accountEpoch: "new-account" };
    await act(async () => plan.next.resolve(latest));
    await flush();
    if (order === "after-new") {
      await act(async () => oldRead.resolve({ accountEpoch: "late-old-account" }));
      await flush();
    }
    expect(researchResults.get("plan")?.data).toEqual(latest);
    expect(client.getQueryData(plan.definition.queryKey)).toEqual(latest);
    expect(container.textContent).not.toContain("late-old");
  });

  it("keeps old account research cleared when the replacement report fails", async () => {
    const review = research("daily", dailyMarketReviewQueryOptions().queryKey, true);
    researchDefinitions = [review.definition];
    seedResearch(review.definition);
    await render();

    await resetSuccessfully();
    await act(async () => review.next.reject(new Error("new account report fixture failure")));
    await flush();

    expect(researchResults.get("daily")?.status).toBe("error");
    expect(researchResults.get("daily")?.data).toBeUndefined();
    expect(researchResults.get("daily")?.isPlaceholderData).toBe(false);
    expect(client.getQueryData(review.definition.queryKey)).toBeUndefined();
    expect(container.textContent).not.toContain("old-daily");
    expect(backend.pendingAction).toBe(false);
    expect(backend.notice).toContain("新的本地模拟");
  });

  it("refetches a previously unmounted account report without reviving its old placeholder", async () => {
    const plan = research("plan", paperTradingPlanQueryOptions().queryKey, true);
    seedResearch(plan.definition);
    researchDefinitions = [plan.definition];
    await render();
    researchDefinitions = [];
    await render();

    await resetSuccessfully();

    expect(plan.read).not.toHaveBeenCalled();
    expect(client.getQueryData(plan.definition.queryKey)).toBeUndefined();
    researchDefinitions = [plan.definition];
    await render();
    expect(plan.read).toHaveBeenCalledTimes(1);
    expect(researchResults.get("plan")?.data).toBeUndefined();
    expect(container.textContent).not.toContain("old-plan");
    await act(async () => plan.next.resolve({ accountEpoch: "new-mounted-account" }));
    await flush();
    expect(researchResults.get("plan")?.data?.accountEpoch).toBe("new-mounted-account");
  });

  it("cancels and clears an inactive weekly GET even when its transport ignores abort", async () => {
    const queryKey: QueryKey = weeklyPaperReviewQueryOptions("current").queryKey;
    const oldRead = deferred<ResearchSample>();
    const read = vi.fn<(context: { signal: AbortSignal }) => Promise<ResearchSample>>(() => oldRead.promise);
    client.setQueryData(queryKey, { accountEpoch: "old-inactive-week" });
    const completion = client.fetchQuery({ queryKey, queryFn: read, staleTime: 0 }).catch(() => undefined);
    await render();

    await resetSuccessfully();

    expect(read.mock.calls[0][0].signal.aborted).toBe(true);
    expect(client.getQueryState(queryKey)).toMatchObject({ data: undefined, status: "pending", fetchStatus: "idle" });
    await act(async () => oldRead.resolve({ accountEpoch: "late-inactive-old" }));
    await completion;
    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("preserves account research and existing requests when the account reset fails", async () => {
    const plan = research("plan", paperTradingPlanQueryOptions().queryKey, true);
    const old = seedResearch(plan.definition);
    const inactiveKey: QueryKey = weeklyPaperReviewQueryOptions("current").queryKey;
    const inactive = { accountEpoch: "untouched-inactive" };
    client.setQueryData(inactiveKey, inactive);
    researchDefinitions = [plan.definition];
    await render();
    await act(async () => { void researchResults.get("plan")!.refetch(); });
    vi.mocked(resetPaperAccount).mockRejectedValueOnce(new Error("reset fixture failure"));
    let failure: unknown;
    await act(async () => {
      try {
        await backend.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", confirmation: "重置模拟账户" });
      } catch (error) { failure = error; }
    });
    await flush();

    expect(failure).toBeInstanceOf(Error);
    expect(client.getQueryData(plan.definition.queryKey)).toBe(old);
    expect(client.getQueryData(inactiveKey)).toBe(inactive);
    expect(plan.read).toHaveBeenCalledTimes(1);
    expect(plan.read.mock.calls[0][0].aborted).toBe(false);
    expect(researchResults.get("plan")?.data).toBe(old);
    expect(backend.account?.cash).toBe(10_000);
  });

  it("preserves market research caches, in-flight news and unrelated strategy selection", async () => {
    const plan = research("plan", paperTradingPlanQueryOptions().queryKey, true);
    const market = [
      research("leaderboard", strategyLeaderboardQueryOptions().queryKey),
      research("candidates", dailyCandidatesQueryOptions().queryKey),
      research("news", realResearchNewsFeedQueryOptions().queryKey, true),
      research("quality", ["market-data-quality"]),
    ];
    researchDefinitions = [plan.definition, ...market.map(({ definition }) => definition)];
    seedResearch(plan.definition);
    const previous = market.map(({ definition }) => seedResearch(definition));
    const selection = { executionStrategy: "momentum", weeklyPeriod: "previous" };
    client.setQueryData(["research-strategy-selection"], selection);
    await render();
    await act(async () => { void researchResults.get("news")!.refetch(); });

    await resetSuccessfully();

    expect(plan.read).toHaveBeenCalledTimes(1);
    for (let index = 0; index < market.length; index++) {
      const { definition, read } = market[index];
      expect(client.getQueryData(definition.queryKey)).toBe(previous[index]);
      expect(researchResults.get(definition.id)?.data).toBe(previous[index]);
      expect(read).toHaveBeenCalledTimes(definition.id === "news" ? 1 : 0);
    }
    expect(market[2].read.mock.calls[0][0].aborted).toBe(false);
    expect(client.getQueryData(["research-strategy-selection"])).toBe(selection);
  });
});
