import { describe, expect, it } from "vitest";
import { derivePaperSkipBlockerStage, selectPaperSkipEvidence } from "./paperSkipEvidence";
import type { PaperAutoExecutionSkip } from "./paperAutoExecutor";

function skip(index: number, action: PaperAutoExecutionSkip["action"], reason: string): PaperAutoExecutionSkip {
  return { symbol: `600${String(index).padStart(3, "0")}`, action, reason, price: 10, quantity: 0 };
}
describe("bounded paper skip evidence", () => {
  it("retains distinct blocked causes before repeated rule failures or holding observations", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => skip(i, "hold", "healthy holding")),
      ...Array.from({ length: 9 }, (_, i) => skip(i + 4, "blocked", "no signal")),
      skip(13, "blocked", "fee and lot cap"),
    ];
    const before = JSON.stringify(rows), evidence = selectPaperSkipEvidence(rows);
    expect(evidence).toMatchObject({ total: 14, omitted: 6 });
    expect(evidence.reasons).toHaveLength(8);
    expect(evidence.reasons.slice(0, 2).map(row => row.reason)).toEqual(["no signal", "fee and lot cap"]);
    expect(evidence.reasons.every(row => row.action === "blocked")).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
    expect(selectPaperSkipEvidence(rows)).toEqual(evidence);
  });
  it("preserves all sparse evidence, prioritizes skipped exit plans, and emits only audit fields", () => {
    const rows = [skip(0, "hold", "hold"), skip(1, "observe", "observe"),
      { ...skip(2, "paper-sell-plan", "T+1"), privateToken: "do-not-copy" }];
    const result = selectPaperSkipEvidence(rows);
    expect(result).toMatchObject({ total: 3, omitted: 0 });
    expect(result.reasons.map(row => row.action)).toEqual(["paper-sell-plan", "observe", "hold"]);
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
    expect(selectPaperSkipEvidence([])).toEqual({ total: 0, omitted: 0, reasons: [] });
  });

  it("keeps actual execution and post-signal gates ahead of eight distinct no-signal causes", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => skip(index, "blocked", `no signal ${index}`)),
      { ...skip(8, "blocked", "fee discipline"), blockerStage: "entry-discipline" },
      { ...skip(9, "blocked", "lot cap"), blockerStage: "order-sizing" },
      { ...skip(10, "observe", "new positions disabled"), blockerStage: "new-position-permission" },
      { ...skip(11, "paper-buy-plan", "daily cap"), blockerStage: "execution" },
      { ...skip(12, "paper-sell-plan", "quote unavailable"), blockerStage: "execution" },
    ] as PaperAutoExecutionSkip[];
    const before = JSON.stringify(rows);
    const result = selectPaperSkipEvidence(rows);
    expect(result).toMatchObject({ total: 13, omitted: 5 });
    expect(result.reasons).toHaveLength(8);
    expect(result.reasons.slice(0, 5).map(row => row.reason)).toEqual([
      "daily cap", "quote unavailable", "fee discipline", "lot cap", "new positions disabled",
    ]);
    expect(result.reasons[2]).toMatchObject({ blockerStage: "entry-discipline" });
    expect(JSON.stringify(rows)).toBe(before);
    expect(selectPaperSkipEvidence(rows)).toEqual(result);
  });

  it("retains an identified cash sizing observation before distinct signal blocks", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => skip(index, "blocked", `no signal ${index}`)),
      { ...skip(10, "observe", "cash pays a lot but plan budget does not"), blockerStage: "order-sizing" },
    ] as PaperAutoExecutionSkip[];
    expect(selectPaperSkipEvidence(rows).reasons[0]).toMatchObject({
      action: "observe", blockerStage: "order-sizing", reason: "cash pays a lot but plan budget does not",
    });
  });

  it("does not copy or prioritize an unrecognized stage or private properties", () => {
    const row = { ...skip(0, "blocked", "unknown"), blockerStage: "token=do-not-copy", privateToken: "secret" };
    const result = selectPaperSkipEvidence([row as unknown as PaperAutoExecutionSkip]);
    expect(result.reasons[0]).not.toHaveProperty("blockerStage");
    expect(JSON.stringify(result)).not.toContain("token=");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    ["hold", ["round-trip-fee-ratio: blocked (2% > 1%)"]],
    ["observe", ["entry-persistence: blocked (history-not-covered)"]],
    ["blocked", ["round-trip-fee-ratio: pass (0.50% <= 1.00%)"]],
    ["blocked", ["round-trip-fee-ratio: blockedness"]],
    ["blocked", ["provider-warning token=do-not-copy"]],
    ["blocked", []],
  ] as const)("does not invent a failed entry gate for %s with %j", (action, ruleChecks) => {
    expect(derivePaperSkipBlockerStage({ action, ruleChecks: [...ruleChecks] })).toBeUndefined();
  });

  it.each([
    ["hold", "order-sizing"], ["observe", "entry-discipline"],
    ["blocked", "execution"], ["paper-buy-plan", "strategy-signal"],
  ] as const)("ignores a contradictory stage for %s/%s", (action, blockerStage) => {
    const result = selectPaperSkipEvidence([{ ...skip(0, action, "legacy reason"), blockerStage }]);
    expect(result.reasons[0]).not.toHaveProperty("blockerStage");
  });

  it("keeps distinct gate stages even when their public reason text is the same", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => ({ ...skip(index, "blocked", "same reason"), blockerStage: "entry-discipline" as const })),
      { ...skip(9, "blocked", "same reason"), blockerStage: "order-sizing" as const },
    ];
    expect(selectPaperSkipEvidence(rows).reasons.slice(0, 2).map(row => row.blockerStage))
      .toEqual(["entry-discipline", "order-sizing"]);
  });
});
