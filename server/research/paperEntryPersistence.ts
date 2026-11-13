import type { StockRegimeResult } from "./marketRegimeResearch";

function failedPersistenceDetails(stock: StockRegimeResult, strategyKey?: string | null): string {
  const failed: string[] = [];
  const actual = (value: number | null): string => value === null ? "未知" :
    Number.isFinite(value) ? String(value) : "非法数值";
  const check = (passed: boolean, label: string, value: number | null) => {
    if (!passed) failed.push(`${label}（当前${actual(value)}）`);
  };
  if (stock.regime === "healthy-trend") {
    check(stock.confidence >= 0.55, "形态置信度至少0.55", stock.confidence);
  } else if (stock.regime === "washout-candidate") {
    check(stock.confidence >= 0.65, "形态置信度至少0.65", stock.confidence);
    check(stock.validation.samples >= 20, "历史同类样本至少20个", stock.validation.samples);
    check(stock.validation.hitRate5d !== null && stock.validation.hitRate5d >= 0.55,
      "5日历史条件频率至少0.55", stock.validation.hitRate5d);
  } else if (stock.regime === "unclear") {
    if (strategyKey !== "rsi" && strategyKey !== "bollingerBands" && strategyKey !== "kairosRangeRotation" &&
        strategyKey !== "kairosQualifiedProbe" && strategyKey !== "kairosValidationBasket") {
      failed.push("当前策略不属于已实现的区间持续性分支");
    }
    check(stock.barCount >= 120, "完成日线至少120根", stock.barCount);
    check(stock.confidence >= 0.55, "形态置信度至少0.55", stock.confidence);
    check(stock.features.return20d >= -0.06 && stock.features.return20d <= 0.08,
      "20日收益处于[-0.06,0.08]", stock.features.return20d);
    check(stock.features.distanceFromMa20 >= -0.1 && stock.features.distanceFromMa20 <= 0.03,
      "距MA20偏离处于[-0.1,0.03]", stock.features.distanceFromMa20);
    check(stock.features.ma20Slope5d >= -0.01, "MA20五日斜率至少-0.01", stock.features.ma20Slope5d);
  } else {
    failed.push("当前历史形态没有已实现的持续性放行分支");
  }
  return failed.length ? ` 未满足：${failed.join("；")}。比率以小数表示，历史条件频率不等于未来盈利概率。` : "";
}

export function assessEntryPersistence(input: {
  required: boolean;
  stockRegime: StockRegimeResult | undefined;
  strategyKey?: string | null;
}): { allowed: boolean; explanation: string; ruleCheck: string } {
  if (!input.required) {
    return {
      allowed: true,
      explanation: "当前模式不要求外部历史形态准入。",
      ruleCheck: "entry-persistence: not-required",
    };
  }
  const stock = input.stockRegime;
  if (!stock) {
    return {
      allowed: false,
      explanation: "候选未进入真实历史日线观察池，缺少隔夜持续性确认。",
      ruleCheck: "entry-persistence: blocked (history-not-covered)",
    };
  }
  if (stock.regime === "healthy-trend" && stock.confidence >= 0.55) {
    return {
      allowed: true,
      explanation: `真实历史形态为健康趋势，置信度 ${(stock.confidence * 100).toFixed(0)}%。`,
      ruleCheck: `entry-persistence: pass (healthy-trend ${stock.confidence.toFixed(2)})`,
    };
  }
  const washoutValidated =
    stock.regime === "washout-candidate" &&
    stock.confidence >= 0.65 &&
    stock.validation.samples >= 20 &&
    stock.validation.hitRate5d !== null &&
    stock.validation.hitRate5d >= 0.55;
  if (washoutValidated) {
    return {
      allowed: true,
      explanation: `真实历史形态为已验证洗盘候选，置信度 ${(stock.confidence * 100).toFixed(0)}%，5 日历史命中率 ${(stock.validation.hitRate5d! * 100).toFixed(0)}%。`,
      ruleCheck: `entry-persistence: pass (validated-washout ${stock.confidence.toFixed(2)})`,
    };
  }
  const rangeStructureValidated =
    (
      input.strategyKey === "rsi" ||
      input.strategyKey === "bollingerBands" ||
      input.strategyKey === "kairosRangeRotation" ||
      input.strategyKey === "kairosQualifiedProbe" ||
      input.strategyKey === "kairosValidationBasket"
    ) &&
    stock.regime === "unclear" &&
    stock.barCount >= 120 &&
    stock.confidence >= 0.55 &&
    stock.features.return20d >= -0.06 &&
    stock.features.return20d <= 0.08 &&
    stock.features.distanceFromMa20 >= -0.1 &&
    stock.features.distanceFromMa20 <= 0.03 &&
    stock.features.ma20Slope5d >= -0.01;
  if (rangeStructureValidated) {
    return {
      allowed: true,
      explanation: `真实历史样本 ${stock.barCount} 根，区间偏离和均线斜率保持受控。`,
      ruleCheck: `entry-persistence: pass (range-structure ${stock.confidence.toFixed(2)})`,
    };
  }
  return {
    allowed: false,
    explanation: `真实历史形态 ${stock.regime} 未通过隔夜持续性准入，停止新建仓位。${failedPersistenceDetails(stock, input.strategyKey)}`,
    ruleCheck: `entry-persistence: blocked (${stock.regime} ${stock.confidence.toFixed(2)})`,
  };
}
