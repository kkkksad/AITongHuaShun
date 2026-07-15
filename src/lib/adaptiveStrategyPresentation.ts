import type {
  AdaptiveMarketRegime,
  AdaptivePositionPosture,
} from "./tradingApi";

const regimeLabels: Record<AdaptiveMarketRegime, string> = {
  "trend-up-low-volatility": "低波上升趋势",
  "trend-up-high-volatility": "高波上升趋势",
  "range-low-volatility": "低波区间震荡",
  "range-high-volatility": "高波区间震荡",
  "risk-off": "风险收缩",
  unclear: "状态待确认",
};

const postureLabels: Record<AdaptivePositionPosture, string> = {
  accumulate: "允许谨慎新增",
  hold: "持仓观察",
  reduce: "优先降低风险",
};

export function adaptiveRegimeLabel(regime: AdaptiveMarketRegime): string {
  return regimeLabels[regime];
}

export function adaptivePostureLabel(
  posture: AdaptivePositionPosture,
): string {
  return postureLabels[posture];
}
