import { describe, expect, it } from "vitest";
import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { runNextOpenPortfolioResearch } from "./nextOpenPortfolioResearch";

function daily(prices = [10, 10, 10], symbols = ["600001"]): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = `2025-06-${String(2 + index).padStart(2, "0")}T15:00:00+08:00`;
    return { mode: "paper", sequence: index + 1, marketTime,
      quotes: symbols.map(symbol => ({ symbol, name: "fixture", price, open: price, high: price, low: price,
        previousClose: prices[Math.max(0, index - 1)], changePercent: 0, volume: 10000,
        tradable: true, updatedAt: marketTime })) };
  });
}
function child(symbol: string, onBar: (context: StrategyContext) => StrategySignal[]): BacktestStrategy {
  return { name: symbol, onBar };
}
const cost = { commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0 };
const asOf = new Date("2025-12-31T08:00:00Z");

describe("shared-capital next-open fixed strategy research", () => {
  it.each(["cycle-time", "origin-object", "origin-status"])("isolates a child's final entry %s edits from the shared report", field => {
    const makeChild = () => child("600001", ({ barIndex }) => barIndex === 0
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : []);
    const expected = runNextOpenPortfolioResearch(daily(), new Map([["600001", makeChild()]]), cost, asOf);
    const altered = makeChild();
    altered.onEnd = context => {
      const entry = context.positions[0].paperEntry!;
      if (field === "cycle-time") entry.openedAt = null;
      else if (field === "origin-object") entry.strategy = { status: "single", strategyKey: "rsi" };
      else entry.strategy.status = "mixed";
    };
    expect(runNextOpenPortfolioResearch(daily(), new Map([["600001", altered]]), cost, asOf)).toEqual(expected);
  });

  it("keeps a child's retained final evidence from changing a returned shared report", () => {
    let retained: StrategyContext | undefined;
    const makeChild = () => child("600001", ({ barIndex }) => barIndex === 0
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : []);
    const expected = runNextOpenPortfolioResearch(daily(), new Map([["600001", makeChild()]]), cost, asOf);
    const altered = makeChild(); altered.onEnd = context => { retained = context; };
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", altered]]), cost, asOf);
    expect(result).toEqual(expected);
    retained!.positions[0].paperEntry!.openedAt = null;
    retained!.positions[0].paperEntry!.strategy.status = "mixed";
    expect(result).toEqual(expected);
  });

  it("fills a completed-close signal at the following open, never that close", () => {
    const input = daily([10, 12, 11]); input[1].quotes[0].open = 13; input[1].quotes[0].high = 13;
    const result = runNextOpenPortfolioResearch(input, new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [])]]), cost, asOf);
    expect(result.report.trades).toMatchObject([{ price: 13, quantity: 100, time: "2025-06-03T09:30:00+08:00" }]);
    expect(result.report.finalAccount.cash).toBe(18695);
    expect(result.report.finalPositions[0].averagePrice).toBe(13);
  });

  it("shares one 20000 account across simultaneous candidates and pays actual fees", () => {
    const symbols = Array.from({ length: 6 }, (_, i) => `60000${i + 1}`);
    const result = runNextOpenPortfolioResearch(daily([10, 10, 10], symbols), new Map(symbols.map(symbol =>
      [symbol, child(symbol, ({ barIndex }) => barIndex === 0 ? [{ symbol, side: "buy", type: "market", quantity: 400 }] : [])])), cost, asOf);
    expect(result.report.trades).toHaveLength(4);
    expect(result.report.orders.filter(order => order.status === "rejected")).toHaveLength(2);
    expect(result.report.finalAccount).toMatchObject({ cash: 3980, equity: 19980 });
    expect(result.diagnostics.minimumObservedCash).toBe(3980);
    expect(result.report.metrics.totalCommission).toBe(20);
  });

  it("allows spending all affordable cash while reserving actual fees, with no fixed reserve", () => {
    const symbols = ["600001", "600002", "600003", "600004"];
    const result = runNextOpenPortfolioResearch(daily([9.99, 9.99, 9.99], symbols), new Map(symbols.map(symbol =>
      [symbol, child(symbol, ({ barIndex }) => barIndex === 0 ? [{ symbol, side: "buy", type: "market", quantity: 500 }] : [])])), cost, asOf);
    expect(result.report.trades).toHaveLength(4);
    expect(result.report.finalAccount.cash).toBe(0);
    expect(result.report.metrics.totalCommission).toBe(20);
  });

  it("keeps real costs and gaps when fills are delayed", () => {
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [])]]),
    { ...cost, minimumCommission: 10, slippageBps: 100 }, asOf);
    expect(result.report.trades[0]).toMatchObject({ price: 10.1, commission: 10 });
    expect(result.report.finalAccount.cash).toBe(18980);
  });

  it("uses Broker T+1 when buy and sell intents reach the same next open", () => {
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? ["buy", "sell"].map(side => ({ symbol: "600001", side: side as "buy" | "sell",
        type: "market", quantity: 100 })) : [])]]), cost, asOf);
    expect(result.report.trades.map(trade => trade.side)).toEqual(["buy"]);
    expect(result.report.orders.find(order => order.status === "rejected")?.rejectionReason).toMatch(/T\+1|可卖/);
    expect(result.report.finalPositions[0].quantity).toBe(100);
  });

  it("can close on the next trading day and includes both commissions in closed samples", () => {
    const result = runNextOpenPortfolioResearch(daily([10, 10, 11]), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex < 2 ? [{ symbol: "600001", side: barIndex === 0 ? "buy" : "sell", type: "market", quantity: 100 }] : [])]]), cost, asOf);
    expect(result.report.trades.map(trade => trade.side)).toEqual(["buy", "sell"]);
    expect(result.report.finalAccount.cash).toBe(20090);
    expect(result.report.finalPositions).toEqual([]);
    expect(result.report.metrics).toMatchObject({ winningTrades: 1, losingTrades: 0, totalCommission: 10 });
  });

  it("leaves unavailable next-open evidence unknown and does not retry it", () => {
    const input = daily(); input[1].quotes[0].tradable = false; input[1].quotes[0].volume = 0;
    const result = runNextOpenPortfolioResearch(input, new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [])]]), cost, asOf);
    expect(result.report.trades).toEqual([]);
    expect(result.report.orders).toEqual([]);
    expect(result.diagnostics).toMatchObject({ generatedSignals: 1, unexecutableNextOpenSignals: 1, tailSignals: 0 });
  });

  it("does not invent a quote when a queued symbol disappears", () => {
    const input = daily(); input[1].quotes = [];
    const result = runNextOpenPortfolioResearch(input, new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [])]]), cost, asOf);
    expect(result.report.trades).toEqual([]);
    expect(result.diagnostics).toMatchObject({ unexecutableNextOpenSignals: 1, missingCloseObservations: 1 });
  });

  it("keeps the final close intent unexecuted without force-liquidating or fabricating an outcome", () => {
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 2 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : [])]]), cost, asOf);
    expect(result.report.trades).toEqual([]);
    expect(result.diagnostics).toMatchObject({ generatedSignals: 1, tailSignals: 1 });
    expect(result.report.metrics.winningTrades + result.report.metrics.losingTrades).toBe(0);
  });

  it("preserves hard order caps, rejection state, and whole-lot alignment", () => {
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 600 }] : [])]]), cost, asOf);
    expect(result.report.orders).toMatchObject([{ status: "rejected" }]);
    expect(result.report.trades).toEqual([]);
    expect(result.report.finalPositions).toEqual([]);
    expect(result.report.finalAccount.cash).toBe(20000);
  });

  it("rejects an overnight gap through the order cap without silently shrinking the intent", () => {
    const input = daily(); input[1].quotes[0] = { ...input[1].quotes[0], open: 13, high: 13 };
    const result = runNextOpenPortfolioResearch(input, new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 400 }] : [])]]), cost, asOf);
    expect(result.report.orders).toMatchObject([{ quantity: 400, status: "rejected" }]);
    expect(result.report.trades).toEqual([]);
    expect(result.report.finalAccount.cash).toBe(20000);
  });

  it("enforces cumulative position weight instead of treating repeated entries as separate allowances", () => {
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", ({ barIndex }) =>
      barIndex < 2 ? [{ symbol: "600001", side: "buy", type: "market", quantity: 400 }] : [])]]), cost, asOf);
    expect(result.report.trades).toHaveLength(1);
    expect(result.report.finalPositions[0].quantity).toBe(400);
    expect(result.report.orders.filter(order => order.status === "rejected")).toHaveLength(1);
  });

  it("exposes funding-order sensitivity rather than concealing it as independent symbol results", () => {
    const symbols = Array.from({ length: 6 }, (_, i) => `60000${i + 1}`);
    const run = (ordered: string[]) => runNextOpenPortfolioResearch(daily([10, 10, 10], symbols), new Map(ordered.map(symbol =>
      [symbol, child(symbol, ({ barIndex }) => barIndex === 0 ? [{ symbol, side: "buy", type: "market", quantity: 400 }] : [])])), cost, asOf);
    expect(run(symbols).report.trades.map(trade => trade.symbol)).toEqual(symbols.slice(0, 4));
    expect(run([...symbols].reverse()).report.trades.map(trade => trade.symbol)).toEqual([...symbols].reverse().slice(0, 4));
  });

  it("only calls children on completed closes, with per-day indexes and their own symbol", () => {
    const seen: StrategyContext[] = [], starts: string[] = [];
    const strategies = new Map(["600001", "600002"].map(symbol => [symbol, {
      name: symbol, onStart: ({ snapshot }: Omit<StrategyContext, "barIndex" | "totalBars">) => { starts.push(snapshot.marketTime); },
      onBar: (context: StrategyContext) => { seen.push(context); return []; },
    }]));
    const result = runNextOpenPortfolioResearch(daily([10, 11, 12], [...strategies.keys()]), strategies, cost, asOf);
    expect(seen.map(context => context.barIndex)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(seen.every(context => context.totalBars === 3 && context.snapshot.marketTime.includes("T15:00") && context.snapshot.quotes.length === 1)).toBe(true);
    expect(starts).toEqual(["2025-06-02T15:00:00+08:00", "2025-06-02T15:00:00+08:00"]);
    expect(result.methodology.excludedMetrics).toContain("annualizedReturn");
    expect(result.report.metrics.barCount).toBe(6);
  });

  it("isolates sibling and caller observations from a child mutation", () => {
    const input = daily([10, 11, 12], ["600001", "600002"]), original = structuredClone(input);
    const seen: number[] = [];
    runNextOpenPortfolioResearch(input, new Map([
      ["600001", child("600001", context => {
        context.account.cash = 0; context.snapshot.quotes[0].price = 999;
        if (context.account.tradingDayPerformance) context.account.tradingDayPerformance.pnlPercent = -1;
        return [];
      })],
      ["600002", child("600002", context => { seen.push(context.account.cash, context.snapshot.quotes[0].price); return []; })],
    ]), cost, asOf);
    expect(seen).toEqual([20000, 10, 20000, 11, 20000, 12]);
    expect(input).toEqual(original);
  });

  it("does not allow a child to edit real held quantities or entry cost", () => {
    const seen: number[] = [];
    const result = runNextOpenPortfolioResearch(daily(), new Map([["600001", child("600001", context => {
      if (context.barIndex === 0) return [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }];
      const position = context.positions[0]; seen.push(position.quantity, position.averagePrice);
      position.quantity = 0; position.averagePrice = 999;
      return [];
    })]]), cost, asOf);
    expect(seen).toEqual([100, 10, 100, 10]);
    expect(result.report.finalPositions[0]).toMatchObject({ quantity: 100, averagePrice: 10 });
  });

  it.each([undefined, 0, NaN, Infinity])("rejects unavailable open %s instead of using the close", open => {
    const input = daily(); input[1].quotes[0].open = open;
    expect(() => runNextOpenPortfolioResearch(input, new Map([["600001", child("600001", () => [])]]), cost, asOf)).toThrow(/开盘/);
  });

  it("rejects invalid or incomplete temporal evidence", () => {
    const strategies = new Map([["600001", child("600001", () => [])]]);
    expect(() => runNextOpenPortfolioResearch(daily(), strategies, cost, new Date(NaN))).toThrow();
    expect(() => runNextOpenPortfolioResearch(daily(), strategies, cost, new Date("2025-06-04T06:59:59.999Z"))).toThrow();
    expect(() => runNextOpenPortfolioResearch(daily().reverse(), strategies, cost, asOf)).toThrow();
    const input = daily(); input[1].marketTime = "2025-06-03T14:59:00+08:00";
    expect(() => runNextOpenPortfolioResearch(input, strategies, cost, asOf)).toThrow();
  });

  it.each(["foreign-symbol", "limit", "throws"])("fails the study on child %s instead of counting it as no signal", problem => {
    const strategy = child("600001", () => {
      if (problem === "throws") throw Error("fixture");
      return [{ symbol: problem === "foreign-symbol" ? "600002" : "600001", side: "buy",
        type: problem === "limit" ? "limit" : "market", quantity: 100, limitPrice: 1 }];
    });
    expect(() => runNextOpenPortfolioResearch(daily(), new Map([["600001", strategy]]), cost, asOf)).toThrow(/异常|越界/);
  });

  it.each(["start", "end"])("fails on a child lifecycle %s error", phase => {
    const strategy = child("600001", () => []);
    if (phase === "start") strategy.onStart = () => { throw Error("fixture"); };
    else strategy.onEnd = () => { throw Error("fixture"); };
    expect(() => runNextOpenPortfolioResearch(daily(), new Map([["600001", strategy]]), cost, asOf)).toThrow(/异常/);
  });

  it("requires separate child instances and deterministic repeated results", () => {
    const strategy = child("600001", ({ barIndex }) => barIndex === 0
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }] : []);
    const strategies = new Map([["600001", strategy]]);
    const first = runNextOpenPortfolioResearch(daily(), strategies, cost, asOf);
    expect(runNextOpenPortfolioResearch(daily(), strategies, cost, asOf)).toEqual(first);
    expect(() => runNextOpenPortfolioResearch(daily(), new Map([["600001", strategy], ["600002", strategy]]), cost, asOf)).toThrow(/独立/);
  });
});
