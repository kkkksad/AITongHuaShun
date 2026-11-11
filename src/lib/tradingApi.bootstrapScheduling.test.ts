import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTradingBootstrap, notifyAuthExpired } from "./tradingApi";

const payloads: Record<string, unknown> = {
  "/api/health": { ok: true, mode: "paper" },
  "/api/capabilities": { realTradingEnabled: false },
  "/api/market/snapshot": { mode: "paper", sequence: 42, quotes: [] },
  "/api/account": { cash: 13992 },
  "/api/positions": [{ symbol: "600010", quantity: 100 }],
  "/api/orders?limit=50": [{ id: "existing-paper-fill" }],
  "/api/risk/limits": { lotSize: 100 },
};

beforeEach(() => { notifyAuthExpired(); vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function source(options: { slowMarket?: boolean; failure?: string } = {}) {
  const starts: Array<{ path: string; time: number; init?: RequestInit }> = [];
  const aborted: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(input), "http://bootstrap.test");
    const path = parsed.pathname + parsed.search;
    starts.push({ path, time: Date.now(), init });
    const delay = path === "/api/health" || path === "/api/capabilities" ? 100
      : path === "/api/market/snapshot" && options.slowMarket ? 200 : 50;
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); aborted.push(path); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", stop); resolve(); }, delay);
      if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
    });
    return new Response(JSON.stringify(path === options.failure ? { message: "fixture unavailable" } : payloads[path]), {
      status: path === options.failure ? 503 : 200, headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { starts, aborted };
}

describe("trading bootstrap independent reads", () => {
  it("starts all seven reads together and removes the extra 50ms wave after status", async () => {
    const fixture = source(); let completedAt: number | undefined;
    const pending = fetchTradingBootstrap().then(report => { completedAt = Date.now(); return report; });
    await vi.advanceTimersByTimeAsync(150);
    const report = await pending;
    expect(fixture.starts.map(row => row.path).sort()).toEqual(Object.keys(payloads).sort());
    expect(fixture.starts.every(row => row.time === 0)).toBe(true);
    expect(completedAt).toBe(100);
    expect(report).toEqual({ health: payloads["/api/health"], capabilities: payloads["/api/capabilities"],
      market: payloads["/api/market/snapshot"], account: payloads["/api/account"], positions: payloads["/api/positions"],
      orders: payloads["/api/orders?limit=50"], limits: payloads["/api/risk/limits"] });
    for (const row of fixture.starts) {
      expect(row.init?.credentials).toBe("include");
      expect(row.init?.method ?? "GET").toBe("GET");
      expect(row.init?.body).toBeUndefined();
    }
  });

  it("waits for a slower business snapshot before returning a complete bootstrap", async () => {
    source({ slowMarket: true }); let completedAt: number | undefined;
    const pending = fetchTradingBootstrap().then(report => { completedAt = Date.now(); return report; });
    await vi.advanceTimersByTimeAsync(199);
    expect(completedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).market.sequence).toBe(42);
    expect(completedAt).toBe(200);
  });

  it("cancels every started read with the same caller signal", async () => {
    const fixture = source(); const controller = new AbortController();
    const pending = fetchTradingBootstrap(controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(20); controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).name).toBe("AbortError");
    expect(fixture.aborted.sort()).toEqual(Object.keys(payloads).sort());
    expect(fixture.starts.every(row => row.init?.signal === controller.signal)).toBe(true);
  });

  it("rejects the whole bootstrap when a required snapshot fails", async () => {
    const fixture = source({ failure: "/api/account" });
    const pending = fetchTradingBootstrap().then(() => "unexpected-success", error => error);
    await vi.advanceTimersByTimeAsync(150);
    expect((await pending).message).toBe("fixture unavailable");
    expect(fixture.starts).toHaveLength(7);
  });
});
