import { describe, expect, it } from "vitest";
import {
  adaptivePostureLabel,
  adaptiveRegimeLabel,
  formatAdaptiveCapitalPacing,
} from "./adaptiveStrategyPresentation";

describe("adaptive strategy presentation", () => {
  it("uses explicit Chinese labels for every market regime", () => {
    expect(adaptiveRegimeLabel("trend-up-low-volatility")).toBe("低波上升趋势");
    expect(adaptiveRegimeLabel("trend-up-high-volatility")).toBe("高波上升趋势");
    expect(adaptiveRegimeLabel("range-low-volatility")).toBe("低波区间震荡");
    expect(adaptiveRegimeLabel("range-high-volatility")).toBe("高波区间震荡");
    expect(adaptiveRegimeLabel("risk-off")).toBe("风险收缩");
    expect(adaptiveRegimeLabel("unclear")).toBe("状态待确认");
  });

  it("describes position posture without implying guaranteed returns", () => {
    expect(adaptivePostureLabel("accumulate")).toBe("允许谨慎新增");
    expect(adaptivePostureLabel("hold")).toBe("持仓观察");
    expect(adaptivePostureLabel("reduce")).toBe("优先降低风险");
  });

  it("formats all intraday paper capital caps", () => {
    expect(formatAdaptiveCapitalPacing({
      openingMaxInvestedRatio: 0.55,
      morningMaxInvestedRatio: 0.7,
      afternoonMaxInvestedRatio: 0.82,
      closingMaxInvestedRatio: 0.9,
    })).toBe("开盘 55% · 上午 70% · 下午 82% · 尾盘 90%");
  });
});
