import { describe, expect, it } from "vitest";
import type { BacktestStrategy } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";
import { HistoricalDataProvider } from "./HistoricalDataProvider";

function history(): MarketSnapshot[] {
  return [10, 11, 12].map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 9, 7)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol: "600001", name: "isolated history fixture", tradable: true, price,
      previousClose: price - 1, changePercent: 1, volume: 1_000,
      updatedAt: marketTime, open: price - 0.1, high: price + 0.1, low: price - 0.2,
      amount: 10_000, turnover: 0.2, amplitude: 3,
    }] };
  });
}

describe("historical provider owns its quote evidence", () => {
  it("keeps constructor evidence independent from later caller mutations", () => {
    const source = history(), original = structuredClone(source), provider = new HistoricalDataProvider(source);
    source[0].quotes[0].price = 1;
    source[1].quotes.length = 0;
    source.reverse();
    source.pop();
    expect(provider.length).toBe(3);
    expect(provider.getSnapshot()).toEqual(original[0]);
    expect(provider.tick()).toEqual(original[1]);
  });

  it("keeps returned quote objects and arrays independent from stored/input evidence", () => {
    const source = history(), saved = structuredClone(source), provider = new HistoricalDataProvider(source);
    const first = provider.getSnapshot(), second = provider.getSnapshot();
    first.marketTime = "invalid";
    first.quotes[0].price = -1;
    first.quotes.push({ ...first.quotes[0], symbol: "600002" });
    expect(second).toEqual(saved[0]);
    expect(provider.getSnapshot()).toEqual(saved[0]);
    expect(source).toEqual(saved);
  });

  it("breaks caller quote aliases between different bars", () => {
    const source = history();
    source[1].quotes = source[0].quotes;
    const provider = new HistoricalDataProvider(source);
    provider.getSnapshot().quotes[0].price = 123;
    provider.tick();
    expect(provider.getQuote("600001")?.price).toBe(10);
    provider.reset();
    expect(provider.getQuote("600001")?.price).toBe(10);
  });

  it("retains copied getQuote behavior and all optional scalar fields", () => {
    const source = history(), provider = new HistoricalDataProvider(source);
    const quote = provider.getQuote("600001")!;
    expect(quote).toEqual(source[0].quotes[0]);
    quote.high = -1;
    expect(provider.getQuote("600001")?.high).toBe(10.1);
    expect(provider.getQuote("missing")).toBeUndefined();
    expect(provider.getSnapshot()).toEqual(source[0]);
  });

  it("provides the same scalar clock through tick/seek/reset without exposing quotes", () => {
    const source = history(), provider = new HistoricalDataProvider(source);
    expect(provider.marketTime).toBe(source[0].marketTime);
    provider.tick();
    expect(provider.marketTime).toBe(source[1].marketTime);
    provider.seek(2);
    expect(provider.marketTime).toBe(source[2].marketTime);
    provider.reset();
    expect(provider.marketTime).toBe(source[0].marketTime);
  });

  it("does not let tick/seek return values alter replay or reset", () => {
    const source = history(), saved = structuredClone(source), provider = new HistoricalDataProvider(source);
    provider.tick().quotes.splice(0);
    expect(provider.getSnapshot()).toEqual(saved[1]);
    provider.seek(2).quotes[0].price = 123;
    expect(provider.getSnapshot()).toEqual(saved[2]);
    provider.reset();
    expect(provider.getSnapshot()).toEqual(saved[0]);
  });

  it("keeps event-listener mutations out of returned and stored snapshots", () => {
    const source = history(), saved = structuredClone(source), provider = new HistoricalDataProvider(source);
    const received: MarketSnapshot[] = [];
    provider.on("snapshot", (snapshot: MarketSnapshot) => {
      received.push(snapshot);
      snapshot.quotes[0].price = -1;
      snapshot.quotes.length = 0;
    });
    expect(provider.tick()).toEqual(saved[1]);
    expect(provider.seek(2)).toEqual(saved[2]);
    expect(provider.getSnapshot()).toEqual(saved[2]);
    expect(received).toHaveLength(2);
  });

  it("can own frozen input without freezing or rejecting returned working copies", () => {
    const source = history();
    source.forEach((snapshot) => { snapshot.quotes.forEach(Object.freeze); Object.freeze(snapshot.quotes); Object.freeze(snapshot); });
    Object.freeze(source);
    const provider = new HistoricalDataProvider(source);
    const value = provider.getSnapshot();
    expect(() => { value.quotes[0].price = -1; value.quotes.length = 0; }).not.toThrow();
    expect(provider.getQuote("600001")?.price).toBe(10);
  });

  it("keeps onStart quote mutations from changing actual fills or reused engine runs", () => {
    const source = history(), saved = structuredClone(source);
    const create = (mutate: boolean): BacktestStrategy => ({
      name: "history isolation fixture",
      onStart: ({ snapshot }) => { if (mutate) snapshot.quotes[0].price = 1; },
      onBar: ({ barIndex }) => barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [],
    });
    const config = { initialCapital: 10_000, maxOrderNotional: 10_000, maxPositionWeight: 1, maxDailyLoss: 1, slippageBps: 0 };
    const expected = new BacktestEngine(saved, create(false), config).run();
    const engine = new BacktestEngine(source, create(true), config);
    expect(engine.run()).toEqual(expected);
    expect(engine.run()).toEqual(expected);
    expect(source).toEqual(saved);
    expect(expected.trades[0].price).toBe(10);
  });
});
