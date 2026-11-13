import { describe, expect, it } from "vitest";
import { assessEntryPersistence } from "./paperEntryPersistence";
import type { StockRegimeResult } from "./marketRegimeResearch";

function stock(overrides: Partial<StockRegimeResult> = {}): StockRegimeResult {
  return { rank: 1, symbol: "600001", name: "测试", latestDate: "2026-11-12", barCount: 120,
    regime: "unclear", confidence: 0.55,
    features: { return5d: 0, return20d: 0, return60d: 0, pullbackFrom20DayHigh: 0,
      distanceFromMa20: 0, distanceFromMa60: 0, ma20Slope5d: 0, ma60Slope5d: 0, volumeRatio: 1 },
    validation: { samples: 20, hitRate5d: 0.55, averageForwardReturn5d: 0 },
    evidence: [], riskFlags: [], ...overrides };
}

function assess(value: StockRegimeResult | undefined, key: string | undefined = "rsi", required = true) {
  return assessEntryPersistence({ required, stockRegime: value, strategyKey: key });
}

describe("Paper entry persistence rejected-subcondition evidence", () => {
  it("keeps absent history separate from bypassed history", () => {
    expect(assess(undefined)).toMatchObject({ allowed: false, ruleCheck: "entry-persistence: blocked (history-not-covered)" });
    expect(assess(undefined, undefined, false)).toMatchObject({ allowed: true, ruleCheck: "entry-persistence: not-required" });
  });

  it.each(["rsi", "bollingerBands", "kairosRangeRotation", "kairosQualifiedProbe", "kairosValidationBasket"])(
    "keeps a valid unclear range executable for %s", key => {
      expect(assess(stock(), key)).toMatchObject({ allowed: true, ruleCheck: "entry-persistence: pass (range-structure 0.55)" });
    });

  it("explains the incompatible strategy without claiming every unclear stock is forbidden", () => {
    const result = assess(stock(), "momentum");
    expect(result.allowed).toBe(false);
    expect(result.explanation).toContain("当前策略不属于已实现的区间持续性分支");
  });

  it.each([
    { field: "barCount", value: 119, expected: "完成日线至少120根（当前119）" },
    { field: "confidence", value: 0.54, expected: "形态置信度至少0.55（当前0.54）" },
    { field: "return20d", value: -0.061, expected: "20日收益处于[-0.06,0.08]（当前-0.061）" },
    { field: "return20d", value: 0.081, expected: "20日收益处于[-0.06,0.08]（当前0.081）" },
    { field: "distanceFromMa20", value: -0.101, expected: "距MA20偏离处于[-0.1,0.03]（当前-0.101）" },
    { field: "distanceFromMa20", value: 0.031, expected: "距MA20偏离处于[-0.1,0.03]（当前0.031）" },
    { field: "ma20Slope5d", value: -0.011, expected: "MA20五日斜率至少-0.01（当前-0.011）" },
  ])("reports the actual failed range condition $field=$value", ({ field, value, expected }) => {
    const s = stock();
    if (field === "barCount" || field === "confidence") s[field] = value;
    else s.features[field as keyof StockRegimeResult["features"]] = value;
    const result = assess(s);
    expect(result.allowed).toBe(false);
    expect(result.explanation).toContain(expected);
    expect(result.explanation).not.toContain("上涨概率");
  });

  it("preserves all simultaneous failures and the input observation", () => {
    const s = stock({ barCount: 100, confidence: 0.5 });
    s.features.return20d = 0.09; s.features.distanceFromMa20 = 0.04; s.features.ma20Slope5d = -0.02;
    const before = structuredClone(s);
    const result = assess(s);
    for (const text of ["完成日线", "形态置信度", "20日收益", "距MA20偏离", "MA20五日斜率"]) expect(result.explanation).toContain(text);
    expect(result.explanation.length).toBeLessThan(500);
    expect(s).toEqual(before);
  });

  it("separates insufficient washout samples and unknown historical frequency", () => {
    const s = stock({ regime: "washout-candidate", confidence: 0.64,
      validation: { samples: 19, hitRate5d: null, averageForwardReturn5d: null } });
    const result = assess(s);
    expect(result.allowed).toBe(false);
    expect(result.explanation).toContain("形态置信度至少0.65（当前0.64）");
    expect(result.explanation).toContain("历史同类样本至少20个（当前19）");
    expect(result.explanation).toContain("5日历史条件频率至少0.55（当前未知）");
  });

  it.each([NaN, Infinity, -Infinity])("does not print invalid range values as meaningful evidence: %s", value => {
    const s = stock(); s.features.return20d = value;
    const result = assess(s);
    expect(result.allowed).toBe(false);
    expect(result.explanation).toContain("当前非法数值");
    expect(result.explanation).not.toMatch(/NaN|Infinity/);
  });

  it("preserves original allow decisions on independent boundary combinations", () => {
    let observations = 0;
    for (const regime of ["healthy-trend", "washout-candidate", "unclear", "trend-deterioration", "insufficient-data"] as const)
    for (const confidence of [0.549999, 0.55, 0.649999, 0.65])
    for (const bars of [119, 120])
    for (const ret of [-0.060001, -0.06, 0.08, 0.080001])
    for (const distance of [-0.100001, -0.1, 0.03, 0.030001])
    for (const slope of [-0.010001, -0.01])
    for (const samples of [19, 20])
    for (const hitRate5d of [null, 0.549999, 0.55])
    for (const key of ["rsi", "momentum"]) {
      const s = stock({ regime, confidence, barCount: bars,
        validation: { samples, hitRate5d, averageForwardReturn5d: null } });
      s.features.return20d = ret; s.features.distanceFromMa20 = distance; s.features.ma20Slope5d = slope;
      const baseline = (regime === "healthy-trend" && confidence >= 0.55) ||
        (regime === "washout-candidate" && confidence >= 0.65 && s.validation.samples >= 20 &&
          s.validation.hitRate5d !== null && s.validation.hitRate5d >= 0.55) ||
        (key === "rsi" && regime === "unclear" && bars >= 120 && confidence >= 0.55 && ret >= -0.06 && ret <= 0.08 &&
          distance >= -0.1 && distance <= 0.03 && slope >= -0.01);
      expect(assess(s, key).allowed).toBe(baseline); observations++;
    }
    expect(observations).toBe(15360);
  });
});
