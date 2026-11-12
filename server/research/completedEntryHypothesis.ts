import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { HistoricalSeries } from "./marketRegimeResearch";
import { analyzeHistoricalEntryStructure } from "./historicalEntryStructure";
import { getChinaDateKey } from "../trading/ashareTradingCalendar";

export const COMPLETED_ENTRY_KEYS = ["kairosVolumePriceBreakout", "kairosVolatilityContractionBreakout", "aSharePullback"] as const;
export type CompletedEntryKey = typeof COMPLETED_ENTRY_KEYS[number];
export type EntryHypothesisState = "confirmed" | "not-confirmed" | "unknown";

/** This frozen experiment supports the verified Eastmoney lots contract only. */
export function completedDailyQuoteVolumeShares(source: string, volume: number): number {
  const shares = volume * 100;
  if (source !== "eastmoney-stock-history" || !Number.isFinite(volume) || volume < 0 || !Number.isSafeInteger(shares)) {
    throw Error("入场研究缺少已核实的成交量单位或有效股数");
  }
  return shares;
}

/** Offline hypothesis on completed qfq daily bars, never live cumulative volume. */
export function evaluateCompletedEntryHypothesis(series: HistoricalSeries, key: CompletedEntryKey, asOf: Date) {
  if (!COMPLETED_ENTRY_KEYS.includes(key) || !Number.isFinite(asOf.getTime())) throw Error("无效入场假设或截止时间");
  const structure = analyzeHistoricalEntryStructure(series, asOf);
  if (!structure.observed) return { state: "unknown" as EntryHypothesisState, structure };
  const ratio = structure.breakout.latestCompletedVolumeRatio20;
  if (ratio === null) return { state: "unknown" as EntryHypothesisState, structure };
  let confirmed: boolean;
  if (key === "aSharePullback") {
    const path = structure.pullback;
    if (path.lowCompletedVolumeRatio20 === null) return { state: "unknown" as EntryHypothesisState, structure };
    confirmed = path.recoveryAfterLow && path.latestCloseAbovePreviousDayHigh &&
      path.pullbackFromPriorAnchor > 0 && path.pullbackFromPriorAnchor <= 0.07 &&
      path.recoveredFromLow >= 0.008 && path.lowCompletedVolumeRatio20 <= 1 && ratio >= 1.15;
  } else {
    if (key === "kairosVolatilityContractionBreakout" && structure.contraction.ratio20to40 === null) {
      return { state: "unknown" as EntryHypothesisState, structure };
    }
    confirmed = structure.breakout.closesAbovePriorHigh20 &&
      ratio >= (key === "kairosVolumePriceBreakout" ? 1.5 : 1.4) &&
      (key !== "kairosVolatilityContractionBreakout" || structure.contraction.ratio20to40! <= 0.62);
  }
  return { state: (confirmed ? "confirmed" : "not-confirmed") as EntryHypothesisState, structure };
}

export interface CompletedEntryObservation {
  symbol: string;
  closeTime: string;
  proxyEligible: boolean;
  structure: EntryHypothesisState;
}

