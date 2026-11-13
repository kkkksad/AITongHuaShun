import { describe, expect, it } from "vitest";
import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { runNextOpenPortfolioResearch } from "./nextOpenPortfolioResearch";

const symbol = "600001";
const costs = { commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0 };
const asOf = new Date("2025-06-10T08:00:00Z");

function daily(unavailableNextOpen = false): MarketSnapshot[] {
  return [2, 3, 4].map((day, index) => {
    const time = `2025-06-0${day}T15:00:00+08:00`;
    return { mode: "paper", sequence: index + 1, marketTime: time, quotes: [{ symbol, name: "contract fixture",
      price: 10, open: 10, high: 10, low: 10, previousClose: 10, changePercent: 0, volume: 10000,
      tradable: !(unavailableNextOpen && index === 1), updatedAt: time }] };
  });
}

function intent(fields: Record<string, unknown>): StrategySignal {
  return { symbol, side: "buy", type: "market", ...fields } as StrategySignal;
}

function run(onBar: (context: StrategyContext) => unknown, unavailableNextOpen = false) {
  const strategy: BacktestStrategy = { name: "runtime-contract-fixture", onBar: onBar as BacktestStrategy["onBar"] };
  return runNextOpenPortfolioResearch(daily(unavailableNextOpen), new Map([[symbol, strategy]]), costs, asOf);
}

const malformed: [string, Record<string, unknown>][] = [
  ["missing sizing", {}], ["unknown side", { side: "wrong", quantity: 100 }],
  ["missing side", { side: undefined, quantity: 100 }], ["null side", { side: null, quantity: 100 }],
  ["negative quantity", { quantity: -100 }], ["NaN quantity", { quantity: NaN }],
  ["infinite quantity", { quantity: Infinity }], ["null quantity", { quantity: null }],
  ["text quantity", { quantity: "100" }], ["negative weight", { targetWeight: -0.1 }],
  ["weight above one", { targetWeight: 1.1 }], ["NaN weight", { targetWeight: NaN }],
  ["infinite weight", { targetWeight: Infinity }], ["null weight", { targetWeight: null }],
  ["text weight", { targetWeight: "0.1" }],
  ["bad weight despite quantity priority", { quantity: 100, targetWeight: -0.1 }],
  ["bad quantity despite valid weight", { quantity: NaN, targetWeight: 0.1 }],
];

describe("native next-open research intent contract", () => {
  describe.each(["first close", "unavailable next open", "tail close"])("%s", phase => {
    it.each(malformed)("fails the study for %s instead of returning a zero-trade or rejected-order report", (_name, fields) => {
      const signal = intent(fields);
      expect(() => run(({ barIndex }) => barIndex === (phase === "tail close" ? 2 : 0) ? [signal] : [],
        phase === "unavailable next open")).toThrow(/异常|越界/);
    });
  });

  it.each([
    ["non-array undefined", undefined], ["non-array object", {}], ["empty element", [undefined]],
    ["null element", [null]], ["primitive element", ["buy"]], ["sparse array", new Array(1)],
    ["foreign symbol", [intent({ symbol: "600002", quantity: 100 })]],
    ["limit order", [intent({ type: "limit", quantity: 100, limitPrice: 10 })]],
    ["array disguised as signal", [Object.assign([], intent({ quantity: 100 }))]],
  ])("rejects %s even at the unexecuted final close", (_name, raw) => {
    expect(() => run(({ barIndex }) => barIndex === 2 ? raw : [])).toThrow(/异常|越界/);
  });

  it("validates an entire child batch before admitting any of it to pending", () => {
    const cashSeen: number[] = [];
    expect(() => run(({ barIndex, account }) => {
      cashSeen.push(account.cash);
      return barIndex === 0 ? [intent({ quantity: 100 }), intent({ quantity: -100 })] : [];
    })).toThrow(/异常|越界/);
    expect(cashSeen).toEqual([20000, 20000, 20000]);
  });

  it.each([
    ["zero quantity", { quantity: 0 }], ["zero weight", { targetWeight: 0 }],
    ["both zero", { quantity: 0, targetWeight: 0 }], ["negative zero", { quantity: -0, targetWeight: -0 }],
    ["fractional sub-lot", { quantity: 99.5 }], ["weight below one lot", { targetWeight: 0.001 }],
  ])("preserves legal no-op %s", (_name, fields) => {
    const result = run(({ barIndex }) => barIndex === 0 ? [intent(fields)] : []);
    expect(result.diagnostics.generatedSignals).toBe(1);
    expect(result.report.orders).toEqual([]);
    expect(result.report.trades).toEqual([]);
    expect(result.report.finalAccount.cash).toBe(20000);
  });

  it("preserves an empty signal array as a valid no-trade study", () => {
    const result = run(() => []);
    expect(result.diagnostics.generatedSignals).toBe(0);
    expect(result.report.orders).toEqual([]);
    expect(result.report.finalAccount.cash).toBe(20000);
  });

  it("keeps quantity-zero weight fallback and exact execution costs", () => {
    const result = run(({ barIndex }) => barIndex === 0 ? [intent({ quantity: 0, targetWeight: 0.1 })] : []);
    expect(result.report.trades).toMatchObject([{ quantity: 200, price: 10, commission: 5, side: "buy" }]);
    expect(result.report.finalAccount.cash).toBe(17995);
    expect(result.report.finalPositions).toMatchObject([{ quantity: 200 }]);
  });

  it.each([
    ["positive quantity priority", { quantity: 100, targetWeight: 0.2 }],
    ["fractional whole-lot rounding", { quantity: 150.5 }],
  ])("preserves %s", (_name, fields) => {
    const result = run(({ barIndex }) => barIndex === 0 ? [intent(fields)] : []);
    expect(result.report.trades).toMatchObject([{ quantity: 100, commission: 5 }]);
    expect(result.report.finalAccount.cash).toBe(18995);
  });

  it("retains legal risk rejections instead of misclassifying them as malformed research", () => {
    const result = run(({ barIndex }) => barIndex === 0 ? [intent({ targetWeight: 1 })] : []);
    expect(result.report.orders).toMatchObject([{ status: "rejected" }]);
    expect(result.report.trades).toEqual([]);
    expect(result.report.finalAccount.cash).toBe(20000);
  });

  it("retains the existing T+1 rejection for same-open buy and sell intents", () => {
    const result = run(({ barIndex }) => barIndex === 0 ? [intent({ quantity: 100 }), intent({ side: "sell", quantity: 100 })] : []);
    expect(result.report.trades.map(trade => trade.side)).toEqual(["buy"]);
    expect(result.report.orders.find(order => order.status === "rejected")?.rejectionReason).toMatch(/T\+1|可卖/);
    expect(result.report.finalAccount.cash).toBe(18995);
  });

  it("copies accepted signals once and leaves frozen child output untouched", () => {
    const signal = Object.freeze(intent({ quantity: 100 }));
    const signals = Object.freeze([signal]);
    const result = run(({ barIndex }) => barIndex === 0 ? signals : []);
    expect(result.report.trades).toMatchObject([{ quantity: 100 }]);
    expect(signal).toEqual(intent({ quantity: 100 }));
    expect(signals).toEqual([signal]);
  });

  it("keeps an accepted signal independent of the child's later object edits", () => {
    const signal = intent({ quantity: 100 });
    const result = run(({ barIndex }) => {
      if (barIndex === 0) return [signal];
      signal.side = "sell"; signal.quantity = 200;
      return [];
    });
    expect(result.report.trades).toMatchObject([{ side: "buy", quantity: 100 }]);
    expect(result.report.finalAccount.cash).toBe(18995);
  });
});
