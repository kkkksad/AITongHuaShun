import { describe, expect, it } from "vitest";
import type { AccountSnapshot, AuditEvent, MarketSnapshot, OrderRecord } from "../../shared/trading";
import { buildDailyMarketReview } from "./dailyMarketReview";

const now = new Date("2026-07-14T02:00:00.000Z");
const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: now.toISOString(), quotes: [] };
const account: AccountSnapshot = {
  accountId: "cutoff", mode: "paper", cash: 20000, equity: 20000, marketValue: 0,
  unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
  riskUtilization: 0, paused: false, updatedAt: now.toISOString(),
};
const record = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "fill", symbol: "600010", side: "buy", type: "limit", quantity: 100,
  requestedPrice: 10, filledPrice: 10, filledQuantity: 100, notional: 1000, commission: 5,
  status: "filled", createdAt: "2026-07-14T01:30:00Z", updatedAt: now.toISOString(),
  filledAt: "2026-07-14T02:00:00.001Z", ...overrides,
});
const review = (orders: OrderRecord[], auditEvents: AuditEvent[] = []) => buildDailyMarketReview({
  snapshot, account, positions: [], provider: "akshare", now, orders, auditEvents,
});

describe("daily review evidence cutoff", () => {
  it.each([true, false])("excludes same-day future fills, explicit=%s", (explicit) => {
    const order = record(explicit ? {} : { filledAt: undefined, updatedAt: "2026-07-14T02:00:00.001Z" });
    const result = review([order]);
    expect(result.trades).toMatchObject({ submitted: 1, filled: 0, filledBuys: 0, filledBuyNotional: 0, commission: 0 });
    expect(result.entryReview.status).not.toBe("entered");
    expect(result.trades.items[0]).toMatchObject({ orderId: "fill", fillIncludedInReview: false });
    expect(result.strategyReview.issues.join(" ")).toContain("晚于报告时刻");
    expect(result.account.performanceBasis).toBe("unavailable");
  });

  it("includes an exact cutoff fill using its offset timestamp", () => {
    const result = review([record({ filledAt: "2026-07-14T10:00:00+08:00" })]);
    expect(result.trades).toMatchObject({ filled: 1, commission: 5 });
    expect(result.trades.items[0]).toMatchObject({ fillIncludedInReview: true });
    expect(result.entryReview.status).toBe("entered");
  });

  it("excludes future submissions from activity, rejects and opening attempts", () => {
    const result = review([record({ createdAt: "2026-07-14T02:01:00Z", status: "rejected", rejectionReason: "可用资金不足" })]);
    expect(result.trades).toMatchObject({ submitted: 0, rejected: 0, filled: 0, items: [] });
    expect(result.entryReview.cashWasConstraint).toBe(false);
  });

  it("does not attach a future audit reason to a known fill", () => {
    const result = review([record({ filledAt: now.toISOString() })], [{
      id: "future-decision", category: "system", action: "paper-auto-execution.decision",
      message: "recorded", timestamp: "2026-07-14T02:00:00.001Z",
      data: { orderId: "fill", reason: "FUTURE_REASON", strategy: "FUTURE_STRATEGY" },
    }]);
    expect(result.trades.items[0]).toMatchObject({ reasonSource: "historical-fallback" });
    expect(JSON.stringify(result)).not.toContain("FUTURE_REASON");
  });

  it("cannot derive current-day runtime coverage from a future run", () => {
    const result = review([], [{
      id: "future-run", category: "system", action: "paper-auto-execution.run",
      message: "future", timestamp: "2026-07-14T02:01:00Z",
      data: { tradingDate: "2026-07-14", regime: "risk-off", planQuality: "ready", status: "watch-only", session: "open" },
    }]);
    expect(result.entryReview.marketRegime).toBeNull();
  });

  it("does not accept a same-date future market snapshot or updated account as current evidence", () => {
    const result = buildDailyMarketReview({
      snapshot: { ...snapshot, marketTime: "2026-07-14T02:00:00.001Z" },
      account: { ...account, updatedAt: "2026-07-14T02:00:00.001Z" },
      positions: [], provider: "akshare", now, orders: [], auditEvents: [],
    });
    expect(result.market).toMatchObject({ evidenceStatus: "unknown", tone: "insufficient-data" });
    expect(result.market.summary).toContain("晚于报告时刻");
    expect(result.account.performanceBasis).toBe("unavailable");
  });
});
