import { describe, expect, it } from "vitest";
import type { MarketSnapshot, OrderRecord, PositionSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import { buildUnavailableStrategyLeaderboard } from "./strategyLeaderboard";

function plan(input: { cost?: number; price?: number; quantity?: number; locked?: number; available?: number;
  display?: Partial<PositionSnapshot>; quotePrice?: number; noQuote?: boolean; orders?: OrderRecord[] } = {}) {
  const cost = input.cost ?? 100, price = input.price ?? 97.01, quantity = input.quantity ?? 100;
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: "2026-11-12T02:00:00.000Z", quotes: input.noQuote ? [] : [{
    symbol: "601668", name: "测试持仓", tradable: true, price: input.quotePrice ?? price,
    previousClose: cost, changePercent: (price / cost - 1) * 100, volume: 10_000_000,
    updatedAt: "2026-11-12T02:00:00.000Z",
  }] };
  const position: PositionSnapshot = { symbol: "601668", name: "测试持仓", quantity,
    averagePrice: cost, currentPrice: price, marketValue: price * quantity,
    unrealizedPnl: (price - cost) * quantity, realizedPnl: 0, weight: 0.2,
    availableQuantity: input.available ?? quantity - (input.locked ?? 0), t1LockedQuantity: input.locked ?? 0,
    ...input.display,
  };
  return buildPaperTradingPlan({ snapshot, provider: "akshare", positions: [position],
    account: { accountId: "PAPER-CN-01", mode: "paper", cash: 10_000, equity: 20_000,
      marketValue: position.marketValue, unrealizedPnl: position.unrealizedPnl, realizedPnl: 0,
      dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0.2, paused: false, updatedAt: snapshot.marketTime },
    leaderboard: buildUnavailableStrategyLeaderboard(snapshot, "akshare"),
    candidates: { candidates: [] } as unknown as DailyCandidateReport,
    qualityStocks: { stocks: [] } as unknown as DailyQualityStockReport,
    initialCapital: 20_000, lotSize: 100, maxPositionWeight: 0.25, maxSingleOrderNotional: 5_000,
    commissionRate: 0.0003, minimumCommission: 5, cashReserveRatio: 0, orders: input.orders,
  });
}
const stops = (result: ReturnType<typeof plan>) => result.operations.filter(o => o.strategy === "回撤控制");

describe("Paper stop loss uses actual cost basis", () => {
  it("does not turn the actual 4.69 to 4.55 price decline into a 3% cost loss", () => {
    expect(stops(plan({ cost: 4.69, price: 4.55, quantity: 500 }))).toEqual([]);
  });
  it.each([97.01, 97.05, 97.08])("keeps price %s above the 3% cost threshold", price => {
    expect(stops(plan({ price }))).toEqual([]);
  });
  it.each([97, 96.99, 90])("stops at or below the 3% cost threshold: %s", price => {
    expect(stops(plan({ price }))).toEqual([expect.objectContaining({ action: "paper-sell-plan", quantity: 100 })]);
  });
  it.each([100, 500, 20_000])("keeps the same percentage for quantity=%s", quantity => {
    expect(stops(plan({ cost: 0.1, price: 0.09701, quantity }))).toEqual([]);
    expect(stops(plan({ cost: 0.1, price: 0.097, quantity }))).toHaveLength(1);
  });
  it("uses the current quote and actual average cost despite stale loss display fields", () => {
    expect(stops(plan({ price: 96, quotePrice: 100 }))).toEqual([]);
    expect(stops(plan({ price: 100, quotePrice: 96 }))).toHaveLength(1);
    expect(stops(plan({ price: 97.5, display: { unrealizedPnl: -1_000, marketValue: 1_000 } }))).toEqual([]);
  });
  it("uses the owned position price if no quote is present", () => {
    expect(stops(plan({ price: 97.01, noQuote: true }))).toEqual([]);
    expect(stops(plan({ price: 96.99, noQuote: true }))).toHaveLength(1);
  });
  it("retains T+1 for an actual cost stop and does not block a non-stop as T+1", () => {
    const locked = plan({ price: 96, locked: 100 });
    expect(stops(locked)).toEqual([]);
    expect(locked.operations).toEqual(expect.arrayContaining([expect.objectContaining({ action: "blocked", strategy: "A股 T+1 卖出检查" })]));
    expect(plan({ price: 97.01, locked: 100 }).operations.filter(o => o.strategy === "A股 T+1 卖出检查")).toEqual([]);
  });
  it("sells only available whole lots and keeps the hard stop after an earlier ordinary reduction", () => {
    const order = { id: "old-sale", symbol: "601668", side: "sell", type: "market", quantity: 100,
      status: "filled", createdAt: "2026-11-12T01:50:00.000Z", updatedAt: "2026-11-12T01:50:00.000Z",
      clientOrderId: "kairos-auto-paper:2026-11-12:601668:paper-sell-plan:100" } as OrderRecord;
    expect(stops(plan({ price: 96, quantity: 500, available: 250, locked: 250, orders: [order] })))
      .toEqual([expect.objectContaining({ action: "paper-sell-plan", quantity: 200 })]);
  });
  it.each([0, -1, NaN, Infinity])("does not invent a cost stop with invalid basis %s", cost => {
    expect(stops(plan({ cost, price: 1, display: { unrealizedPnl: -1_000, marketValue: 100 } }))).toEqual([]);
  });
});
