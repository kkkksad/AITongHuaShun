import { describe, expect, it, vi } from "vitest";
import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";

function history(): MarketSnapshot[] {
  return [10, 11, 12, 13].map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 9, 7)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{ symbol: "600001", name: "context fixture",
      tradable: true, price, previousClose: price - 1, changePercent: 1, volume: 100_000, updatedAt: marketTime }] };
  });
}
const config = { initialCapital: 10_000, maxOrderNotional: 10_000, maxPositionWeight: 1, maxDailyLoss: 1,
  minimumCommission: 5, slippageBps: 0 };
function signals(barIndex: number): StrategySignal[] {
  return barIndex === 0 ? [{ symbol: "600001", side: "buy", type: "market", targetWeight: 0.2 }]
    : barIndex === 2 ? [{ symbol: "600001", side: "sell", type: "market", targetWeight: 1 }] : [];
}
function strategy(onBar: BacktestStrategy["onBar"] = context => signals(context.barIndex),
  onEnd?: BacktestStrategy["onEnd"]): BacktestStrategy {
  return { name: "callback isolation fixture", onBar, onEnd };
}
function run(onBar?: BacktestStrategy["onBar"], onEnd?: BacktestStrategy["onEnd"]) {
  return new BacktestEngine(history(), strategy(onBar, onEnd), config).run();
}

describe("BacktestEngine strategy callback input ownership", () => {
  it("keeps changed quote prices out of current-bar valuations and final metrics", () => {
    const expected = run();
    const result = run(context => {
      context.snapshot.quotes[0].price = 100_000;
      return signals(context.barIndex);
    });
    expect(result).toEqual(expected);
  });

  it("keeps a callback's timestamp edits out of fills and the equity timeline", () => {
    const expected = run();
    const result = run(context => {
      context.snapshot.marketTime = "2099-01-01T00:00:00Z";
      context.snapshot.quotes[0].updatedAt = "invalid";
      return signals(context.barIndex);
    });
    expect(result).toEqual(expected);
  });

  it("keeps quote-array edits out of an existing position's valuation", () => {
    expect(run(context => { if (context.barIndex === 1) context.snapshot.quotes.length = 0;
      return signals(context.barIndex); })).toEqual(run());
  });

  it("uses the engine account for target-weight quantities after callback edits", () => {
    expect(run(context => { context.account.equity = 0; context.account.cash = 0; context.equity = 0; context.cash = 0;
      return signals(context.barIndex); })).toEqual(run());
  });

  it("uses actual engine positions for sell sizing after callback edits", () => {
    expect(run(context => { for (const position of context.positions) position.quantity = 0;
      context.positions.length = 0; return signals(context.barIndex); })).toEqual(run());
  });

  it("keeps failed callback edits from changing valuations", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(run(context => {
        if (context.barIndex === 1) { context.snapshot.quotes[0].price = 1; throw new Error("controlled callback failure"); }
        return signals(context.barIndex);
      })).toEqual(run());
      expect(log).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it("keeps onEnd account and nested daily performance edits out of the final report", () => {
    expect(run(undefined, context => { context.account.equity = 1; context.account.cash = 2;
      if (context.account.tradingDayPerformance) context.account.tradingDayPerformance.openingEquity = 3;
    })).toEqual(run());
  });

  it("keeps onEnd position field and array edits out of an open-position report", () => {
    const buyOnly = (context: StrategyContext) => context.barIndex === 0 ? signals(0) : [];
    expect(run(buyOnly, context => { context.positions[0].quantity = 1; context.positions[0].averagePrice = 0;
      context.positions.length = 0; })).toEqual(run(buyOnly));
  });

  it("keeps retained callback inputs independent of reports and repeat engine runs", () => {
    const contexts: StrategyContext[] = [], source = history(), saved = structuredClone(source);
    const engine = new BacktestEngine(source, strategy(context => { contexts.push(context); return signals(context.barIndex); },
      context => { contexts.push(context); }), config);
    const report = engine.run(), expected = run();
    expect(report).toEqual(expected);
    for (const context of contexts) { context.account.equity = 0; context.snapshot.quotes.length = 0;
      if (context.account.tradingDayPerformance) context.account.tradingDayPerformance.pnl = -1_000_000;
      context.positions.length = 0; }
    expect(report).toEqual(expected);
    expect(engine.run()).toEqual(expected);
    expect(source).toEqual(saved);
  });
});
