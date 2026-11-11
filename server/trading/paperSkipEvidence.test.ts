import { describe, expect, it } from "vitest";
import { selectPaperSkipEvidence } from "./paperSkipEvidence";
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
});
