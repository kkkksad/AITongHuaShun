import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { buildWeeklyPaperReview } from "./weeklyPaperReview";

function fill(fields: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "buy", symbol: "600010", side: "buy", type: "limit", quantity: 100,
    status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
    notional: 1000, commission: 5, createdAt: "2026-08-24T02:00:00Z",
    filledAt: "2026-08-24T02:00:00Z", updatedAt: "2026-08-24T02:00:00Z",
    ...fields,
  };
}

function sell(fields: Partial<OrderRecord> = {}): OrderRecord {
  return fill({ id: "sell", side: "sell", requestedPrice: 11, filledPrice: 11,
    notional: 1100, createdAt: "2026-08-25T02:00:00Z", filledAt: "2026-08-25T02:00:00Z",
    updatedAt: "2026-08-25T02:00:00Z", ...fields });
}

function review(orders: OrderRecord[]) {
  return buildWeeklyPaperReview({ now: new Date("2026-08-28T07:00:00Z"),
    initialCapital: 20000, historyRetentionDays: 30,
    account: { equity: 20000, cash: 20000, marketValue: 0 }, orders, auditEvents: [] });
}

describe("weekly review execution evidence", () => {
  const invalid: Array<[string, Partial<OrderRecord>]> = [
    ["missing actual price", { filledPrice: undefined }],
    ["zero actual price", { filledPrice: 0 }],
    ["negative actual price", { filledPrice: -10 }],
    ["nonfinite actual price", { filledPrice: Infinity }],
    ["zero actual quantity", { filledQuantity: 0 }],
    ["negative actual quantity", { filledQuantity: -100 }],
    ["nonfinite actual quantity", { filledQuantity: NaN }],
    ["fractional actual quantity", { filledQuantity: 99.5 }],
    ["unsafe actual quantity", { filledQuantity: Number.MAX_SAFE_INTEGER + 1 }],
    ["zero actual notional", { notional: 0 }],
    ["negative actual notional", { notional: -1000 }],
    ["nonfinite actual notional", { notional: Infinity }],
    ["inconsistent actual notional", { notional: 1200 }],
    ["negative actual commission", { commission: -5 }],
    ["nonfinite actual commission", { commission: NaN }],
    ["infinite actual commission", { commission: Infinity }],
  ];

  it.each(invalid)("does not invent money or FIFO profit with %s", (_name, fields) => {
    const result = review([fill(fields), sell()]);
    expect(result.sample).toMatchObject({ filledOrderCount: 2, daysWithFills: 2, evidence: "limited" });
    expect(result.performance).toMatchObject({ closedTrades: 0, winRate: null,
      realizedPnl: 0, commission: 5 });
    expect(result.capital).toMatchObject({ grossBuyNotional: 0, grossSellNotional: 1100,
      grossTurnover: 1100, averageFilledOrderNotional: 1100 });
    expect(result.daily[0]).toMatchObject({ filled: 1, buyNotional: 0, commission: 0 });
    expect(result.diagnosis.findings.join(" ")).toContain("1 笔保留成交记录的实际量价、金额或费用不完整");
    expect(result.diagnosis.findings.join(" ")).toContain("部分统计");
  });

  it("does not treat legacy missing required execution fields as zero fees or requested fills", () => {
    for (const key of ["filledQuantity", "notional", "commission"] as const) {
      const incomplete = fill();
      delete (incomplete as unknown as Record<string, unknown>)[key];
      const result = review([incomplete, sell()]);
      expect(result.performance).toMatchObject({ closedTrades: 0, winRate: null, realizedPnl: 0 });
      expect(result.capital.grossBuyNotional).toBe(0);
    }
  });

  it("does not pair around a malformed older fill, and preserves another symbol's net result", () => {
    const result = review([
      fill({ id: "older-incomplete", filledAt: "2026-08-20T02:00:00Z", filledQuantity: 0 }),
      fill(), sell(),
      fill({ id: "valid-buy", symbol: "600011" }), sell({ id: "valid-sell", symbol: "600011" }),
    ]);
    expect(result.sample).toMatchObject({ filledOrderCount: 4, evidence: "limited" });
    expect(result.performance).toMatchObject({ closedTrades: 1, realizedPnl: 90, winRate: 1, commission: 20 });
    expect(result.capital).toMatchObject({ grossBuyNotional: 2000, grossSellNotional: 2200 });
    expect(result.diagnosis.findings.join(" ")).not.toContain("本期有 1 笔");
  });

  it("accepts a known zero fee and one-cent notional rounding without using requested price", () => {
    const result = review([fill({ requestedPrice: 1, commission: 0, notional: 1000.01 }),
      sell({ requestedPrice: 100, commission: 0 })]);
    expect(result.performance).toMatchObject({ closedTrades: 1, realizedPnl: 99.99, winRate: 1, commission: 0 });
    expect(result.capital.grossBuyNotional).toBe(1000.01);
    expect(result.diagnosis.findings.join(" ")).not.toContain("不完整");
  });

  it("ignores incomplete future fills without tainting the report's current evidence", () => {
    const result = review([fill(), sell(), fill({ id: "future", filledAt: "2026-08-31T02:00:00Z", filledQuantity: 0 })]);
    expect(result.sample).toMatchObject({ filledOrderCount: 2, evidence: "sufficient" });
    expect(result.performance).toMatchObject({ closedTrades: 1, realizedPnl: 90 });
    expect(result.diagnosis.findings.join(" ")).not.toContain("不完整");
  });

  it("does not diagnose absent trades or low deployment from incomplete execution amounts", () => {
    const result = buildWeeklyPaperReview({ now: new Date("2026-08-28T07:00:00Z"),
      initialCapital: 20000, historyRetentionDays: 30,
      account: { equity: 20000, cash: 19000, marketValue: 1000 },
      orders: [fill({ filledPrice: undefined, clientOrderId: "kairos-auto-paper:2026-08-24:x" })],
      auditEvents: [{ id: "run", category: "system", action: "paper-auto-execution.run",
        message: "run", timestamp: "2026-08-24T02:00:00Z",
        data: { planSnapshot: { buyNotional: 1000, sellNotional: 0 } } }],
    });
    expect(result.sample.filledOrderCount).toBe(1);
    expect(result.capital.summary).toContain("部分统计");
    expect(result.capital.summary).not.toContain("资金大部分没有进入成交记录");
    const findings = result.diagnosis.findings.join(" ");
    expect(findings).not.toContain("但没有自动 Paper 买入成交");
    expect(findings).not.toContain("资金部署偏低");
    expect(result.diagnosis.nextActions[0]).toContain("先核对缺失");
  });
});
