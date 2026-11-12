import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { clearBridgeRequestCache } from "./bridgeRequest";
import { buildMarketRegimeResearch, type HistoricalBar } from "./marketRegimeResearch";

const now = new Date("2026-11-11T06:00:00Z");
const bars: HistoricalBar[] = Array.from({ length: 80 }, (_, index) => {
  const close = 10 + index * 0.02;
  return { date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
    open: close, high: close + 0.1, low: close - 0.1, close, volume: 100_000,
    amount: close * 100_000, changePercent: null, turnover: null };
});
const sectors = ["行业甲", "行业乙"].map((name, index) => ({
  symbol: `BK${index}`, name, price: 12, changePercent: 1, updatedAt: now.toISOString(),
  amount: null, turnover: null, advancers: 5, decliners: 2,
  leaderName: null, leaderChangePercent: null, mainNetInflow: null,
}));

function fixture(path: string) {
  const common = { provider: "akshare", source: "fixture", fetchedAt: now.toISOString(), warning: null };
  if (path.endsWith("/sectors")) return { ...common, sectors };
  return { ...common, series: path.endsWith("/stock-history")
    ? [{ symbol: "600010", name: "请求甲", source: "fixture", adjustment: "qfq", bars }]
    : sectors.map(row => ({ ...row, source: "fixture", adjustment: "none", bars })) };
}
function request(fetchImpl: typeof fetch) {
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: now.toISOString(), quotes: [] };
  return { now, snapshot, marketDataProvider: "akshare", mode: "paper" as const,
    bridgeUrl: "http://independent-history.test", timeoutMs: 1_000, days: 180,
    stockLimit: 1, sectorLimit: 2, preferredStocks: [{ symbol: "600010", name: "请求甲" }], fetchImpl };
}
function controlledSource(options: { stockFailure?: boolean; sectorFailure?: boolean; sectorHistoryFailure?: boolean } = {}) {
  const started: Array<{ path: string; at: number; search: string }> = [];
  const start = Date.now();
  const fetchImpl = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    const path = url.pathname;
    started.push({ path, at: Date.now() - start, search: url.search });
    const delay = path.endsWith("/sectors") ? 100 : path.endsWith("/stock-history") ? (options.stockFailure ? 10 : 200) : 50;
    await new Promise(resolve => setTimeout(resolve, delay));
    const failure = path.endsWith("/sectors") && options.sectorFailure ||
      path.endsWith("/stock-history") && options.stockFailure ||
      path.endsWith("/sector-history") && options.sectorHistoryFailure;
    if (failure) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify(fixture(path)));
  });
  return { fetchImpl, started };
}

beforeEach(() => { clearBridgeRequestCache(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); clearBridgeRequestCache(); });

