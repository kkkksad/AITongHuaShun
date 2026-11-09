import { describe, expect, it } from "vitest";
import type { AuditEvent, OrderRecord } from "../../shared/trading";
import { buildWeeklyPaperReview } from "./weeklyPaperReview";

function fill(fields: Partial<OrderRecord> = {}): OrderRecord {
  return { id: "buy", symbol: "600010", side: "buy", type: "market", quantity: 100,
    status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
    notional: 1000, commission: 5, createdAt: "2026-08-24T02:00:00Z",
    filledAt: "2026-08-24T02:00:00Z", updatedAt: "2026-08-24T02:00:00Z", ...fields };
}

function decision(data: Record<string, unknown>): AuditEvent {
  return { id: "decision", category: "system", action: "paper-auto-execution.decision",
    message: "decision", timestamp: "2026-08-24T02:00:00Z", data };
}

function review(order: OrderRecord, audits: AuditEvent[] = [], extra: OrderRecord[] = []) {
  return buildWeeklyPaperReview({ now: new Date("2026-08-28T07:00:00Z"), initialCapital: 20000,
    historyRetentionDays: 30, account: { equity: 20000, cash: 20000, marketValue: 0 },
    orders: [order, ...extra], auditEvents: audits });
}

describe("weekly order strategy provenance", () => {
  it("uses stored strategy after decision audits have been pruned", () => {
    const result = review(fill({ strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" }));
    expect(result.strategyBreakdown).toMatchObject([{ strategyKey: "kairosTrendHealth",
      strategyName: "KAIROS趋势健康", filledOrders: 1, filledNotional: 1000 }]);
  });

  it("prefers stored identity over conflicting decision audits", () => {
    const result = review(fill({ strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" }),
      [decision({ orderId: "buy", strategyKey: "rsi", strategy: "RSI" })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "kairosTrendHealth", strategyName: "KAIROS趋势健康" });
  });

  it("does not pair a stored key with a conflicting audit name", () => {
    const result = review(fill({ strategyKey: "kairosTrendHealth" }),
      [decision({ orderId: "buy", strategyKey: "rsi", strategy: "RSI" })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "kairosTrendHealth", strategyName: "kairosTrendHealth" });
  });

  it("can supply a missing name from an audit with the same key", () => {
    const result = review(fill({ strategyKey: " kairosTrendHealth " }),
      [decision({ orderId: "buy", strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "kairosTrendHealth", strategyName: "KAIROS趋势健康" });
  });

  it("keeps stored names without inventing a key from a different audit strategy", () => {
    const result = review(fill({ strategy: "KAIROS趋势健康" }),
      [decision({ orderId: "buy", strategyKey: "rsi", strategy: "RSI" })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "unattributed:KAIROS趋势健康", strategyName: "KAIROS趋势健康" });
  });

  it("can supply a missing key from an audit with the same name", () => {
    const result = review(fill({ strategy: "KAIROS趋势健康" }),
      [decision({ orderId: "buy", strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "kairosTrendHealth", strategyName: "KAIROS趋势健康" });
  });

  it("retains legacy audit and rule-check fallback by client order id", () => {
    const result = review(fill({ strategy: "  ", strategyKey: " ", clientOrderId: "legacy-client" }),
      [decision({ clientOrderId: "legacy-client", strategy: "RSI", ruleChecks: ["strategy-route: pass (rsi)"] })]);
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "rsi", strategyName: "RSI" });
  });

  it("leaves entirely undocumented orders unknown", () => {
    const result = review(fill());
    expect(result.strategyBreakdown[0]).toMatchObject({ strategyKey: "unknown", strategyName: "未记录策略" });
  });

  it("keeps different stored names separate when canonical strategy keys are unknown", () => {
    const result = review(fill({ strategy: "旧策略甲" }), [], [fill({ id: "another", symbol: "600011", strategy: "旧策略乙" })]);
    expect(result.strategyBreakdown).toHaveLength(2);
    expect(new Set(result.strategyBreakdown.map((row) => row.strategyKey)))
      .toEqual(new Set(["unattributed:旧策略乙", "unattributed:旧策略甲"]));
    expect(result.strategyBreakdown.every((row) => row.filledOrders === 1)).toBe(true);
  });

  it("attributes net FIFO profit to the stored entry strategy and fill counts to each order", () => {
    const buy = fill({ strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" });
    const sell = fill({ id: "sell", side: "sell", filledPrice: 11, notional: 1100,
      strategyKey: "risk-exit", strategy: "市场状态减仓", filledAt: "2026-08-25T02:00:00Z" });
    const result = review(buy, [], [sell]);
    expect(result.strategyBreakdown.find((row) => row.strategyKey === "kairosTrendHealth"))
      .toMatchObject({ filledOrders: 1, buyOrders: 1, sellOrders: 0, closedTrades: 1, realizedPnl: 90, winRate: 1 });
    expect(result.strategyBreakdown.find((row) => row.strategyKey === "risk-exit"))
      .toMatchObject({ filledOrders: 1, buyOrders: 0, sellOrders: 1, closedTrades: 0, realizedPnl: 0 });
  });

  it("preserves a prior-week entry strategy's profit with zero current-week entry fills", () => {
    const buy = fill({ strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康",
      filledAt: "2026-08-20T02:00:00Z", createdAt: "2026-08-20T02:00:00Z" });
    const sell = fill({ id: "sell", side: "sell", filledPrice: 11, notional: 1100,
      strategyKey: "risk-exit", strategy: "市场状态减仓", filledAt: "2026-08-25T02:00:00Z" });
    const result = review(buy, [], [sell]);
    expect(result.strategyBreakdown.find((row) => row.strategyKey === "kairosTrendHealth"))
      .toMatchObject({ filledOrders: 0, closedTrades: 1, realizedPnl: 90, winRate: 1 });
  });

  it("uses a recorded name when another fill for that same canonical key lacked its name", () => {
    const result = review(fill({ strategyKey: "kairosTrendHealth" }), [],
      [fill({ id: "named", symbol: "600011", strategyKey: "kairosTrendHealth", strategy: "KAIROS趋势健康" })]);
    expect(result.strategyBreakdown).toMatchObject([{ strategyKey: "kairosTrendHealth",
      strategyName: "KAIROS趋势健康", filledOrders: 2 }]);
  });
});