/** Private historical adapter: one actual position, common exits, no production imports. */
export function createCompletedEntryResearchStrategy(symbol: string, key: CompletedEntryKey,
  mode: "proxy" | "structure", observations: readonly CompletedEntryObservation[], asOf: Date) {
  const cutoff = asOf.getTime();
  if (!/^\d{6}$/.test(symbol) || !COMPLETED_ENTRY_KEYS.includes(key) || !["proxy", "structure"].includes(mode) || !Number.isFinite(cutoff)) {
    throw Error("入场研究缺少有效身份/模式/截止");
  }
  const rows = new Map<number, CompletedEntryObservation>();
  for (const row of observations) {
    const time = Date.parse(row.closeTime);
    if (row.symbol !== symbol || !Number.isFinite(time) || time > cutoff || rows.has(time) ||
      time !== Date.parse(`${getChinaDateKey(new Date(time))}T15:00:00+08:00`) ||
      typeof row.proxyEligible !== "boolean" || !["confirmed", "not-confirmed", "unknown"].includes(row.structure)) {
      throw Error("入场研究观测非本股唯一完成收盘");
    }
    rows.set(time, { ...row });
  }
  const empty = () => ({ completedCloses: 0, missingObservations: 0, proxyEligibleCloses: 0,
    structureConfirmedCloses: 0, structureUnknownCloses: 0, generatedBuys: 0,
    generatedStopExits: 0, generatedProfitExits: 0, generatedTimeoutExits: 0,
    blockedExitCloses: 0, unknownHoldingAgeCloses: 0 });
  let diagnostics = empty(), previousClose: number | undefined, cycle: number | undefined, holdingCloses: number | undefined;
  const strategy: BacktestStrategy = {
    name: `offline completed-entry:${key}:${mode}:${symbol}`,
    reset() { diagnostics = empty(); previousClose = cycle = holdingCloses = undefined; },
    onBar(context: StrategyContext): StrategySignal[] {
      const time = Date.parse(context.snapshot.marketTime);
      const quotes = context.snapshot.quotes.filter(quote => quote.symbol === symbol);
      const quote = quotes[0];
      if (context.snapshot.mode !== "paper" || !Number.isFinite(time) || time > cutoff ||
        time !== Date.parse(`${getChinaDateKey(new Date(time))}T15:00:00+08:00`) ||
        (previousClose !== undefined && time <= previousClose) || quotes.length !== 1 ||
        !Number.isFinite(quote.price) || quote.price <= 0 || Date.parse(quote.updatedAt) !== time) {
        throw Error("入场研究仅接受本股严格递增的完成收盘");
      }
      const preceding = previousClose; previousClose = time; diagnostics.completedCloses++;
      const observed = rows.get(time);
      if (!observed) diagnostics.missingObservations++;
      if (observed?.proxyEligible) diagnostics.proxyEligibleCloses++;
      if (observed?.structure === "confirmed") diagnostics.structureConfirmedCloses++;
      if (observed?.structure === "unknown") diagnostics.structureUnknownCloses++;
      const positions = context.positions.filter(position => position.symbol === symbol && position.quantity > 0);
      if (positions.length > 1) throw Error("入场研究拒绝重复实际持仓");
      const position = positions[0];
      if (!position) {
        cycle = holdingCloses = undefined;
        if (!quote.tradable || !observed?.proxyEligible || (mode === "structure" && observed.structure !== "confirmed")) return [];
        diagnostics.generatedBuys++;
        return [{ symbol, side: "buy", type: "market", targetWeight: 0.2 }];
      }
      const openedAt = Date.parse(position.paperEntry?.openedAt ?? "");
      if (!Number.isFinite(openedAt) || openedAt > time) cycle = holdingCloses = undefined;
      else if (cycle !== openedAt) {
        cycle = openedAt;
        holdingCloses = (preceding === undefined ? getChinaDateKey(new Date(openedAt)) === getChinaDateKey(new Date(time)) : openedAt > preceding) ? 1 : undefined;
      } else if (holdingCloses !== undefined) holdingCloses++;
      if (holdingCloses === undefined) diagnostics.unknownHoldingAgeCloses++;
      if (!Number.isFinite(position.averagePrice) || position.averagePrice <= 0) throw Error("入场研究持仓均价无效");
      const reason = quote.price <= position.averagePrice * 0.97 ? "generatedStopExits"
        : quote.price >= position.averagePrice * 1.05 ? "generatedProfitExits"
        : holdingCloses !== undefined && holdingCloses >= 10 ? "generatedTimeoutExits" : undefined;
      if (!reason) return [];
      const locked = position.t1LockedQuantity ?? 0;
      const available = position.availableQuantity ?? position.quantity - locked;
      const quantity = Math.floor(Math.min(position.quantity, available, position.quantity - locked) / 100) * 100;
      if (!quote.tradable || !Number.isFinite(locked) || locked < 0 || !Number.isFinite(quantity) || quantity <= 0) {
        diagnostics.blockedExitCloses++; return [];
      }
      diagnostics[reason]++;
      return [{ symbol, side: "sell", type: "market", quantity }];
    },
  };
  return { strategy, getDiagnostics: () => ({ ...diagnostics }) };
}
