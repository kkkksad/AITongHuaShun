import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { buildWeeklyPaperReview } from "./weeklyPaperReview";

function order(fields: Partial<OrderRecord>): OrderRecord {
  const price = fields.filledPrice ?? 10;
  return {
    id: "carry-fill", symbol: "600010", side: "buy", type: "limit", quantity: 100,
    status: "filled", requestedPrice: price, filledPrice: price, filledQuantity: 100,
    notional: price * 100, commission: 5, createdAt: "2026-08-21T02:00:00.000Z",
    updatedAt: "2026-08-24T02:00:00.000Z", ...fields,
  };
}

function review(orders: OrderRecord[], now = "2026-08-29T10:00:00+08:00") {
  return buildWeeklyPaperReview({
    now: new Date(now), initialCapital: 20000, historyRetentionDays: 30,
    account: { equity: 20000, cash: 15000, marketValue: 5000 }, orders, auditEvents: [],
  });
}

describe("weekly review actual fill activity", () => {
  it.each([true, false])("includes a prior-week submission filled this week, explicit=%s", (explicit) => {
    const result = review([order(explicit ? { filledAt: "2026-08-24T02:00:00Z" } : {})]);
    expect(result.sample).toMatchObject({ orderCount: 0, filledOrderCount: 1,
      activeDays: 1, daysWithFills: 1, evidence: "limited" });
    expect(result.capital).toMatchObject({ grossBuyNotional: 1000, grossTurnover: 1000 });
    expect(result.daily.find((day) => day.date === "2026-08-24"))
      .toMatchObject({ submitted: 0, filled: 1, buyNotional: 1000, commission: 5 });
    expect(result.period.orderDays).toEqual(["2026-08-24"]);
    expect(result.diagnosis.findings.join(" ")).not.toContain("没有本地 Paper 订单记录");
  });

  it("keeps this week's submission separate from a fill next week", () => {
    const result = review([order({
      createdAt: "2026-08-24T02:00:00Z", filledAt: "2026-08-31T02:00:00Z",
    })]);
    expect(result.sample).toMatchObject({ orderCount: 1, filledOrderCount: 0, daysWithFills: 0 });
    expect(result.capital.grossTurnover).toBe(0);
    expect(result.performance.commission).toBe(0);
  });

  it("uses explicit fill day despite a subsequent metadata update", () => {
    const result = review([order({
      createdAt: "2026-08-24T02:00:00Z", filledAt: "2026-08-25T02:00:00Z",
      updatedAt: "2026-08-31T02:00:00Z",
    })]);
    expect(result.daily.find((day) => day.date === "2026-08-24"))
      .toMatchObject({ submitted: 1, filled: 0, commission: 0 });
    expect(result.daily.find((day) => day.date === "2026-08-25"))
      .toMatchObject({ submitted: 0, filled: 1, commission: 5 });
    expect(result.period.orderDays).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("uses the Beijing week boundary at Sunday UTC 16:00", () => {
    const result = review([
      order({ id: "before", filledAt: "2026-08-23T15:59:59.999Z" }),
      order({ id: "after", filledAt: "2026-08-23T16:00:00.000Z" }),
    ]);
    expect(result.sample.filledOrderCount).toBe(1);
    expect(result.daily[0]).toMatchObject({ date: "2026-08-24", filled: 1, buyNotional: 1000 });
  });

  it("pairs FIFO by fill time when older limit orders fill later", () => {
    const result = review([
      order({ id: "older-limit", createdAt: "2026-08-20T02:00:00Z", filledAt: "2026-08-26T02:00:00Z", filledPrice: 20 }),
      order({ id: "earlier-fill", createdAt: "2026-08-21T02:00:00Z", filledAt: "2026-08-24T02:00:00Z", filledPrice: 10 }),
      order({ id: "sell", side: "sell", createdAt: "2026-08-25T02:00:00Z", filledAt: "2026-08-25T02:00:00Z", filledPrice: 15 }),
    ]);
    expect(result.performance).toMatchObject({ closedTrades: 1, winningTrades: 1,
      losingTrades: 0, realizedPnl: 490, winRate: 1 });
  });

  it("never matches a sell to a buy whose fill happens afterwards", () => {
    const result = review([
      order({ id: "later-buy", createdAt: "2026-08-20T02:00:00Z", filledAt: "2026-08-27T02:00:00Z" }),
      order({ id: "earlier-sell", side: "sell", createdAt: "2026-08-25T02:00:00Z", filledAt: "2026-08-25T02:00:00Z", filledPrice: 15 }),
    ]);
    expect(result.performance).toMatchObject({ closedTrades: 0, winRate: null, realizedPnl: 0 });
    expect(result.diagnosis.findings.join(" ")).toContain("100 股卖出缺少此前买入记录");
  });

  it("attributes a sell's closed FIFO fragment to its fill week", () => {
    const result = review([
      order({ id: "buy", createdAt: "2026-08-20T02:00:00Z", filledAt: "2026-08-20T02:00:00Z" }),
      order({ id: "sell", side: "sell", filledAt: "2026-08-24T02:00:00Z", filledPrice: 11 }),
    ]);
    expect(result.sample).toMatchObject({ orderCount: 0, filledOrderCount: 1, evidence: "sufficient" });
    expect(result.performance).toMatchObject({ closedTrades: 1, realizedPnl: 90, commission: 5 });
  });

  it("orders equivalent ISO formats by their actual instant", () => {
    const result = review([
      order({ id: "second-buy", createdAt: "2026-08-20T02:00:00Z", filledAt: "2026-08-24T02:30:00Z", filledPrice: 20 }),
      order({ id: "first-buy", createdAt: "2026-08-21T02:00:00Z", filledAt: "2026-08-24T10:00:00+08:00", filledPrice: 10 }),
      order({ id: "sell", side: "sell", createdAt: "2026-08-25T02:00:00Z", filledAt: "2026-08-25T02:00:00Z", filledPrice: 15 }),
    ]);
    expect(result.performance.realizedPnl).toBe(490);
  });

  it("reports ambiguous same-millisecond fills instead of guessing FIFO profits", () => {
    const result = review([
      order({ id: "first", filledAt: "2026-08-24T02:00:00Z", filledPrice: 10 }),
      order({ id: "second", createdAt: "2026-08-21T02:01:00Z", filledAt: "2026-08-24T10:00:00+08:00", filledPrice: 20 }),
      order({ id: "sell", side: "sell", filledAt: "2026-08-25T02:00:00Z", filledPrice: 15 }),
    ]);
    expect(result.sample).toMatchObject({ filledOrderCount: 3, evidence: "limited" });
    expect(result.performance).toMatchObject({ closedTrades: 0, realizedPnl: 0, winRate: null });
    expect(result.diagnosis.findings.join(" ")).toContain("同毫秒成交先后无法确认");
  });

  it("isolates symbols with unknown fill times while keeping other evidenced pairs", () => {
    const result = review([
      order({ id: "unknown-time", filledAt: "invalid" }),
      order({ id: "uncertain-buy", filledAt: "2026-08-24T02:00:00Z" }),
      order({ id: "uncertain-sell", side: "sell", filledAt: "2026-08-25T02:00:00Z", filledPrice: 15 }),
      order({ id: "known-buy", symbol: "600011", filledAt: "2026-08-24T02:00:00Z" }),
      order({ id: "known-sell", symbol: "600011", side: "sell", filledAt: "2026-08-25T02:00:00Z", filledPrice: 11 }),
    ]);
    expect(result.sample).toMatchObject({ filledOrderCount: 4, evidence: "limited" });
    expect(result.performance).toMatchObject({ closedTrades: 1, realizedPnl: 90 });
    expect(result.diagnosis.findings.join(" ")).toContain("1 笔保留成交记录的时间无法确认");
  });

  it("excludes same-day fill timestamps later than the report cutoff", () => {
    const result = review([order({
      createdAt: "2026-08-28T01:00:00Z", filledAt: "2026-08-28T03:00:00Z",
    })], "2026-08-28T02:00:00Z");
    expect(result.sample).toMatchObject({ orderCount: 1, filledOrderCount: 0 });
    expect(result.capital.grossTurnover).toBe(0);
  });
});
