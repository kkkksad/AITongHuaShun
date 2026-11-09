import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import type { StrategyRobustnessProfile } from "./strategyRobustness";
import { evaluateFixedStrategyProfiles } from "./strategyRobustness";

function snapshots() {
  const dates = Array.from({ length: 36 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i)))
    .filter(d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6).slice(0, 18);
  return dates.map((date, i): MarketSnapshot => {
    const win = i < 6;
    const price = i % 2 === 0 ? 10 : win ? 12 : 8;
    return { mode: "paper", sequence: i + 1, marketTime: date.toISOString(), quotes: [
      { symbol: "600001", name: "无信号", tradable: true, price: 100, previousClose: 100, changePercent: 0, volume: 1000, updatedAt: date.toISOString() },
      { symbol: "600002", name: "独立有信号", tradable: true, price, previousClose: price, changePercent: 0, volume: 1000, updatedAt: date.toISOString() },
    ] };
  });
}

function profile(created?: string[][]): StrategyRobustnessProfile {
  return { strategyKey: "coverage-test", strategyFamily: "trend", fixedParams: {}, factory: {
    name: "覆盖回归", parameters: [], create: () => {
      const seen: string[] = [];
      created?.push(seen);
      return { name: "覆盖回归", onBar: c => {
        seen.push(c.snapshot.quotes.map(q => q.symbol).join(","));
        // A representative single-symbol strategy: first stock is selected.
        const quote = c.snapshot.quotes[0];
        if (quote?.symbol !== "600002") return [];
        const window = Math.floor((c.snapshot.sequence - 1) / 6);
        if (window === 2 || window === 0 && c.barIndex > 1) return [];
        return [{ symbol: quote.symbol, side: c.barIndex % 2 === 0 ? "buy" : "sell", type: "market", quantity: 100 }];
      } };
    },
  } };
}

describe("independent symbol coverage in robustness evidence", () => {
  it("tests the second stock even when the first stock has no signals", async () => {
    const entries = await evaluateFixedStrategyProfiles(snapshots(), [profile()]);
    expect(entries).toHaveLength(2);
    const a = entries.find(e => e.evaluatedSymbol === "600001")!;
    const b = entries.find(e => e.evaluatedSymbol === "600002")!;
    expect(a).toMatchObject({ totalTrades: 0, windows: 3, closedMatches: 0, closedMatchWinRate: null });
    expect(b).toMatchObject({ evaluatedName: "独立有信号", windows: 3, totalTrades: 8, closedMatches: 4, winningMatches: 1 });
    expect(b.closedMatchWinRate).toBe(0.25);
  });

  it("does not reuse state across symbols or windows", async () => {
    const instances: string[][] = [];
    await evaluateFixedStrategyProfiles(snapshots(), [profile(instances)]);
    expect(instances).toHaveLength(6);
    for (const seen of instances) {
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(1);
      expect(seen[0]).toMatch(/^60000[12]$/);
    }
  });

  it("keeps per-symbol evidence and ranks unchanged when input order changes", async () => {
    const first = await evaluateFixedStrategyProfiles(snapshots(), [profile()]);
    const second = await evaluateFixedStrategyProfiles(snapshots().map(s => ({ ...s, quotes: [...s.quotes].reverse() })), [profile()]);
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(first.every(e => e.rank === 1)).toBe(true);
  });

  it("keeps a missing or zero-volume stock from borrowing another symbol", async () => {
    const input = snapshots().map(s => ({ ...s, quotes: s.quotes.map(q => q.symbol === "600002" ? { ...q, tradable: false, volume: 0 } : q) }));
    const entries = await evaluateFixedStrategyProfiles(input, [profile()]);
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.totalTrades === 0 && e.closedMatchWinRate === null)).toBe(true);
  });
});
