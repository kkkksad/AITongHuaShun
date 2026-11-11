import { describe, expect, it } from "vitest";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPreferredHistoricalStocks } from "./paperTradingPlanService";

const entryBudget = { cash: 13_992, equity: 20_000, lotSize: 100,
  maxOrderNotional: 2_000, maxPositionWeight: 0.25,
  commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 };
const positions = Array.from({ length: 3 }, (_, i) => ({ symbol: `60100${i}`, name: `持仓${i}` }));
function fixture(limit = 12) {
  return { positions, limit, entryBudget,
    candidates: { candidates: Array.from({ length: 25 }, (_, i) => ({
      symbol: `6000${String(i).padStart(2, "0")}`, name: `候选${i}`, price: 8,
      action: i < 10 ? "paper-buy" : "watch",
    })) } as unknown as DailyCandidateReport,
    qualityStocks: { stocks: [] } as unknown as DailyQualityStockReport,
  };
}
const symbols = (rows: ReturnType<typeof buildPreferredHistoricalStocks>) => rows.map(r => r.symbol);

describe("bounded historical exploration", () => {
  it("retains the priority head and rotates only the last slot through the affordable tail", () => {
    const request = fixture();
    const original = symbols(buildPreferredHistoricalStocks(request));
    const first = symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed: 0 }));
    const second = symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed: 1 }));
    expect(first).toEqual(original);
    expect(second.slice(0, 11)).toEqual(original.slice(0, 11));
    expect(second.at(-1)).toBe("600009");
    expect(second).toHaveLength(12);
    expect(symbols(buildPreferredHistoricalStocks(request))).toEqual(original);
  });

  it.each([6, 12, 40])("covers the finite affordable pool over consecutive seeds within limit=%s", limit => {
    const request = fixture(limit);
    const original = symbols(buildPreferredHistoricalStocks(request));
    const capacity = Math.min(limit, 12);
    const seen = new Set<string>();
    const selections = Array.from({ length: 25 }, (_, rotationSeed) => {
      const rows = symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed }));
      expect(rows).toHaveLength(capacity);
      expect(new Set(rows).size).toBe(capacity);
      expect(rows.slice(0, capacity - 1)).toEqual(original.slice(0, capacity - 1));
      for (const position of positions) expect(rows).toContain(position.symbol);
      rows.forEach(s => seen.add(s));
      return rows.at(-1);
    });
    expect(new Set(selections).size).toBe(28 - capacity + 1);
    expect(seen.size).toBe(28);
  });

  it("never lets impossible entries evict feasible lots even when their action ranks higher", () => {
    const request = fixture();
    request.candidates.candidates.unshift({ symbol: "600999", name: "高价", price: 900, action: "paper-buy" } as never);
    for (let rotationSeed = 0; rotationSeed < 30; rotationSeed++) {
      const rows = symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed }));
      expect(rows).not.toContain("600999");
      expect(rows).toHaveLength(12);
    }
  });

  it("does not rotate positions away when they consume the whole capacity", () => {
    const request = fixture(3);
    for (const rotationSeed of [0, 1, 100]) {
      expect(buildPreferredHistoricalStocks({ ...request, rotationSeed })).toEqual(positions);
    }
  });

  it("retains old fallback ordering with no affordable overflow", () => {
    for (const cash of [0, 805]) {
      const request = fixture();
      request.candidates.candidates = request.candidates.candidates.slice(0, 2);
      request.entryBudget = { ...entryBudget, cash };
      const original = buildPreferredHistoricalStocks(request);
      expect(buildPreferredHistoricalStocks({ ...request, rotationSeed: 50 })).toEqual(original);
    }
  });

  it("deduplicates held and scanner symbols before creating the rotation pool and preserves inputs", () => {
    const request = fixture();
    request.qualityStocks.stocks.push(
      ...request.candidates.candidates.map(r => ({ ...r, action: "focus" as const } as never)),
      { symbol: positions[0].symbol, name: "持仓重复", price: 8, action: "focus" } as never,
    );
    const before = structuredClone(request);
    const seen = new Set<string>();
    for (let rotationSeed = 0; rotationSeed < 28; rotationSeed++) {
      const rows = symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed }));
      expect(new Set(rows).size).toBe(12);
      expect(rows.slice(0, 3)).toEqual(symbols(positions));
      rows.forEach(s => seen.add(s));
    }
    expect(seen.size).toBe(28);
    expect(request).toEqual(before);
  });

  it("uses a single reproducible slot even without positions", () => {
    const request = { ...fixture(1), positions: [] };
    expect(symbols(buildPreferredHistoricalStocks({ ...request, rotationSeed: 2 }))).toEqual(["600002"]);
    expect(buildPreferredHistoricalStocks({ ...request, rotationSeed: 2 })).toEqual(
      buildPreferredHistoricalStocks({ ...request, rotationSeed: 27 }),
    );
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid explicit seed %s", rotationSeed => {
    expect(() => buildPreferredHistoricalStocks({ ...fixture(), rotationSeed })).toThrow("Invalid historical rotation seed");
  });
});
