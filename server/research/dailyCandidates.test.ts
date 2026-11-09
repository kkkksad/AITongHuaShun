import { describe, expect, it } from "vitest";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import { buildDailyCandidates } from "./dailyCandidates";

function quote(symbol: string, turnover?: number): MarketQuote {
  return { symbol, name: symbol, tradable: true, price: 10, previousClose: 9.9,
    changePercent: 1.01, volume: 12_345_600, amount: 123_450_000,
    open: 9.95, high: 10.1, low: 9.9, amplitude: 2.02, turnover,
    updatedAt: "2026-11-09T08:15:00.000Z" };
}
function report(...quotes: MarketQuote[]) {
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1,
    marketTime: "2026-11-09T08:15:01.000Z", quotes };
  return buildDailyCandidates(snapshot, "akshare", quotes.length);
}

describe("daily candidate turnover evidence in percentage points", () => {
  it("uses the supplied 3.25 percent as healthy and 18.5 percent as overheated", () => {
    const rows = report(quote("000001", 3.25), quote("600519"), quote("601318", 18.5)).candidates;
    const healthy = rows.find(row => row.symbol === "000001")!;
    const missing = rows.find(row => row.symbol === "600519")!;
    const overheated = rows.find(row => row.symbol === "601318")!;
    expect(healthy.score).toBeGreaterThan(missing.score);
    expect(missing.score).toBeGreaterThan(overheated.score);
    expect(healthy.reasons.join(" ")).toContain("换手率处于可观察区间");
    expect(overheated.riskFlags.join(" ")).toContain("换手率过高");
    expect(missing.reasons.join(" ")).not.toContain("换手率处于可观察区间");
  });

  it("keeps zero and missing turnover from gaining a fabricated healthy-factor bonus", () => {
    const rows = report(quote("000001", 0), quote("600519")).candidates;
    expect(rows[0].score).toBe(rows[1].score);
    expect(rows.every(row => !row.reasons.some(reason => reason.includes("换手率处于可观察区间")))).toBe(true);
  });
});