describe("market regime stock universe and source ordering", () => {
  it("keeps sector evidence inside its response budget when cold stock work fills the shared two-slot queue", async () => {
    let active = 0;
    const queue: Array<() => void> = [];
    const schedule = () => {
      while (active < 2 && queue.length) {
        active++;
        const complete = queue.shift()!;
        setTimeout(() => { active--; complete(); schedule(); }, 100);
      }
    };
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/sectors")) {
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response(JSON.stringify(fixture(url.pathname)));
      }
      const stock = url.pathname.endsWith("/stock-history");
      const identities = stock ? url.searchParams.get("symbols")!.split(",") : sectors.map(row => row.symbol);
      const completed = new Set<string>();
      const jobs = identities.map(identity => new Promise<void>(resolve => {
        queue.push(() => { completed.add(identity); resolve(); }); schedule();
      }));
      // Scaled model of the bridge's partial-response budget; unfinished work
      // continues to own its slot, matching the existing cancellation contract.
      await Promise.race([Promise.all(jobs), new Promise(resolve => setTimeout(resolve, 600))]);
      const payload = fixture(url.pathname);
      return new Response(JSON.stringify({ ...payload, warning: completed.size < identities.length ? "History is warming" : null,
        series: stock ? identities.filter(identity => completed.has(identity)).map(symbol => ({
          symbol, name: symbol, source: "fixture", adjustment: "qfq", bars,
        })) : sectors.filter(row => completed.has(row.symbol)).map(row => ({ ...row, source: "fixture", adjustment: "none", bars })) }));
    });
    const input = { ...request(fetchImpl), stockLimit: 12,
      preferredStocks: Array.from({ length: 12 }, (_, index) => ({ symbol: String(600010 + index), name: String(index) })) };
    const pending = buildMarketRegimeResearch(input);
    await vi.advanceTimersByTimeAsync(900);
    const result = await pending;
    expect(result.sectorOutlooks).toHaveLength(2);
    expect(result.stockRegimes.length).toBeGreaterThan(0);
    expect(result.sourceStatus).toBe("live-read-only");
  });

  it("preserves sector discovery before queuing the independent history batches", async () => {
    const source = controlledSource();
    let elapsed: number | undefined;
    const pending = buildMarketRegimeResearch(request(source.fetchImpl)).then(result => {
      elapsed = Date.now() - now.getTime(); return result;
    });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(source.started.find(row => row.path.endsWith("/stock-history"))?.at).toBe(100);
    expect(source.started.find(row => row.path.endsWith("/sector-history"))?.at).toBe(100);
    expect(source.started.map(row => row.path)).toEqual([
      "/api/market/sectors", "/api/market/sector-history", "/api/market/stock-history",
    ]);
    expect(elapsed).toBe(300);
    expect(source.fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.sourceStatus).toBe("live-read-only");
    expect(result.stockRegimes[0]).toMatchObject({ symbol: "600010", barCount: 80 });
    expect(result.sectorOutlooks).toHaveLength(2);
    expect(result.generatedAt).toBe(now.toISOString());
  });

  it("keeps valid sector evidence when the independent stock batch fails", async () => {
    const source = controlledSource({ stockFailure: true });
    const pending = buildMarketRegimeResearch(request(source.fetchImpl));
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(result.stockRegimes).toEqual([]);
    expect(result.sectorOutlooks).toHaveLength(2);
    expect(result.sourceStatus).toBe("degraded");
    expect(result.warnings.join(" ")).toContain("股票历史日线暂不可用");
    expect(result.warnings.join(" ")).toContain("HTTP 503");
    expect(result.stockHistoryCoverage).toEqual({ scope: "regime-stock-history", asOf: now.toISOString(),
      selectedSymbols: ["600010"], returnedSymbols: [], acceptedSymbols: [], usableSymbols: [] });
  });

  it.each(["snapshot", "history"])("keeps independent stock evidence after sector %s fails", async failure => {
    const source = controlledSource({ sectorFailure: failure === "snapshot", sectorHistoryFailure: failure === "history" });
    const pending = buildMarketRegimeResearch(request(source.fetchImpl));
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(result.stockRegimes[0]).toMatchObject({ symbol: "600010", barCount: 80 });
    expect(result.sectorOutlooks).toEqual([]);
    expect(result.sourceStatus).toBe("degraded");
    expect(result.warnings.join(" ")).toContain(failure === "snapshot" ? "行业板块快照暂不可用" : "行业历史日线暂不可用");
    expect(source.fetchImpl).toHaveBeenCalledTimes(failure === "snapshot" ? 2 : 3);
  });

  it("does not request an empty stock universe", async () => {
    const source = controlledSource();
    const pending = buildMarketRegimeResearch({ ...request(source.fetchImpl), preferredStocks: [] });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(source.started.some(row => row.path.endsWith("/stock-history"))).toBe(false);
    expect(source.fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.warnings).toContain("当前快照没有可查询股票。");
    expect(result.stockHistoryCoverage?.selectedSymbols).toEqual([]);
  });

  it("shares all three source requests across simultaneous identical readers", async () => {
    const source = controlledSource();
    const input = request(source.fetchImpl);
    const pending = Promise.all([buildMarketRegimeResearch(input), buildMarketRegimeResearch(input)]);
    await vi.advanceTimersByTimeAsync(300);
    const [first, second] = await pending;
    expect(source.fetchImpl).toHaveBeenCalledTimes(3);
    expect(second).toEqual(first);
    expect(source.started.find(row => row.path.endsWith("/stock-history"))?.at).toBe(100);
  });

  it("fixes the requested stock universe before waiting for the independent sector snapshot", async () => {
    const source = controlledSource();
    const input = request(source.fetchImpl);
    const pending = buildMarketRegimeResearch(input);
    await vi.advanceTimersByTimeAsync(50);
    input.preferredStocks[0] = { symbol: "600011", name: "迟到请求" };
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;
    expect(source.started.find(row => row.path.endsWith("/stock-history"))?.search).toContain("600010");
    expect(result.stockRegimes[0]).toMatchObject({ symbol: "600010", name: "请求甲" });
    expect(result.stockHistoryCoverage).toEqual({ scope: "regime-stock-history", asOf: now.toISOString(),
      selectedSymbols: ["600010"], returnedSymbols: ["600010"], acceptedSymbols: ["600010"], usableSymbols: ["600010"] });
    expect(source.fetchImpl).toHaveBeenCalledTimes(3);
  });
});
