import { describe, expect, it, vi } from "vitest";
import {
  buildCrossMarketStrategyContext,
  deriveCrossMarketDecision,
  summarizeGlobalMarkets,
  type CrossMarketSignalGroup,
} from "./crossMarketStrategyContext";

function signal(
  tone: CrossMarketSignalGroup["tone"],
  averageChangePercent: number,
  averageReturn20d: number | null,
): CrossMarketSignalGroup {
  return {
    tone,
    coverage: 4,
    averageChangePercent,
    averageReturn20d,
  };
}

describe("summarizeGlobalMarkets", () => {
  it("uses the bounded real index breadth and average move", () => {
    const summary = summarizeGlobalMarkets([
      { changePercent: 1.2 },
      { changePercent: 0.8 },
      { changePercent: -0.1 },
      { changePercent: 0.6 },
    ]);

    expect(summary).toMatchObject({
      tone: "positive",
      coverage: 4,
      advancerRatio: 0.75,
    });
    expect(summary.averageChangePercent).toBeCloseTo(0.625);
  });
});

describe("deriveCrossMarketDecision", () => {
  it("prioritizes trend, breakout and pullback in a confirmed risk-on context", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: true,
      global: {
        ...signal("positive", 0.8, null),
        advancerRatio: 0.75,
      },
      equityFutures: signal("positive", 0.7, 0.045),
      industrialFutures: signal("positive", 0.5, 0.03),
      preciousMetals: signal("neutral", 0.1, 0.005),
    });

    expect(decision.riskTone).toBe("risk-on");
    expect(decision.positionPosture).toBe("normal");
    expect(decision.preferredStrategyFamilies).toEqual([
      "trend",
      "breakout",
      "pullback",
    ]);
    expect(decision.preferredStrategyKeys).toContain("kairosLowVolTrend");
  });

  it("uses defensive research when global and equity futures are both weak", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: true,
      global: {
        ...signal("negative", -1.1, null),
        advancerRatio: 0.15,
      },
      equityFutures: signal("negative", -1.3, -0.06),
      industrialFutures: signal("negative", -0.7, -0.04),
      preciousMetals: signal("positive", 0.8, 0.035),
    });

    expect(decision.riskTone).toBe("risk-off");
    expect(decision.positionPosture).toBe("reduced");
    expect(decision.preferredStrategyFamilies).toEqual(["defensive"]);
    expect(decision.deweightedStrategyFamilies).toContain("breakout");
  });

  it("returns mixed and cash-only when sources conflict or are incomplete", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: false,
      global: {
        ...signal("positive", 0.9, null),
        advancerRatio: 0.8,
      },
      equityFutures: signal("negative", -0.9, -0.03),
      industrialFutures: signal("neutral", 0, null),
      preciousMetals: signal("neutral", 0, null),
    });

    expect(decision.riskTone).toBe("mixed");
    expect(decision.positionPosture).toBe("cash-only");
    expect(decision.preferredStrategyKeys).toEqual([]);
  });
});

describe("buildCrossMarketStrategyContext", () => {
  it("does not fabricate cross-market context when AkShare is disabled", async () => {
    const fetchImpl = vi.fn();
    const report = await buildCrossMarketStrategyContext({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "paper",
      limit: 12,
      days: 180,
      timeoutMs: 100,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sourceStatus: "mock-disabled",
      riskTone: "mixed",
      positionPosture: "cash-only",
      futures: [],
    });
    expect(report.warnings.join(" ")).toContain("不会使用静态跨市场数据替代");
  });
});
